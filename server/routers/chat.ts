import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, orgProcedure } from "../trpc";
import { processMessage } from "../services/chat.service";
import { chatRateLimiter } from "@/server/middleware/rateLimit";

/** Strip control characters and HTML-significant chars, truncate to 120 chars */
function sanitizeForPrompt(input: string): string {
  return input.replace(/[\r\n\t<>]/g, " ").trim().slice(0, 120);
}

export const chatRouter = createTRPCRouter({
  sendMessage: orgProcedure
    .input(
      z.object({
        conversationId: z.string().optional(),
        message: z.string().min(1).max(4000),
        attachmentId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await chatRateLimiter(ctx.organisationId);

      const sanitizedMessage = sanitizeForPrompt(input.message);
      let conversationId = input.conversationId;

      if (!conversationId) {
        const conv = await ctx.db.chatConversation.create({
          data: {
            organisationId: ctx.organisationId,
            userId: ctx.user.id,
            title: input.message.slice(0, 60),
          },
        });
        conversationId = conv.id;
      }

      await ctx.db.chatMessage.create({
        data: {
          conversationId,
          role: "user",
          content: input.message,
          attachmentId: input.attachmentId || null,
        },
      });

      const response = await processMessage(ctx.db, {
        organisationId: ctx.organisationId,
        userId: ctx.user.id,
        conversationId,
        userMessage: sanitizedMessage,
        attachmentId: input.attachmentId,
      });

      const assistantMessage = await ctx.db.chatMessage.create({
        data: {
          conversationId,
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls.length > 0 ? (response.toolCalls as unknown as Prisma.InputJsonValue) : undefined,
          toolResults: response.toolResults.length > 0 ? (response.toolResults as unknown as Prisma.InputJsonValue) : undefined,
        },
      });

      return {
        conversationId,
        message: {
          id: assistantMessage.id,
          role: "assistant" as const,
          content: response.content,
          toolCalls: response.toolCalls,
          toolResults: response.toolResults,
          createdAt: assistantMessage.createdAt,
        },
      };
    }),

  getConversation: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const conv = await ctx.db.chatConversation.findFirst({
        where: { id: input.id, organisationId: ctx.organisationId },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!conv) return null;
      return conv;
    }),

  listConversations: orgProcedure.query(async ({ ctx }) => {
    return ctx.db.chatConversation.findMany({
      where: { organisationId: ctx.organisationId, userId: ctx.user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
  }),

  deleteConversation: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.chatConversation.deleteMany({
        where: { id: input.id, organisationId: ctx.organisationId },
      });
      return { success: true };
    }),
});
