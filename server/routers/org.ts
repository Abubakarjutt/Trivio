import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, orgProcedure, publicProcedure } from "@/server/trpc";
import { seedDefaultChartOfAccounts } from "@/server/services/chart-of-accounts.service";

const SUPPORTED_CURRENCIES = [
  { code: "USD", name: "US Dollar" },
  { code: "GBP", name: "British Pound" },
  { code: "EUR", name: "Euro" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "INR", name: "Indian Rupee" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "AED", name: "UAE Dirham" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "ZAR", name: "South African Rand" },
  { code: "MYR", name: "Malaysian Ringgit" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "DKK", name: "Danish Krone" },
  { code: "PKR", name: "Pakistani Rupee" },
  { code: "BDT", name: "Bangladeshi Taka" },
  { code: "NGN", name: "Nigerian Naira" },
];

export const orgRouter = createTRPCRouter({
  getCurrencies: publicProcedure.query(() => SUPPORTED_CURRENCIES),

  getTaxRegimes: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.taxRegime.findMany({
      include: { rates: true },
      orderBy: { name: "asc" },
    });
  }),

  setupStep1: protectedProcedure
    .input(
      z.object({
        businessName: z.string().min(1),
        businessType: z.enum(["SOLE_TRADER", "PARTNERSHIP", "COMPANY", "OTHER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Guard: user must exist in DB (JWT can be stale after a DB reset or account deletion)
      const userExists = await ctx.db.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!userExists) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User account not found. Please sign out and sign in again." });
      }

      let org = await ctx.db.organisation.findFirst({
        where: { users: { some: { id: userId } } },
      });

      if (!org) {
        org = await ctx.db.organisation.create({
          data: {
            name: input.businessName,
            businessType: input.businessType,
            onboardingStep: "CURRENCY_TAX",
            users: { connect: { id: userId } },
          },
        });
        await ctx.db.user.update({
          where: { id: userId },
          data: { organisationId: org.id, role: "OWNER" },
        });
      } else {
        org = await ctx.db.organisation.update({
          where: { id: org.id },
          data: {
            name: input.businessName,
            businessType: input.businessType,
            onboardingStep: "CURRENCY_TAX",
          },
        });
      }
      return org;
    }),

  setupStep2: protectedProcedure
    .input(
      z.object({
        currency: z.string().length(3),
        taxRegimeId: z.string().optional(),
        fiscalYearStartMonth: z.number().min(1).max(12),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        include: { organisation: true },
      });
      if (!user?.organisationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Complete step 1 first" });
      }

      const org = await ctx.db.organisation.update({
        where: { id: user.organisationId },
        data: {
          currency: input.currency,
          taxRegimeId: input.taxRegimeId ?? null,
          fiscalYearStartMonth: input.fiscalYearStartMonth,
          onboardingStep: "COMPLETE",
          onboardingComplete: true,
        },
      });

      await seedDefaultChartOfAccounts(ctx.db, org.id);

      return org;
    }),

  get: orgProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const org = await ctx.db.organisation.findUnique({
      where: { id: ctx.organisationId },
      include: { taxRegime: { include: { rates: true } } },
    });

    // Use the canonical usageRecord counter — this is what the gate enforces
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const usageRecord = await ctx.db.usageRecord.findUnique({
      where: { organisationId_month: { organisationId: ctx.organisationId, month } },
      select: { aiExtractionCount: true },
    });
    const aiExtractionsUsed = usageRecord?.aiExtractionCount ?? 0;

    return { ...org, aiExtractionsUsed };
  }),

  update: orgProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        fiscalYearStartMonth: z.number().min(1).max(12).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.organisation.update({
        where: { id: ctx.organisationId },
        data: input,
      });
    }),

  setCurrency: orgProcedure
    .input(z.object({ currency: z.string().min(3).max(3) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.organisation.update({ where: { id: ctx.organisationId }, data: { currency: input.currency } });
      return { success: true };
    }),

  resetEmailImportToken: orgProcedure.mutation(async ({ ctx }) => {
    const { createId } = await import("@paralleldrive/cuid2");
    const newToken = createId();
    const updated = await ctx.db.organisation.update({
      where: { id: ctx.organisationId },
      data: { emailImportToken: newToken },
      select: { emailImportToken: true },
    });
    return { emailImportToken: updated.emailImportToken };
  }),
});

