import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/lemonsqueezy";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("X-Signature") ?? "";
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[lemonsqueezy] LEMONSQUEEZY_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  type LsPayload = {
    meta?: { event_name?: string; webhook_id?: string; custom_data?: { org_id?: string } };
    data?: { id?: string; attributes?: { user_email?: string; customer_id?: number | string; status?: string } };
  };
  let payload: LsPayload;
  try {
    payload = JSON.parse(rawBody) as LsPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName: string = payload?.meta?.event_name ?? "";
  const eventId: string = payload?.meta?.webhook_id ?? payload?.data?.id ?? "";
  const orgId: string = payload?.meta?.custom_data?.org_id ?? "";
  const userEmail: string = payload?.data?.attributes?.user_email ?? "";
  const subscriptionId: string = payload?.data?.id ?? "";
  const customerId: string = String(payload?.data?.attributes?.customer_id ?? "");
  const status: string = payload?.data?.attributes?.status ?? "";

  // Idempotency: skip if we've already successfully processed this event
  if (eventId) {
    const existing = await db.webhookEvent.findUnique({
      where: { provider_eventId: { provider: "lemonsqueezy", eventId } },
    });
    if (existing?.status === "OK") {
      return NextResponse.json({ ok: true });
    }
  }

  // Upsert a processing record
  const record = eventId
    ? await db.webhookEvent.upsert({
        where: { provider_eventId: { provider: "lemonsqueezy", eventId } },
        create: { provider: "lemonsqueezy", eventId, status: "PROCESSING" },
        update: { status: "PROCESSING" },
      })
    : null;

  try {
    let org: { id: string } | null = null;
    if (orgId) {
      // Cross-validate: the paying user's email must belong to the org in custom_data.
      // This prevents an attacker from tampering the org_id in the checkout URL
      // to upgrade a different organisation on someone else's payment.
      if (userEmail) {
        const orgUser = await db.user.findFirst({
          where: { email: userEmail, organisationId: orgId },
          select: { organisationId: true },
        });
        if (orgUser) {
          org = { id: orgId };
        }
        // Fallback: if cross-check fails, resolve by email only
        if (!org) {
          const user = await db.user.findUnique({
            where: { email: userEmail },
            select: { organisationId: true },
          });
          if (user?.organisationId) {
            org = { id: user.organisationId };
          }
        }
      } else {
        org = await db.organisation.findFirst({ where: { id: orgId }, select: { id: true } });
      }
    } else if (userEmail) {
      const user = await db.user.findUnique({
        where: { email: userEmail },
        select: { organisationId: true },
      });
      if (user?.organisationId) {
        org = { id: user.organisationId };
      }
    }

    if (org) {
      switch (eventName) {
        case "subscription_created":
        case "subscription_updated":
          await db.organisation.update({
            where: { id: org.id },
            data: {
              plan: status === "expired" || status === "cancelled" ? "FREE" : "PRO",
              lsCustomerId: customerId,
              lsSubscriptionId: subscriptionId,
              lsSubscriptionStatus: mapStatus(status),
            },
          });
          break;

        case "subscription_cancelled":
          // Downgrade immediately — LS may not send subscription_updated after this
          await db.organisation.update({
            where: { id: org.id },
            data: { plan: "FREE", lsSubscriptionStatus: "cancelled" },
          });
          break;

        case "subscription_expired":
          await db.organisation.update({
            where: { id: org.id },
            data: {
              plan: "FREE",
              lsSubscriptionStatus: "expired",
              lsSubscriptionId: null,
            },
          });
          break;
      }
    }

    if (record) {
      await db.webhookEvent.update({
        where: { id: record.id },
        data: { status: "OK", processedAt: new Date() },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[lemonsqueezy webhook] Error handling event:", err);
    if (record) {
      await db.webhookEvent.update({
        where: { id: record.id },
        data: { status: "ERROR", error: message },
      }).catch(() => {});
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function mapStatus(status: string): "active" | "cancelled" | "past_due" | "expired" | "paused" {
  if (status === "active") return "active";
  if (status === "cancelled") return "cancelled";
  if (status === "past_due") return "past_due";
  if (status === "paused") return "paused";
  return "expired";
}
