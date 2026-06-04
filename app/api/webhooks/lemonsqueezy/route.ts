import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/lemonsqueezy";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("X-Signature") ?? "";
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName: string = payload?.meta?.event_name ?? "";
  const orgId: string = payload?.meta?.custom_data?.org_id ?? "";
  const userEmail: string = payload?.data?.attributes?.user_email ?? "";
  const subscriptionId: string = payload?.data?.id ?? "";
  const customerId: string = String(payload?.data?.attributes?.customer_id ?? "");
  const status: string = payload?.data?.attributes?.status ?? "";

  let org: { id: string } | null = null;
  if (orgId) {
    org = await db.organisation.findFirst({ where: { id: orgId }, select: { id: true } });
  } else if (userEmail) {
    const user = await db.user.findUnique({
      where: { email: userEmail },
      select: { organisationId: true },
    });
    if (user?.organisationId) {
      org = { id: user.organisationId };
    }
  }

  if (!org) {
    return NextResponse.json({ ok: true });
  }

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
      await db.organisation.update({
        where: { id: org.id },
        data: { lsSubscriptionStatus: "cancelled" },
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

  return NextResponse.json({ ok: true });
}

function mapStatus(status: string): "active" | "cancelled" | "past_due" | "expired" | "paused" {
  if (status === "active") return "active";
  if (status === "cancelled") return "cancelled";
  if (status === "past_due") return "past_due";
  if (status === "paused") return "paused";
  return "expired";
}
