import { z } from "zod";
import { createTRPCRouter, orgProcedure } from "../trpc";
import { closeCycle, listPeriods, reopenCycle, setCycleStart } from "../services/pf-cycle.service";

// Personal Finance months that follow the user's pay cycle: open until the
// user presses "Close month" (see services/pf-cycle.service.ts).

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const pfCyclesRouter = createTRPCRouter({
  /** Every period, oldest first; the last one is the open (current) month. */
  list: orgProcedure.query(({ ctx }) => listPeriods(ctx.db, ctx.organisationId)),

  /** Close the current month. The new one starts on `startsOn` (default today, i.e. pay day),
   *  or the day after `endDate` when the closed month's last day is given instead. */
  close: orgProcedure
    .input(z.object({ endDate: day.optional(), startsOn: day.optional() }))
    .mutation(({ ctx, input }) => closeCycle(ctx.db, ctx.organisationId, input)),

  /** Undo the last close — the previous month continues. */
  reopen: orgProcedure.mutation(({ ctx }) => reopenCycle(ctx.db, ctx.organisationId)),

  /** Change the day the current month started (e.g. the day the salary arrived). */
  setStart: orgProcedure
    .input(z.object({ startDate: day }))
    .mutation(({ ctx, input }) => setCycleStart(ctx.db, ctx.organisationId, input.startDate)),
});
