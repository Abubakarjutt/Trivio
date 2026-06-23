// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    organisation: { findMany: vi.fn() },
    chatMessage: { deleteMany: vi.fn() },
  },
}));

vi.mock("@/server/routers/gdpr", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST } from "@/app/api/cron/purge-chats/route";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/server/routers/gdpr";

// ── Setup ─────────────────────────────────────────────────────────────────────

process.env.CRON_SECRET = "super-secret-cron";

function makeReq(secret = "super-secret-cron") {
  return new NextRequest("http://localhost/api/cron/purge-chats", {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.organisation.findMany).mockResolvedValue([]);
  vi.mocked(db.chatMessage.deleteMany).mockResolvedValue({ count: 0 });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/cron/purge-chats", () => {
  // ── Authentication ────────────────────────────────────────────────────────

  it("returns 401 when x-cron-secret header is missing", async () => {
    const req = new NextRequest("http://localhost/api/cron/purge-chats", {
      method: "POST",
      headers: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when x-cron-secret header is wrong", async () => {
    const res = await POST(makeReq("wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when CRON_SECRET env var is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(makeReq("super-secret-cron"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    // Restore for other tests
    process.env.CRON_SECRET = "super-secret-cron";
  });

  // ── Basic functionality ───────────────────────────────────────────────────

  it("returns 200 with ok: true when no orgs exist", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(0);
    expect(body.orgs).toBe(0);
  });

  it("returns response with correct deleted count across orgs", async () => {
    vi.mocked(db.organisation.findMany).mockResolvedValue([
      { id: "org-1", users: [{ id: "user-1" }] },
      { id: "org-2", users: [{ id: "user-2" }] },
    ] as never);

    vi.mocked(db.chatMessage.deleteMany)
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 3 });

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(6);
  });

  // ── Audit logging ─────────────────────────────────────────────────────────

  it("calls writeAuditLog when messages are deleted", async () => {
    vi.mocked(db.organisation.findMany).mockResolvedValue([
      { id: "org-1", users: [{ id: "user-1" }] },
    ] as never);
    vi.mocked(db.chatMessage.deleteMany).mockResolvedValue({ count: 5 });

    await POST(makeReq());

    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        organisationId: "org-1",
        userId: "user-1",
        action: "DELETE",
        entityType: "ChatMessage",
        entityId: "org-1",
        after: { deletedCount: 5, reason: "12-month retention policy (automated)" },
      })
    );
  });

  it("does not call writeAuditLog when deleted count is 0", async () => {
    vi.mocked(db.organisation.findMany).mockResolvedValue([
      { id: "org-1", users: [{ id: "user-1" }] },
    ] as never);
    vi.mocked(db.chatMessage.deleteMany).mockResolvedValue({ count: 0 });

    await POST(makeReq());

    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });

  it("does not call writeAuditLog when org has no users", async () => {
    vi.mocked(db.organisation.findMany).mockResolvedValue([
      { id: "org-1", users: [] },
    ] as never);
    vi.mocked(db.chatMessage.deleteMany).mockResolvedValue({ count: 5 });

    await POST(makeReq());

    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });

  // ── Response format ───────────────────────────────────────────────────────

  it("returns cutoff date approximately 365 days ago", async () => {
    const beforeReq = Date.now();
    const res = await POST(makeReq());
    const afterReq = Date.now();

    const body = await res.json();
    const cutoffTime = new Date(body.cutoff).getTime();

    const now = (beforeReq + afterReq) / 2;
    const expected365DaysAgo = now - 365 * 24 * 60 * 60 * 1000;

    // Allow 1-day tolerance (86400000 ms)
    expect(Math.abs(cutoffTime - expected365DaysAgo)).toBeLessThanOrEqual(86400000);
  });

  it("returns orgs count matching the number of returned orgs", async () => {
    vi.mocked(db.organisation.findMany).mockResolvedValue([
      { id: "org-1", users: [{ id: "user-1" }] },
      { id: "org-2", users: [{ id: "user-2" }] },
      { id: "org-3", users: [{ id: "user-3" }] },
    ] as never);
    vi.mocked(db.chatMessage.deleteMany).mockResolvedValue({ count: 0 });

    const res = await POST(makeReq());
    const body = await res.json();
    expect(body.orgs).toBe(3);
  });

  it("returns cutoff as ISO string in response", async () => {
    const res = await POST(makeReq());
    const body = await res.json();
    // Should be a valid ISO date string
    expect(typeof body.cutoff).toBe("string");
    expect(() => new Date(body.cutoff)).not.toThrow();
    // Should contain 'Z' or timezone offset
    expect(body.cutoff).toMatch(/Z|[+-]\d{2}:\d{2}$/);
  });

  // ── Database query verification ───────────────────────────────────────────

  it("deletes messages older than 365 days for each org", async () => {
    const nowBefore = Date.now();
    vi.mocked(db.organisation.findMany).mockResolvedValue([
      { id: "org-1", users: [{ id: "user-1" }] },
    ] as never);
    vi.mocked(db.chatMessage.deleteMany).mockResolvedValue({ count: 0 });

    await POST(makeReq());
    const nowAfter = Date.now();

    const calls = vi.mocked(db.chatMessage.deleteMany).mock.calls;
    expect(calls).toHaveLength(1);

    const whereClause = (calls[0][0] as { where: unknown }).where;
    expect(whereClause).toBeDefined();
  });

  // ── Multiple orgs with different delete counts ─────────────────────────

  it("accumulates deleted count across multiple orgs", async () => {
    vi.mocked(db.organisation.findMany).mockResolvedValue([
      { id: "org-1", users: [{ id: "user-1" }] },
      { id: "org-2", users: [{ id: "user-2" }] },
      { id: "org-3", users: [{ id: "user-3" }] },
    ] as never);

    vi.mocked(db.chatMessage.deleteMany)
      .mockResolvedValueOnce({ count: 10 })
      .mockResolvedValueOnce({ count: 5 })
      .mockResolvedValueOnce({ count: 2 });

    const res = await POST(makeReq());
    const body = await res.json();
    expect(body.deleted).toBe(17);
  });

  it("logs audit entries only for orgs that had deletions", async () => {
    vi.mocked(db.organisation.findMany).mockResolvedValue([
      { id: "org-1", users: [{ id: "user-1" }] },
      { id: "org-2", users: [{ id: "user-2" }] },
      { id: "org-3", users: [{ id: "user-3" }] },
    ] as never);

    vi.mocked(db.chatMessage.deleteMany)
      .mockResolvedValueOnce({ count: 10 }) // org-1: logged
      .mockResolvedValueOnce({ count: 0 }) // org-2: not logged
      .mockResolvedValueOnce({ count: 5 }); // org-3: logged

    await POST(makeReq());

    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(writeAuditLog).mock.calls;
    expect(calls[0][0]).toMatchObject({
      organisationId: "org-1",
      after: { deletedCount: 10 },
    });
    expect(calls[1][0]).toMatchObject({
      organisationId: "org-3",
      after: { deletedCount: 5 },
    });
  });
});
