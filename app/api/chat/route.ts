import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildChatMessages, executeToolCall, parseToolCalls, type ToolResult } from "@/server/services/chat.service";
import { chatRateLimiter } from "@/server/middleware/rateLimit";

const chatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  attachmentId: z.string().uuid().optional(),
});

function buildToolSummary(toolResults: ToolResult[]): string {
  return toolResults
    .map((r) => {
      if (!r.success) return `❌ ${r.tool.replace(/_/g, " ")}: ${r.error}`;
      const d = r.data as Record<string, unknown> | undefined;
      switch (r.tool) {
        case "create_invoice":
          return `✓ Invoice ${d?.number} created for ${d?.customer} — total $${d?.total}`;
        case "create_bill":
          return `✓ Bill ${d?.number} created for ${d?.supplier} — total $${d?.total}`;
        case "create_journal_entry":
          return `✓ Journal entry recorded`;
        case "create_crm_lead":
          return `✓ Lead ${d?.name} added (${d?.source}, status: ${d?.status})`;
        case "update_crm_lead_status":
          return `✓ Lead ${d?.name} updated to ${d?.status}`;
        case "create_crm_deal":
          return `✓ Deal "${d?.name}" created for ${d?.contact} — stage: ${d?.stage}, value: $${d?.value}`;
        case "move_crm_deal":
          return `✓ Deal "${d?.name}" moved to ${d?.newStage}`;
        case "create_crm_activity":
          return `✓ ${d?.type} activity "${d?.subject}" logged${d?.dueDate ? ` (due ${d?.dueDate})` : ""}`;
        case "create_recurring":
          return `✓ Recurring ${String(d?.type ?? "").toLowerCase()} "${d?.name}" created — $${d?.amount} ${String(d?.frequency ?? "").toLowerCase()}, next due ${d?.nextDueDate}`;
        case "mark_recurring_paid":
          return `✓ "${d?.name}" marked paid — next due ${d?.nextDueDate}`;
        case "create_goal":
          return `✓ Goal "${d?.name}" created — target $${d?.targetAmount}${d?.targetDate ? `, by ${d?.targetDate}` : ""}`;
        case "update_goal_progress":
          return `✓ Goal "${d?.name}" progress updated to $${d?.currentAmount} / $${d?.targetAmount} (${d?.progress}%)${d?.status === "COMPLETED" ? " — 🎉 Goal achieved!" : ""}`;
        case "send_invoice":
          return `✓ Invoice ${d?.number} marked as sent`;
        case "void_invoice":
          return `✓ Invoice ${d?.number} voided`;
        case "record_invoice_payment":
          return `✓ Payment of $${d?.amountPaid} recorded on invoice ${d?.number} — now ${d?.newStatus} (via ${d?.cashAccount})`;
        case "approve_bill":
          return `✓ Bill ${d?.number} approved`;
        case "void_bill":
          return `✓ Bill ${d?.number} voided`;
        case "record_bill_payment":
          return `✓ Payment of $${d?.amountPaid} recorded on bill ${d?.number} — now ${d?.newStatus} (via ${d?.cashAccount})`;
        case "void_transaction":
          return `✓ Journal entry voided: "${d?.description}"`;
        case "create_contact":
          return `✓ Contact "${d?.name}" (${d?.type}) created`;
        case "update_contact":
          return `✓ Contact "${d?.name}" updated`;
        case "create_account":
          return `✓ Account ${d?.code} — ${d?.name} (${String(d?.type ?? "").toLowerCase()}) created`;
        case "set_budget":
          return `✓ Budget ${d?.action === "updated" ? "updated" : "created"} — ${d?.category}: $${d?.limitAmount}/${String(d?.period ?? "MONTHLY").toLowerCase()}`;
        case "set_budgets":
          return `✓ ${d?.saved} budget(s) saved`;
        case "extract_document":
          return `✓ Document queued for extraction — check Attachments for results`;
        case "create_crm_company":
          return `✓ Company "${d?.name}" added (${d?.size}, ${d?.industry ?? "no industry set"})`;
        case "list_invoices":
        case "list_bills":
        case "get_invoice":
        case "get_bill":
        case "list_contacts":
        case "list_accounts":
        case "get_account_balance":
        case "search_transactions":
        case "get_profit_and_loss":
        case "get_balance_sheet":
        case "get_trial_balance":
        case "get_ar_aging":
        case "get_ap_aging":
          return "";
        case "create_watchlist":
          return `✓ Watchlist "${d?.name}" created — alert when ${d?.category} exceeds $${d?.threshold} per ${String(d?.period ?? "").toLowerCase()}`;
        case "list_budgets":
        case "list_crm_leads":
        case "list_crm_deals":
        case "list_crm_activities":
        case "list_crm_companies":
        case "list_recurring":
        case "list_goals":
        case "list_watchlists":
          return "";
        default:
          return `✓ ${r.tool.replace(/_/g, " ")} completed`;
      }
    })
    .filter(Boolean)
    .join("\n");
}

export const maxDuration = 120;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL   = process.env.CHAT_MODEL ?? "gemma-4-26b-a4b-it";

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
  const { message, conversationId: inputConvId, attachmentId } = parsed.data;

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
        title: message.slice(0, 60),
      },
    });
    conversationId = conv.id;
  } else {
    // Verify the conversation belongs to this organisation — prevent IDOR
    const ownedConv = await db.chatConversation.findFirst({
      where: { id: conversationId, organisationId: user.organisationId },
      select: { id: true },
    });
    if (!ownedConv) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  await db.chatMessage.create({
    data: {
      conversationId,
      role: "user",
      content: message,
      attachmentId: attachmentId || null,
    },
  });

  const { messages, nonce } = await buildChatMessages(db, {
    organisationId: user.organisationId,
    conversationId,
    userMessage: message,
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
        if (!GEMINI_API_KEY) {
          sendEvent("error", { message: "AI chat is not configured. Please set GEMINI_API_KEY." });
          controller.close();
          return;
        }

        // Separate system prompt from conversation history
        const systemMsg = messages.find((m) => m.role === "system");
        const chatMsgs  = messages.filter((m) => m.role !== "system");

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
          sendEvent("error", { message: `Gemini returned ${res.status}: ${errText.slice(0, 200)}` });
          controller.close();
          return;
        }

        const json = await res.json() as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name?: string; args?: Record<string, unknown> } }> };
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
          sendEvent("token", { content: "I'm sorry, I wasn't able to generate a response. Please try again." });
          sendEvent("done", { conversationId, content: "I'm sorry, I wasn't able to generate a response. Please try again.", toolCalls: [], toolResults: [] });
          await db.chatMessage.create({
            data: { conversationId, role: "assistant", content: "I'm sorry, I wasn't able to generate a response. Please try again." },
          });
          controller.close();
          return;
        }

        const fullContent = parts
          .filter((p) => !p.thought && p.text)
          .map((p) => p.text!)
          .join("")
          .trim();

        const responseText = fullContent ||
          (finishReason === "MAX_TOKENS"
            ? "I'm sorry, I ran out of space to form a reply. Please try asking a shorter or simpler question."
            : "I'm sorry, I wasn't able to generate a response. Please try again.");

        sendEvent("token", { content: responseText });

        const { text, toolCalls } = parseToolCalls(responseText, nonce);
        const toolResults: ToolResult[] = [];

        if (toolCalls.length > 0) {
          for (const call of toolCalls) {
            const result = await executeToolCall(db, user.organisationId!, user.id, call);
            toolResults.push(result);
          }
        }

        const summary = buildToolSummary(toolResults);
        const finalContent = summary ? `${text}\n\n${summary}`.trim() : text;

        await db.chatMessage.create({
          data: {
            conversationId,
            role: "assistant",
            content: finalContent,
            toolCalls: toolCalls.length > 0 ? (toolCalls as unknown as import("@prisma/client").Prisma.InputJsonValue) : undefined,
            toolResults: toolResults.length > 0 ? (toolResults as unknown as import("@prisma/client").Prisma.InputJsonValue) : undefined,
          },
        });

        sendEvent("done", { conversationId, content: finalContent, toolCalls, toolResults });
      } catch (err) {
        sendEvent("error", { message: err instanceof Error ? err.message : "Unknown error" });
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
