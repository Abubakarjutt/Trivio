import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { handleWebhookEvent } from "@/server/services/subscription.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig ?? "", webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  // Idempotency: skip if we've already successfully processed this event
  const existing = await db.webhookEvent.findUnique({
    where: { provider_eventId: { provider: "stripe", eventId: event.id } },
  });
  if (existing?.status === "OK") {
    return NextResponse.json({ received: true });
  }

  // Upsert a processing record — prevents duplicate work on concurrent retries
  const record = await db.webhookEvent.upsert({
    where: { provider_eventId: { provider: "stripe", eventId: event.id } },
    create: { provider: "stripe", eventId: event.id, status: "PROCESSING" },
    update: { status: "PROCESSING" },
  });

  try {
    await handleWebhookEvent(db, event);
    await db.webhookEvent.update({
      where: { id: record.id },
      data: { status: "OK", processedAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[stripe webhook] Error handling event:", err);
    await db.webhookEvent.update({
      where: { id: record.id },
      data: { status: "ERROR", error: message },
    }).catch(() => {});
    // Return 500 so Stripe retries the event on transient failures
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
