// app/api/webhooks/lemonsqueezy/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    webhookEvent: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    organisation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/lemonsqueezy", () => ({
  verifyWebhookSignature: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST } from "@/app/api/webhooks/lemonsqueezy/route";
import { db } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/lemonsqueezy";

// ── Setup ─────────────────────────────────────────────────────────────────────

const originalEnv = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

beforeEach(() => {
  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "test-secret";
  vi.clearAllMocks();

  // Default mock returns
  vi.mocked(verifyWebhookSignature).mockReturnValue(true);
  vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null as any);
  vi.mocked(db.webhookEvent.upsert).mockResolvedValue({
    id: "evt-1",
    status: "PROCESSING",
  } as any);
  vi.mocked(db.webhookEvent.update).mockResolvedValue({} as any);
  vi.mocked(db.organisation.findFirst).mockResolvedValue({ id: "org-1" } as any);
  vi.mocked(db.organisation.update).mockResolvedValue({} as any);
  vi.mocked(db.user.findUnique).mockResolvedValue(null as any);
});

afterEach(() => {
  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = originalEnv;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: object, sig = "valid-sig") {
  const rawBody = JSON.stringify(body);
  return new NextRequest("http://localhost/api/webhooks/lemonsqueezy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": sig,
    },
    body: rawBody,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/lemonsqueezy", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: 500 — LEMONSQUEEZY_WEBHOOK_SECRET not set
  // ──────────────────────────────────────────────────────────────────────────
  it("should return 500 if LEMONSQUEEZY_WEBHOOK_SECRET is not set", async () => {
    delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    const req = makeReq({
      meta: { event_name: "subscription_created" },
      data: { id: "sub-1" },
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Webhook not configured");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: 401 — invalid signature
  // ──────────────────────────────────────────────────────────────────────────
  it("should return 401 if signature is invalid", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(false);

    const req = makeReq(
      {
        meta: { event_name: "subscription_created" },
        data: { id: "sub-1" },
      },
      "bad-sig"
    );

    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid signature");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: 400 — invalid JSON body
  // ──────────────────────────────────────────────────────────────────────────
  it("should return 400 if JSON is invalid", async () => {
    const req = new NextRequest("http://localhost/api/webhooks/lemonsqueezy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": "valid-sig",
      },
      body: "{invalid json}",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: 200 (idempotency) — webhook already processed
  // ──────────────────────────────────────────────────────────────────────────
  it("should return 200 without updating org if event already processed (idempotency)", async () => {
    vi.mocked(db.webhookEvent.findUnique).mockResolvedValue({
      id: "evt-1",
      status: "OK",
      processedAt: new Date(),
    } as any);

    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        webhook_id: "wh-123",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-1",
        attributes: {
          customer_id: 999,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Should NOT upsert or update organisation
    expect(vi.mocked(db.webhookEvent.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked(db.organisation.update)).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: subscription_created — org found by orgId, plan: "PRO"
  // ──────────────────────────────────────────────────────────────────────────
  it("should set plan to PRO and store subscription details on subscription_created", async () => {
    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        webhook_id: "wh-123",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.organisation.update)).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        plan: "PRO",
        lsCustomerId: "789",
        lsSubscriptionId: "sub-456",
        lsSubscriptionStatus: "active",
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: subscription_updated — same as created
  // ──────────────────────────────────────────────────────────────────────────
  it("should handle subscription_updated the same as subscription_created", async () => {
    const req = makeReq({
      meta: {
        event_name: "subscription_updated",
        webhook_id: "wh-124",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.organisation.update)).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        plan: "PRO",
        lsCustomerId: "789",
        lsSubscriptionId: "sub-456",
        lsSubscriptionStatus: "active",
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7: subscription_created with status "expired" → plan: "FREE"
  // ──────────────────────────────────────────────────────────────────────────
  it("should set plan to FREE if status is expired on subscription_created", async () => {
    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        webhook_id: "wh-125",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "expired",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.organisation.update)).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        plan: "FREE",
        lsCustomerId: "789",
        lsSubscriptionId: "sub-456",
        lsSubscriptionStatus: "expired",
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 8: subscription_cancelled → plan: "FREE", lsSubscriptionStatus: "cancelled"
  // ──────────────────────────────────────────────────────────────────────────
  it("should set plan to FREE and mark as cancelled on subscription_cancelled", async () => {
    const req = makeReq({
      meta: {
        event_name: "subscription_cancelled",
        webhook_id: "wh-126",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "cancelled",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.organisation.update)).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        plan: "FREE",
        lsSubscriptionStatus: "cancelled",
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 9: subscription_expired → plan: "FREE", lsSubscriptionId: null
  // ──────────────────────────────────────────────────────────────────────────
  it("should set plan to FREE and clear subscriptionId on subscription_expired", async () => {
    const req = makeReq({
      meta: {
        event_name: "subscription_expired",
        webhook_id: "wh-127",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "expired",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.organisation.update)).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        plan: "FREE",
        lsSubscriptionStatus: "expired",
        lsSubscriptionId: null,
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 10: org lookup by userEmail when no orgId provided
  // ──────────────────────────────────────────────────────────────────────────
  it("should lookup organisation by userEmail when orgId is missing", async () => {
    vi.mocked(db.organisation.findFirst).mockResolvedValue(null as any);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      organisationId: "org-user-1",
    } as any);

    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        webhook_id: "wh-128",
      },
      data: {
        id: "sub-789",
        attributes: {
          user_email: "user@example.com",
          customer_id: 999,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.user.findUnique)).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      select: { organisationId: true },
    });
    expect(vi.mocked(db.organisation.update)).toHaveBeenCalledWith({
      where: { id: "org-user-1" },
      data: expect.objectContaining({
        plan: "PRO",
        lsSubscriptionId: "sub-789",
      }),
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 11: org not found → no update called
  // ──────────────────────────────────────────────────────────────────────────
  it("should not update org if organisation is not found", async () => {
    vi.mocked(db.organisation.findFirst).mockResolvedValue(null as any);
    vi.mocked(db.user.findUnique).mockResolvedValue(null as any);

    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        webhook_id: "wh-129",
      },
      data: {
        id: "sub-999",
        attributes: {
          user_email: "unknown@example.com",
          customer_id: 999,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.organisation.update)).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 12: record marked OK after successful processing
  // ──────────────────────────────────────────────────────────────────────────
  it("should mark webhookEvent as OK after successful processing", async () => {
    vi.mocked(db.webhookEvent.upsert).mockResolvedValue({
      id: "evt-2",
      status: "PROCESSING",
    } as any);

    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        webhook_id: "wh-130",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.webhookEvent.update)).toHaveBeenCalledWith({
      where: { id: "evt-2" },
      data: {
        status: "OK",
        processedAt: expect.any(Date),
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 13: no eventId → record is null, no upsert called
  // ──────────────────────────────────────────────────────────────────────────
  it("should not upsert webhookEvent if no eventId is present", async () => {
    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        // no webhook_id
      },
      data: {
        // no id
        attributes: {
          user_email: "user@example.com",
          customer_id: 789,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.webhookEvent.upsert)).not.toHaveBeenCalled();
    expect(vi.mocked(db.webhookEvent.update)).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 14: subscription with "cancelled" status in subscription_created/updated
  // ──────────────────────────────────────────────────────────────────────────
  it("should set plan to FREE if status is cancelled on subscription_created", async () => {
    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        webhook_id: "wh-131",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "cancelled",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.organisation.update)).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        plan: "FREE",
        lsCustomerId: "789",
        lsSubscriptionId: "sub-456",
        lsSubscriptionStatus: "cancelled",
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 15: unknown event type → org update skipped but response OK
  // ──────────────────────────────────────────────────────────────────────────
  it("should skip org update for unknown event types but return 200", async () => {
    const req = makeReq({
      meta: {
        event_name: "unknown_event",
        webhook_id: "wh-132",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    // Should not call org.update since event name doesn't match any case
    expect(vi.mocked(db.organisation.update)).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 16: database error during processing → 500, record marked ERROR
  // ──────────────────────────────────────────────────────────────────────────
  it("should return 500 and mark event as ERROR if db operation fails", async () => {
    vi.mocked(db.webhookEvent.upsert).mockResolvedValue({
      id: "evt-3",
      status: "PROCESSING",
    } as any);
    vi.mocked(db.organisation.update).mockRejectedValue(
      new Error("Database error")
    );

    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        webhook_id: "wh-133",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Internal error");

    // Should attempt to mark record as ERROR
    expect(vi.mocked(db.webhookEvent.update)).toHaveBeenCalledWith({
      where: { id: "evt-3" },
      data: {
        status: "ERROR",
        error: "Database error",
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 17: unknown error type (not Error instance)
  // ──────────────────────────────────────────────────────────────────────────
  it("should handle non-Error exceptions gracefully", async () => {
    vi.mocked(db.webhookEvent.upsert).mockResolvedValue({
      id: "evt-4",
      status: "PROCESSING",
    } as any);
    vi.mocked(db.organisation.update).mockRejectedValue("Unknown error");

    const req = makeReq({
      meta: {
        event_name: "subscription_created",
        webhook_id: "wh-134",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "active",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(vi.mocked(db.webhookEvent.update)).toHaveBeenCalledWith({
      where: { id: "evt-4" },
      data: {
        status: "ERROR",
        error: "Unknown error",
      },
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 18: mapStatus function behavior for different statuses
  // ──────────────────────────────────────────────────────────────────────────
  it("should correctly map subscription statuses", async () => {
    const statuses = [
      { input: "active", expected: "active" },
      { input: "cancelled", expected: "cancelled" },
      { input: "past_due", expected: "past_due" },
      { input: "paused", expected: "paused" },
      { input: "expired", expected: "expired" },
      { input: "unknown", expected: "expired" }, // default
    ];

    for (const { input, expected } of statuses) {
      vi.clearAllMocks();
      vi.mocked(verifyWebhookSignature).mockReturnValue(true);
      vi.mocked(db.webhookEvent.findUnique).mockResolvedValue(null as any);
      vi.mocked(db.webhookEvent.upsert).mockResolvedValue({
        id: "evt-x",
        status: "PROCESSING",
      } as any);
      vi.mocked(db.organisation.findFirst).mockResolvedValue({
        id: "org-1",
      } as any);
      vi.mocked(db.organisation.update).mockResolvedValue({} as any);
      vi.mocked(db.webhookEvent.update).mockResolvedValue({} as any);

      const req = makeReq({
        meta: {
          event_name: "subscription_created",
          webhook_id: `wh-status-${input}`,
          custom_data: { org_id: "org-1" },
        },
        data: {
          id: "sub-456",
          attributes: {
            customer_id: 789,
            status: input,
          },
        },
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(vi.mocked(db.organisation.update)).toHaveBeenCalledWith({
        where: { id: "org-1" },
        data: expect.objectContaining({
          lsSubscriptionStatus: expected,
        }),
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 19: signature verification is called with correct params
  // ──────────────────────────────────────────────────────────────────────────
  it("should verify signature with correct parameters", async () => {
    const payload = {
      meta: { event_name: "subscription_created" },
      data: { id: "sub-1" },
    };
    const sig = "test-signature";
    const rawBody = JSON.stringify(payload);

    const req = new NextRequest("http://localhost/api/webhooks/lemonsqueezy", {
      method: "POST",
      headers: {
        "X-Signature": sig,
      },
      body: rawBody,
    });

    await POST(req);

    expect(vi.mocked(verifyWebhookSignature)).toHaveBeenCalledWith(
      rawBody,
      sig,
      "test-secret"
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 20: multiple statuses including past_due
  // ──────────────────────────────────────────────────────────────────────────
  it("should handle past_due status correctly", async () => {
    const req = makeReq({
      meta: {
        event_name: "subscription_updated",
        webhook_id: "wh-135",
        custom_data: { org_id: "org-1" },
      },
      data: {
        id: "sub-456",
        attributes: {
          customer_id: 789,
          status: "past_due",
        },
      },
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(vi.mocked(db.organisation.update)).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: expect.objectContaining({
        plan: "PRO",
        lsSubscriptionStatus: "past_due",
      }),
    });
  });
});
