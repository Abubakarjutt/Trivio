import { z } from "zod";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import {
  getProfitAndLoss,
  getBalanceSheet,
  getTrialBalance,
  getTaxSummary,
} from "@/server/services/report.service";

export const reportsRouter = createTRPCRouter({
  profitAndLoss: orgProcedure
    .input(
      z.object({
        from: z.string(), // ISO date string
        to: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await getProfitAndLoss(ctx.db, ctx.organisationId, {
        from: new Date(input.from),
        to: new Date(input.to),
      });
      return {
        accounts: result.accounts.map((a) => ({
          ...a,
          total: a.total.toFixed(4),
        })),
        totalIncome: result.totalIncome.toFixed(4),
        totalExpenses: result.totalExpenses.toFixed(4),
        netProfit: result.netProfit.toFixed(4),
      };
    }),

  balanceSheet: orgProcedure
    .input(
      z.object({
        asOf: z.string(), // ISO date string
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await getBalanceSheet(ctx.db, ctx.organisationId, new Date(input.asOf));
      return {
        assets: result.assets.map((a) => ({ ...a, total: a.total.toFixed(4) })),
        liabilities: result.liabilities.map((a) => ({ ...a, total: a.total.toFixed(4) })),
        equity: result.equity.map((a) => ({ ...a, total: a.total.toFixed(4) })),
        totalAssets: result.totalAssets.toFixed(4),
        totalLiabilities: result.totalLiabilities.toFixed(4),
        totalEquity: result.totalEquity.toFixed(4),
      };
    }),

  trialBalance: orgProcedure
    .input(
      z.object({
        from: z.string(),
        to: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await getTrialBalance(ctx.db, ctx.organisationId, {
        from: new Date(input.from),
        to: new Date(input.to),
      });
      return {
        accounts: result.accounts.map((a) => ({
          ...a,
          totalDebit: a.totalDebit.toFixed(4),
          totalCredit: a.totalCredit.toFixed(4),
          balance: a.balance.toFixed(4),
        })),
        totalDebits: result.totalDebits.toFixed(4),
        totalCredits: result.totalCredits.toFixed(4),
      };
    }),

  taxSummary: orgProcedure
    .input(
      z.object({
        from: z.string(),
        to: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await getTaxSummary(ctx.db, ctx.organisationId, {
        from: new Date(input.from),
        to: new Date(input.to),
      });
      return {
        outputTax: result.outputTax.toFixed(4),
        inputTax: result.inputTax.toFixed(4),
        netTaxPayable: result.netTaxPayable.toFixed(4),
        invoiceCount: result.invoiceCount,
        billCount: result.billCount,
      };
    }),
});
