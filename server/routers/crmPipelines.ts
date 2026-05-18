import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";

export const crmPipelinesRouter = createTRPCRouter({
  list: orgProcedure
    .query(async ({ ctx }) => {
      return ctx.db.crmPipeline.findMany({
        where: { organisationId: ctx.organisationId },
        include: {
          stages: { orderBy: { order: "asc" } },
          _count: { select: { deals: true } },
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      });
    }),

  create: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        isDefault: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        if (input.isDefault) {
          await tx.crmPipeline.updateMany({
            where: { organisationId: ctx.organisationId },
            data: { isDefault: false },
          });
        }
        const pipeline = await tx.crmPipeline.create({
          data: {
            organisationId: ctx.organisationId,
            name: input.name,
            isDefault: input.isDefault,
          },
        });
        // Create a default stage
        await tx.crmPipelineStage.create({
          data: { pipelineId: pipeline.id, name: "New", order: 1, probability: 10 },
        });
        return tx.crmPipeline.findUnique({
          where: { id: pipeline.id },
          include: { stages: { orderBy: { order: "asc" } } },
        });
      });
    }),

  update: orgProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const existing = await ctx.db.crmPipeline.findFirst({ where: { id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.crmPipeline.updateMany({
            where: { organisationId: ctx.organisationId, id: { not: id } },
            data: { isDefault: false },
          });
        }
        return tx.crmPipeline.update({ where: { id }, data });
      });
    }),

  delete: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.crmPipeline.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const dealCount = await ctx.db.crmDeal.count({ where: { pipelineId: input.id } });
      if (dealCount > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete pipeline with active deals." });
      await ctx.db.crmPipeline.delete({ where: { id: input.id } });
      return { success: true };
    }),

  createStage: orgProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        name: z.string().min(1).max(100),
        order: z.number().int().positive(),
        probability: z.number().int().min(0).max(100).default(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pipeline = await ctx.db.crmPipeline.findFirst({ where: { id: input.pipelineId, organisationId: ctx.organisationId } });
      if (!pipeline) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.crmPipelineStage.create({ data: input });
    }),

  updateStage: orgProcedure
    .input(
      z.object({
        stageId: z.string(),
        name: z.string().min(1).max(100).optional(),
        probability: z.number().int().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { stageId, ...data } = input;
      const stage = await ctx.db.crmPipelineStage.findFirst({
        where: { id: stageId },
        include: { pipeline: { select: { organisationId: true } } },
      });
      if (!stage || stage.pipeline.organisationId !== ctx.organisationId) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.crmPipelineStage.update({ where: { id: stageId }, data });
    }),

  deleteStage: orgProcedure
    .input(z.object({ stageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const stage = await ctx.db.crmPipelineStage.findFirst({
        where: { id: input.stageId },
        include: { pipeline: { select: { organisationId: true } } },
      });
      if (!stage || stage.pipeline.organisationId !== ctx.organisationId) throw new TRPCError({ code: "NOT_FOUND" });
      const dealCount = await ctx.db.crmDeal.count({ where: { stageId: input.stageId } });
      if (dealCount > 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete stage with active deals. Move deals first." });
      await ctx.db.crmPipelineStage.delete({ where: { id: input.stageId } });
      return { success: true };
    }),

  reorderStages: orgProcedure
    .input(z.object({ pipelineId: z.string(), stageIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const pipeline = await ctx.db.crmPipeline.findFirst({ where: { id: input.pipelineId, organisationId: ctx.organisationId } });
      if (!pipeline) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.$transaction(
        input.stageIds.map((stageId, index) =>
          ctx.db.crmPipelineStage.update({ where: { id: stageId }, data: { order: index + 1 } })
        )
      );
      return { success: true };
    }),
});
