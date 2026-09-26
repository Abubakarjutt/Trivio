import { z } from "zod";
import { createTRPCRouter, orgProcedure } from "../trpc";
import { getAiStatus, type AiStatus } from "../services/ai-status";

export const chatRouter = createTRPCRouter({
  getConversation: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const conv = await ctx.db.chatConversation.findFirst({
        // A conversation is private to the user who had it, like the list.
        where: { id: input.id, organisationId: ctx.organisationId, userId: ctx.user.id },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            // Approve/Reject cards the assistant attached to each reply
            include: {
              pendingActions: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  tool: true,
                  preview: true,
                  status: true,
                  summary: true,
                  error: true,
                  result: true,
                },
              },
            },
          },
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
        where: { id: input.id, organisationId: ctx.organisationId, userId: ctx.user.id },
      });
      return { success: true };
    }),

  // AI-assistant availability probe — reports whether a chat turn can be served
  // right now. Desktop mode selects a LOCAL Ollama+Gemma model; the web default is
  // Gemini. `ready=false` tells the UI to offer the Ollama setup flow.
  getAiStatus: orgProcedure.query(async (): Promise<AiStatus> => getAiStatus()),
});
