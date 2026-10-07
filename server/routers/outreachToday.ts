import { createTRPCRouter } from "@/server/trpc";
import { loadConfig } from "@/server/services/outreach/config";
import { todayForOrg } from "@/server/services/outreach/today-service";
import { outreachProcedure } from "./outreach-procedure";

export const outreachTodayRouter = createTRPCRouter({
  get: outreachProcedure.query(async ({ ctx }) => {
    const config = await loadConfig(ctx.db, ctx.organisationId);
    if (!config) return { configured: false as const };
    return {
      configured: true as const,
      ...(await todayForOrg(ctx.db, ctx.organisationId, new Date(), config)),
    };
  }),
});
