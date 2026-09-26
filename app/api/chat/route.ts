import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  buildChatMessages,
  executeToolCall,
  formatToolResultsForModel,
  parseToolCalls,
  type ToolCall,
  type ToolResult,
} from "@/server/services/chat.service";
import {
  callKey,
  canonicalizeCall,
  checkProposalRefs,
  claimsUnbackedAction,
  createProposals,
  isReadOnlyCall,
  normalizeToolCall,
  stripStatusLines,
  validateProposal,
} from "@/server/services/chat-approval";
import { chatRateLimiter } from "@/server/middleware/rateLimit";
import { resolveProvider } from "@/server/services/ai-status";

const chatBodySchema = z
  .object({
    // Absent when `resume` continues a turn after the user approved/rejected
    // the actions the assistant proposed.
    message: z.string().min(1).max(4000).optional(),
    resume: z.boolean().optional(),
    // ChatConversation.id / Attachment.id are Prisma cuid()s, not UUIDs — a plain
    // non-empty check is enough; ownership is verified separately below (IDOR
    // guard), so this isn't a security boundary.
    conversationId: z.string().min(1).optional(),
    attachmentId: z.string().min(1).optional(),
  })
  .refine((b) => (b.resume === true ? !!b.conversationId : !!b.message), {
    message: "message is required (or resume with a conversationId)",
  });

// ── Provider configuration ─────────────────────────────────────────────────────
//
// Two chat backends are supported:
//   • gemini  — the cloud backend (Google Generative Language API); auto-selected when GEMINI_API_KEY is set. Used by the
//                hosted web app. Requires GEMINI_API_KEY.
//   • ollama  — a LOCAL model (Gemma, e.g. "gemma4:e4b") served by an Ollama
//                instance the desktop app installs & runs on the user's machine.
//                No API key, fully offline. Selected via AI_PROVIDER=ollama,
//                which the desktop shell sets once its Ollama setup is complete.
//
// The desktop shell points the embedded server at its own loopback Ollama via
// OLLAMA_HOST / OLLAMA_MODEL. If that instance is not reachable (not installed,
// not started, or the model not pulled yet) the route emits a `needs_setup`
// error event so the UI can prompt the user to finish the Ollama setup instead
// of showing a generic failure.

// Provider selection is shared with the AI-status probe (see
// server/services/ai-status.ts -> resolveProvider) so the two never disagree:
// an explicit AI_PROVIDER wins; otherwise prefer the cloud when a key is set,
// else the local Ollama engine.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const AI_PROVIDER = resolveProvider(process.env);
const GEMINI_MODEL = process.env.CHAT_MODEL ?? "gemini-2.5-flash";
const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:e4b";

// Thrown by a provider when it cannot serve a turn yet (e.g. Ollama not set up).
// Surfaced to the client as an SSE `error` event carrying `code: "needs_setup"`
// so the UI can offer the Ollama setup flow rather than a dead-end error.
class NeedsSetupError extends Error {
  readonly code = "needs_setup";
  constructor(message: string) {
    super(message);
    this.name = "NeedsSetupError";
  }
}

// The text the model produced, after provider-specific shaping. Both providers
// return a plain string (our tool-calling is a TEXT protocol — TOOL_CALL: lines
// — so no native function-calling is required or honoured).
interface ProviderTurn {
  text: string;
}

// ── Gemini provider ────────────────────────────────────────────────────────────

async function runGemini(params: {
  systemMsg?: { role: string; content: string };
  chatMsgs: { role: string; content: string }[];
}): Promise<ProviderTurn> {
  const { systemMsg, chatMsgs } = params;

  // Convert to Gemini's contents format (user/model roles)
  const contents = chatMsgs.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
      // Disable native function calling — we use our own TOOL_CALL text format
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini returned ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          thought?: boolean;
          functionCall?: { name?: string; args?: Record<string, unknown> };
        }>;
      };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
    error?: { message?: string; code?: number };
  };

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const finishReason = json.candidates?.[0]?.finishReason;

  // Reject native function calls — mode=NONE is set, so any native function
  // call is unexpected and could be a prompt-injection attempt bypassing
  // the nonce-based tool-call guard. Drop the native call and respond with
  // a safe fallback instead of synthesising a TOOL_CALL text line.
  if (finishReason === "UNEXPECTED_TOOL_CALL") {
    return {
      text: "I'm sorry, I wasn't able to generate a response. Please try again.",
    };
  }

  const fullContent = parts
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text!)
    .join("")
    .trim();

  const responseText =
    fullContent ||
    (finishReason === "MAX_TOKENS"
      ? "I'm sorry, I ran out of space to form a reply. Please try asking a shorter or simpler question."
      : "I'm sorry, I wasn't able to generate a response. Please try again.");

  return { text: responseText };
}

// ── Ollama provider (local Gemma) ──────────────────────────────────────────────

async function runOllama(params: {
  systemMsg?: { role: string; content: string };
  chatMsgs: { role: string; content: string }[];
}): Promise<ProviderTurn> {
  const { systemMsg, chatMsgs } = params;

  // Ollama's /api/chat uses system/user/assistant roles directly.
  const messages = [
    ...(systemMsg ? [{ role: "system", content: systemMsg.content }] : []),
    ...chatMsgs.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  ];

  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: { temperature: 0.2, num_predict: 8192 },
    }),
    signal: AbortSignal.timeout(180000),
  }).catch(() => {
    // Connection refused / DNS / timeout → the local Ollama isn't up yet.
    throw new NeedsSetupError(
      "The local AI assistant (Ollama + Gemma) isn't running. Set it up in Settings → AI Assistant, then try again."
    );
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // A missing model (404/400 "model not found") or a stopped server both mean
    // the user still has to finish setup.
    if (res.status === 404 || /model|not found|unknown/i.test(errText)) {
      throw new NeedsSetupError(
        `The local model "${OLLAMA_MODEL}" isn't available yet. Finish the AI Assistant setup in Settings, then try again.`
      );
    }
    throw new Error(`Ollama returned ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    message?: { content?: string };
    done?: boolean;
    error?: string;
  };
  if (json.error) {
    if (/model|not found|unknown/i.test(json.error)) {
      throw new NeedsSetupError(
        `The local model "${OLLAMA_MODEL}" isn't available yet. Finish the AI Assistant setup in Settings, then try again.`
      );
    }
    throw new Error(`Ollama: ${json.error}`);
  }

  const text = (json.message?.content ?? "").trim();
  return { text: text || "I'm sorry, I wasn't able to generate a response. Please try again." };
}

// ── Shared post-processing ─────────────────────────────────────────────────────

// Max model calls per user message. Each extra round lets the model read the
// data it asked for (e.g. look up an id) and then act on it.
const MAX_AGENT_ROUNDS = 4;

type ChatMsg = { role: string; content: string };

// Sent when the model says it did something but wrote no ACTION line.
const UNBACKED_CLAIM_CORRECTION = (nonce: string) =>
  `APP_NOTICE (from the app, not the user): your reply says something was done, but you wrote no ACTION line, so NOTHING was saved or changed. If the user asked for a change, write the ACTION line now (TOOL_CALL_${nonce}: {"tool":"...","args":{...}}). If you were only describing existing data, repeat your answer without claiming you did anything.`;

const NOTHING_CHANGED_NOTE =
  "ℹ️ Nothing was changed — no action was taken. Ask again if you'd like me to do it.";

async function runAgentLoop(params: {
  conversationId: string;
  userOrgId: string;
  userId: string;
  chatMsgs: ChatMsg[];
  runModel: (chatMsgs: ChatMsg[]) => Promise<ProviderTurn>;
  nonce: string;
  sendEvent: (event: string, data: unknown) => void;
  close: () => void;
  // Actions the user already approved earlier in this request (resume) —
  // never propose them again.
  alreadyDone?: string[];
}): Promise<void> {
  const { conversationId, userOrgId, userId, runModel, nonce, sendEvent, close } = params;
  const msgs = [...params.chatMsgs];
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  // Data-changing calls wait for the user's Approve — never executed here.
  const proposals: ToolCall[] = [];
  // Reads that succeeded and writes already proposed/approved — the model
  // repeating itself in a follow-up round must not duplicate them.
  const handled = new Set<string>(params.alreadyDone ?? []);
  let text = "";
  let corrected = false;
  // Right after the user approved a card, "recorded ✓" is true — the app
  // saved it — so it must not be corrected or labelled "Nothing was changed".
  const approvedThisTurn = (params.alreadyDone?.length ?? 0) > 0;

  for (let round = 1; round <= MAX_AGENT_ROUNDS; round++) {
    if (round > 1) sendEvent("thinking", {});
    const turn = await runModel(msgs);
    const parsed = parseToolCalls(turn.text, nonce);
    if (parsed.text) text = parsed.text;

    // Dedupe against earlier rounds AND within this reply — small models
    // sometimes write the same ACTION line twice.
    const seen = new Set<string>();
    const fresh = parsed.toolCalls
      .map((c) => canonicalizeCall(normalizeToolCall(c)))
      .filter((c) => {
        const key = callKey(c);
        if (handled.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (fresh.length === 0) {
      // "✓ Expense recorded" with no ACTION line is how a transaction went
      // missing — give the model one chance to actually make the call.
      if (
        !corrected &&
        !approvedThisTurn &&
        proposals.length === 0 &&
        toolCalls.length === 0 &&
        round < MAX_AGENT_ROUNDS &&
        claimsUnbackedAction(parsed.text)
      ) {
        corrected = true;
        msgs.push({ role: "assistant", content: turn.text });
        msgs.push({ role: "user", content: UNBACKED_CLAIM_CORRECTION(nonce) });
        continue;
      }
      break;
    }

    const roundResults: ToolResult[] = [];
    for (const call of fresh) {
      if (isReadOnlyCall(call)) {
        const result = await executeToolCall(db, userOrgId, userId, call);
        if (result.success) handled.add(callKey(call));
        toolCalls.push(call);
        roundResults.push(result);
        continue;
      }
      const problem = validateProposal(call) ?? (await checkProposalRefs(db, userOrgId, call));
      if (problem) {
        roundResults.push({ tool: call.tool, success: false, error: problem });
        continue;
      }
      handled.add(callKey(call));
      proposals.push(call);
    }
    // A failure the model then recovers from shouldn't show as a red card —
    // drop earlier rounds' failures, keep this round's.
    for (let i = toolResults.length - 1; i >= 0; i--) {
      if (!toolResults[i].success) toolResults.splice(i, 1);
    }
    toolResults.push(...roundResults);

    // Writes wait for the user; the turn resumes after they answer.
    if (proposals.length > 0) break;
    if (round === MAX_AGENT_ROUNDS) break;
    // Let the model read what it asked for (ids, balances) and carry on.
    msgs.push({ role: "assistant", content: turn.text });
    msgs.push({ role: "user", content: formatToolResultsForModel(roundResults, nonce) });
  }

  // Only the app may say something was done.
  text = stripStatusLines(text);
  if (proposals.length > 0) {
    if (!text || claimsUnbackedAction(text)) {
      text =
        proposals.length === 1
          ? "Here's what I've prepared — approve it to save."
          : "Here's what I've prepared — approve each one to save it.";
    }
  } else if (toolCalls.length === 0 && !approvedThisTurn && claimsUnbackedAction(text)) {
    text = `${text}\n\n${NOTHING_CHANGED_NOTE}`;
  }

  sendEvent("token", { content: text });

  const message = await db.chatMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: text,
      toolCalls:
        toolCalls.length > 0
          ? (toolCalls as unknown as import("@prisma/client").Prisma.InputJsonValue)
          : undefined,
      toolResults:
        toolResults.length > 0
          ? (toolResults as unknown as import("@prisma/client").Prisma.InputJsonValue)
          : undefined,
    },
  });

  const pendingActions =
    proposals.length > 0
      ? await createProposals(db, {
          organisationId: userOrgId,
          userId,
          conversationId,
          messageId: message.id,
          calls: proposals,
        })
      : [];

  sendEvent("done", {
    conversationId,
    messageId: message.id,
    content: text,
    toolCalls,
    toolResults,
    pendingActions,
  });
  close();
}

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { organisation: true },
  });

  if (!user?.organisationId) {
    return new Response("No organisation", { status: 403 });
  }

  const parsed = chatBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return new Response("Invalid request body", { status: 400 });
  }
  const { message, resume, conversationId: inputConvId, attachmentId } = parsed.data;

  // Rate-limit chat requests to protect AI compute costs
  try {
    await chatRateLimiter(`chat:${user.id}`);
  } catch {
    return new Response("Too many requests. Try again shortly.", { status: 429 });
  }

  let conversationId = inputConvId;
  if (!conversationId) {
    const conv = await db.chatConversation.create({
      data: {
        organisationId: user.organisationId,
        userId: user.id,
        title: message!.slice(0, 60),
      },
    });
    conversationId = conv.id;
  } else {
    // Verify the conversation is this user's own — prevent IDOR
    const ownedConv = await db.chatConversation.findFirst({
      where: { id: conversationId, organisationId: user.organisationId, userId: user.id },
      select: { id: true },
    });
    if (!ownedConv) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  let alreadyDone: string[] = [];
  if (resume) {
    // Continue only right after the user has answered every proposal on the
    // latest reply — otherwise there's nothing to continue from (and a
    // replayed request can't trigger a second follow-up).
    const latest = await db.chatMessage.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      include: { pendingActions: true },
    });
    const actions = latest?.pendingActions ?? [];
    const answered =
      latest?.role === "assistant" &&
      actions.length > 0 &&
      actions.every((a) => a.status !== "PENDING" && a.status !== "EXECUTING");
    if (!answered) return new Response("Nothing to resume", { status: 409 });
    alreadyDone = actions
      .filter((a) => a.status === "APPROVED")
      .map((a) => callKey({ tool: a.tool, args: a.args as Record<string, unknown> }));
  } else {
    await db.chatMessage.create({
      data: {
        conversationId,
        role: "user",
        content: message!,
        attachmentId: attachmentId || null,
      },
    });
  }

  const { messages, nonce } = await buildChatMessages(db, {
    organisationId: user.organisationId,
    conversationId,
    userMessage: resume ? undefined : message,
    attachmentId,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      sendEvent("start", { conversationId });

      try {
        // Separate system prompt from conversation history
        const systemMsg = messages.find((m) => m.role === "system");
        const chatMsgs = messages.filter((m) => m.role !== "system");

        // ── Provider selection ─────────────────────────────────────────────
        // Local Gemma via the desktop's Ollama. If it isn't reachable yet the
        // provider throws NeedsSetupError, which we surface as a `needs_setup`
        // error event so the UI can prompt the user to finish setup.
        if (AI_PROVIDER !== "ollama" && !GEMINI_API_KEY) {
          sendEvent("error", {
            code: "needs_setup",
            message: "AI chat is not configured. Please set GEMINI_API_KEY.",
          });
          controller.close();
          return;
        }
        const runModel = (msgs: ChatMsg[]) =>
          AI_PROVIDER === "ollama"
            ? runOllama({ systemMsg, chatMsgs: msgs })
            : runGemini({ systemMsg, chatMsgs: msgs });

        await runAgentLoop({
          conversationId,
          userOrgId: user.organisationId!,
          userId: user.id,
          chatMsgs,
          runModel,
          nonce,
          sendEvent,
          close: () => controller.close(),
          alreadyDone,
        });
        return;
      } catch (err) {
        if (err instanceof NeedsSetupError) {
          sendEvent("error", { code: "needs_setup", message: err.message });
        } else {
          sendEvent("error", { message: err instanceof Error ? err.message : "Unknown error" });
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
