import { z } from "zod";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { calcWeightedForecast, toNum } from "@/server/services/crm.service";

export const crmReportsRouter = createTRPCRouter({
  pipeline: orgProcedure
    .input(z.object({ pipelineId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const stages = await ctx.db.crmPipelineStage.findMany({
        where: input.pipelineId ? { pipelineId: input.pipelineId } : {
          pipeline: { organisationId: ctx.organisationId },
        },
        include: {
          deals: {
            where: { organisationId: ctx.organisationId, closedAt: null },
            select: { value: true, probability: true },
          },
        },
        orderBy: { order: "asc" },
      });

      return stages.map((stage) => {
        const totalValue = stage.deals.reduce((s, d) => s + toNum(d.value), 0);
        const weightedValue = stage.deals.reduce((s, d) => s + toNum(d.value) * (d.probability / 100), 0);
        return {
          stageId: stage.id,
          stageName: stage.name,
          dealCount: stage.deals.length,
          totalValue: Math.round(totalValue * 100) / 100,
          weightedValue: Math.round(weightedValue * 100) / 100,
        };
      });
    }),

  wonLostAnalysis: orgProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ ctx, input }) => {
      const from = new Date(input.from);
      const to = new Date(input.to);

      const closed = await ctx.db.crmDeal.findMany({
        where: {
          organisationId: ctx.organisationId,
          closedAt: { gte: from, lte: to },
        },
        select: { value: true, probability: true, wonLostReason: true, closedAt: true, invoiceId: true, createdAt: true },
      });

      const won = closed.filter((d) => d.probability === 100 || d.invoiceId != null);
      const lost = closed.filter((d) => d.probability === 0 && d.invoiceId == null);
      const winRate = closed.length > 0 ? Math.round((won.length / closed.length) * 100) : 0;
      const avgDealSize = won.length > 0
        ? Math.round(won.reduce((s, d) => s + toNum(d.value), 0) / won.length * 100) / 100
        : 0;

      // Loss reasons breakdown
      const lossReasonMap = new Map<string, number>();
      for (const d of lost) {
        const reason = d.wonLostReason ?? "No reason given";
        lossReasonMap.set(reason, (lossReasonMap.get(reason) ?? 0) + 1);
      }
      const lossReasons = Array.from(lossReasonMap.entries()).map(([reason, count]) => ({ reason, count }));

      return { totalClosed: closed.length, wonCount: won.length, lostCount: lost.length, winRate, avgDealSize, lossReasons };
    }),

  activityReport: orgProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ ctx, input }) => {
      const activities = await ctx.db.crmActivity.findMany({
        where: {
          organisationId: ctx.organisationId,
          createdAt: { gte: new Date(input.from), lte: new Date(input.to) },
        },
        select: { type: true, createdById: true, createdBy: { select: { id: true, name: true } } },
      });

      // By type
      const byType = new Map<string, number>();
      for (const a of activities) {
        byType.set(a.type, (byType.get(a.type) ?? 0) + 1);
      }

      // By user
      const byUser = new Map<string, { userId: string; userName: string; count: number }>();
      for (const a of activities) {
        const key = a.createdById;
        const existing = byUser.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          byUser.set(key, { userId: a.createdById, userName: a.createdBy.name ?? "Unknown", count: 1 });
        }
      }

      return {
        total: activities.length,
        byType: Array.from(byType.entries()).map(([type, count]) => ({ type, count })),
        byUser: Array.from(byUser.values()).sort((a, b) => b.count - a.count),
      };
    }),

  leadSourceReport: orgProcedure
    .query(async ({ ctx }) => {
      const leads = await ctx.db.crmLead.findMany({
        where: { organisationId: ctx.organisationId },
        select: { source: true, status: true },
      });

      const sourceMap = new Map<string, { total: number; converted: number }>();
      for (const lead of leads) {
        const existing = sourceMap.get(lead.source) ?? { total: 0, converted: 0 };
        existing.total += 1;
        if (lead.status === "CONVERTED") existing.converted += 1;
        sourceMap.set(lead.source, existing);
      }

      return Array.from(sourceMap.entries()).map(([source, { total, converted }]) => ({
        source,
        total,
        converted,
        conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
      }));
    }),

  salesForecast: orgProcedure
    .input(z.object({ months: z.number().int().min(1).max(12).default(6) }))
    .query(async ({ ctx, input }) => {
      const deals = await ctx.db.crmDeal.findMany({
        where: { organisationId: ctx.organisationId, closedAt: null },
        select: {
          id: true,
          value: true,
          probability: true,
          expectedCloseDate: true,
          closedAt: true,
          wonLostReason: true,
          createdAt: true,
        },
      });

      const all = calcWeightedForecast(deals.map((d) => ({ ...d, value: toNum(d.value) })));

      // Generate next N months slots
      const months: string[] = [];
      const now = new Date();
      for (let i = 0; i < input.months; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }

      const forecastMap = new Map(all.map((m) => [m.month, m]));
      return months.map((month) => forecastMap.get(month) ?? { month, totalValue: 0, weightedValue: 0, dealCount: 0 });
    }),
});
