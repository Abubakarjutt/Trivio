import { z } from "zod";
import { createTRPCRouter, orgProcedure } from "../trpc";

export const chatRouter = createTRPCRouter({
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
