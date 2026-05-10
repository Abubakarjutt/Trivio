import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import {
  createCheckoutSession,
  createBillingPortalSession,
  checkUsageLimits,
} from "@/server/services/subscription.service";

const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export const subscriptionRouter = createTRPCRouter({
  getStatus: orgProcedure.query(async ({ ctx }) => {
    const { organisationId, organisation } = ctx;
    const limits = await checkUsageLimits(ctx.db, organisationId);
    return {
      tier: organisation.subscriptionTier,
      ...limits,
    };
  }),

  createCheckoutSession: orgProcedure
    .input(z.object({ plan: z.enum(["pro_monthly", "pro_annual"]) }))
    .mutation(async ({ ctx, input }) => {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe is not configured" });

      const priceId =
        input.plan === "pro_monthly"
          ? process.env.STRIPE_PRO_MONTHLY_PRICE_ID
          : process.env.STRIPE_PRO_ANNUAL_PRICE_ID;

      if (!priceId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Price ID not configured" });

      const url = await createCheckoutSession(
        ctx.db,
        ctx.organisationId,
        priceId,
        `${appUrl}/settings/billing?success=1`,
        `${appUrl}/settings/billing`,
      );

      return { url };
    }),

  createPortalSession: orgProcedure.mutation(async ({ ctx }) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe is not configured" });

    const url = await createBillingPortalSession(ctx.db, ctx.organisationId, `${appUrl}/settings/billing`);
    return { url };
  }),
});
