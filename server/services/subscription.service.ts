import Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

function tierForSubscription(sub: Stripe.Subscription): "FREE" | "PRO" {
  const proMonthly = process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
  const proAnnual = process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
  const priceId = sub.items.data[0]?.price.id;
  if (priceId && (priceId === proMonthly || priceId === proAnnual)) return "PRO";
  return "FREE";
}

export async function getOrCreateStripeCustomer(
  prisma: PrismaClient,
  orgId: string,
  orgName: string,
  userEmail: string,
): Promise<string> {
  const stripe = getStripe();
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { stripeCustomerId: true } });

  if (org.stripeCustomerId) return org.stripeCustomerId;

  const customer = await stripe.customers.create({ name: orgName, email: userEmail, metadata: { organisationId: orgId } });
  await prisma.organisation.update({ where: { id: orgId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

export async function createCheckoutSession(
  prisma: PrismaClient,
  orgId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const stripe = getStripe();
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { stripeCustomerId: true, name: true } });
  const user = await prisma.user.findFirst({ where: { organisationId: orgId }, select: { email: true } });

  const customerId = org.stripeCustomerId ?? (await getOrCreateStripeCustomer(prisma, orgId, org.name, user?.email ?? ""));

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { organisationId: orgId },
  });

  return session.url ?? successUrl;
}

export async function createBillingPortalSession(
  prisma: PrismaClient,
  orgId: string,
  returnUrl: string,
): Promise<string> {
  const stripe = getStripe();
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { stripeCustomerId: true } });
  if (!org.stripeCustomerId) throw new Error("No Stripe customer found — upgrade first");

  const session = await stripe.billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: returnUrl });
  return session.url;
}

export async function handleWebhookEvent(prisma: PrismaClient, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const tier = tierForSubscription(sub);
      await prisma.organisation.updateMany({
        where: { stripeCustomerId: customerId },
        data: { subscriptionTier: tier, stripeSubscriptionId: sub.id },
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      await prisma.organisation.updateMany({
        where: { stripeCustomerId: customerId },
        data: { subscriptionTier: "FREE", stripeSubscriptionId: null },
      });
      break;
    }
    default:
      break;
  }
}

export async function checkUsageLimits(
  prisma: PrismaClient,
  orgId: string,
): Promise<{ withinLimits: boolean; aiExtractionCount: number; aiExtractionLimit: number }> {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { subscriptionTier: true, plan: true } });
  // `plan` is set by Lemon Squeezy; `subscriptionTier` by Stripe. Either being PRO = Pro access.
  const isPro = org.plan !== "FREE" || org.subscriptionTier !== "FREE";
  const limit = isPro ? Infinity : 3;

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const usage = await prisma.usageRecord.findUnique({ where: { organisationId_month: { organisationId: orgId, month } } });
  const count = usage?.aiExtractionCount ?? 0;

  return { withinLimits: count < limit, aiExtractionCount: count, aiExtractionLimit: isPro ? -1 : 3 };
}
