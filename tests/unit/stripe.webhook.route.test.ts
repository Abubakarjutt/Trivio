/**
 * Stripe webhook API route tests
 *
 * Tests the POST handler in app/api/webhooks/stripe/route.ts directly.
 * Stripe SDK and all DB calls are fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── mocks ────────────────────────────────────────────────────────────────────

// Mock Stripe constructor and its webhooks.constructEvent
const mockConstructEvent = vi.fn();
vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      webhooks: {
        constructEvent: mockConstructEvent,
      },
    })),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    webhookEvent: {
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ id: "wh-record-1", status: "PROCESSING" }),
      update: vi.fn().mockResolvedValue({ id: "wh-record-1", status: "OK" }),
    },
    organisation: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

vi.mock("@/server/services/subscription.service", () => ({
  handleWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "@/app/api/webhooks/stripe/route";
import { db } from "@/lib/db";
import { handleWebhookEvent } from "@/server/services/subscription.service";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body = "raw-stripe-payload", sig = "stripe-sig-value"): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "stripe-signature": sig,
      "content-type": "application/json",
    },
    body,
  });
}

function makeSubscriptionEvent(
  type: string,
  customerId: string,
  subId = "sub-1",
  priceId = "price_free"
): Record<string, unknown> {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    type,
    data: {
      object: {
        id: subId,
        customer: customerId,
        items: {
          data: [{ price: { id: priceId } }],
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
  process.env.STRIPE_PRO_MONTHLY_PRICE_ID = "price_pro_monthly";
  process.env.STRIPE_PRO_ANNUAL_PRICE_ID = "price_pro_annual";
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/stripe", () => {
  // ── missing configuration ──────────────────────────────────────────────────

  it("returns 500 when STRIPE_WEBHOOK_SECRET is not set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const req = makeRequest();
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/webhook secret not configured/i);
  });

  it("returns 500 when STRIPE_SECRET_KEY is not set", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const req = makeRequest();
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/stripe not configured/i);
  });

  // ── signature verification ─────────────────────────────────────────────────

  it("returns 400 when stripe signature verification fails", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload.");
    });
    const req = makeRequest("bad-payload", "bad-sig");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/signature verification failed/i);
  });

  it("returns 400 for a missing stripe-signature header", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No stripe-signature header value was provided.");
    });
    const req = makeRequest("payload", "");
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── idempotency ────────────────────────────────────────────────────────────

  it("returns 200 without re-processing when event is already recorded as OK", async () => {
    const event = makeSubscriptionEvent("customer.subscription.created", "cus-1");
    mockConstructEvent.mockReturnValue(event);
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue({
      id: "wh-record-1",
      status: "OK",
    } as never);
    const req = makeRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(handleWebhookEvent).not.toHaveBeenCalled();
  });

  // ── customer.subscription.created ─────────────────────────────────────────

  it("processes customer.subscription.created event and returns 200", async () => {
    const event = makeSubscriptionEvent("customer.subscription.created", "cus-1");
    mockConstructEvent.mockReturnValue(event);
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null);
    const req = makeRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(handleWebhookEvent).toHaveBeenCalledWith(db, event);
  });

  it("upserts a PROCESSING webhook record before handling the event", async () => {
    const event = makeSubscriptionEvent("customer.subscription.created", "cus-1", "sub-new");
    mockConstructEvent.mockReturnValue(event);
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null);
    const req = makeRequest();
    await POST(req);
    expect(db.webhookEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ provider: "stripe", eventId: event.id as string, status: "PROCESSING" }),
        update: { status: "PROCESSING" },
      })
    );
  });

  it("marks webhook record as OK after successful processing", async () => {
    const event = makeSubscriptionEvent("customer.subscription.updated", "cus-1");
    mockConstructEvent.mockReturnValue(event);
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.webhookEvent.upsert).mockResolvedValue({ id: "wh-record-1" } as never);
    const req = makeRequest();
    await POST(req);
    expect(db.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wh-record-1" },
        data: expect.objectContaining({ status: "OK" }),
      })
    );
  });

  // ── customer.subscription.updated ─────────────────────────────────────────

  it("processes customer.subscription.updated event and returns 200", async () => {
    const event = makeSubscriptionEvent("customer.subscription.updated", "cus-2", "sub-2");
    mockConstructEvent.mockReturnValue(event);
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null);
    const req = makeRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(handleWebhookEvent).toHaveBeenCalledWith(db, event);
  });

  // ── customer.subscription.deleted ─────────────────────────────────────────

  it("processes customer.subscription.deleted event and returns 200", async () => {
    const event = makeSubscriptionEvent("customer.subscription.deleted", "cus-3", "sub-3");
    mockConstructEvent.mockReturnValue(event);
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null);
    const req = makeRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(handleWebhookEvent).toHaveBeenCalledWith(db, event);
  });

  // ── unknown event type ─────────────────────────────────────────────────────

  it("returns 200 for unknown event types without calling handleWebhookEvent failure", async () => {
    const event = {
      id: "evt-unknown",
      type: "invoice.payment_failed",
      data: { object: {} },
    };
    mockConstructEvent.mockReturnValue(event);
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null);
    const req = makeRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  // ── error handling ─────────────────────────────────────────────────────────

  it("marks webhook record as ERROR when handleWebhookEvent throws", async () => {
    const event = makeSubscriptionEvent("customer.subscription.created", "cus-error");
    mockConstructEvent.mockReturnValue(event);
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.webhookEvent.upsert).mockResolvedValue({ id: "wh-record-err" } as never);
    vi.mocked(handleWebhookEvent).mockRejectedValue(new Error("Service failure"));

    const req = makeRequest();
    const res = await POST(req);
    // Still returns 200 to prevent Stripe retry loops
    expect(res.status).toBe(200);
    expect(db.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wh-record-err" },
        data: expect.objectContaining({ status: "ERROR", error: "Service failure" }),
      })
    );
  });

  it("returns received:true in all success response bodies", async () => {
    const event = makeSubscriptionEvent("customer.subscription.created", "cus-1");
    mockConstructEvent.mockReturnValue(event);
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null);
    const req = makeRequest();
    const res = await POST(req);
    const json = await res.json();
    expect(json.received).toBe(true);
  });
});
