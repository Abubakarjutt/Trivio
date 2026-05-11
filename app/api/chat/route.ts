import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildChatMessages, executeToolCall, parseToolCalls } from "@/server/services/chat.service";

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
  }

  await db.chatMessage.create({
    data: {
      conversationId,
      role: "user",
      content: message,
      attachmentId: attachmentId || null,
    },
  });

  const messages = await buildChatMessages(db, {
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

        const { text, toolCalls } = parseToolCalls(fullContent);
        let finalContent = text;
        const toolResults = [];

        if (toolCalls.length > 0) {
          sendEvent("tools_start", { count: toolCalls.length });
          for (const call of toolCalls) {
            const result = await executeToolCall(db, user.organisationId!, user.id, call);
            toolResults.push(result);
            sendEvent("tool_result", result);
          }

          const resultSummary = toolResults.map((r) => {
            if (r.success) return `✅ ${r.tool}: ${JSON.stringify(r.data)}`;
            return `❌ ${r.tool}: ${r.error}`;
          }).join("\n\n");
          finalContent = finalContent ? `${finalContent}\n\n${resultSummary}` : resultSummary;
        }

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
