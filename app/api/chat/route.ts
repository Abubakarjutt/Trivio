import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildChatMessages, executeToolCall, parseToolCalls, type ToolResult } from "@/server/services/chat.service";
import { extractionRateLimiter } from "@/server/middleware/rateLimit";

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
        case "create_crm_company":
          return `✓ Company "${d?.name}" added (${d?.size}, ${d?.industry ?? "no industry set"})`;
        case "create_watchlist":
          return `✓ Watchlist "${d?.name}" created — alert when ${d?.category} exceeds $${d?.threshold} per ${String(d?.period ?? "").toLowerCase()}`;
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

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

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

  const body = await req.json();
  const { message, conversationId: inputConvId, attachmentId } = body as {
    message: string;
    conversationId?: string;
    attachmentId?: string;
  };

  if (!message?.trim()) {
    return new Response("Message required", { status: 400 });
  }

  // Rate-limit chat requests to protect AI compute costs
  try {
    await extractionRateLimiter(`chat:${user.id}`);
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
        const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: true, think: false }),
        });

        if (!res.ok || !res.body) {
          sendEvent("error", { message: `Ollama returned ${res.status}` });
          controller.close();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let buffer = "";
        let sentThinking = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.message?.content) {
                const token = json.message.content;
                fullContent += token;
                sendEvent("token", { content: token });
              } else if (json.message?.thinking && !sentThinking) {
                sentThinking = true;
                sendEvent("thinking", { status: "thinking" });
              }
            } catch {
              // skip malformed lines
            }
          }
        }

        const { text, toolCalls } = parseToolCalls(fullContent, nonce);
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
