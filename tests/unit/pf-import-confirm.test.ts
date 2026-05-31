/**
 * Unit tests for /api/pf/import/[batchId]/confirm route
 *
 * The route handles two operations:
 *   POST ?skip=false  — finalise batch, keep every transaction
 *   POST ?skip=true   — delete the listed duplicate IDs, then finalise
 *
 * Auth, db, and the db module are all mocked so no real network or DB
 * connection is required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    statementImportBatch: { findFirst: vi.fn(), update: vi.fn() },
    statementTransaction: { deleteMany: vi.fn(), count: vi.fn() },
  },
}));

// Import after mocking so the mocked versions are used
import { POST } from "@/app/api/pf/import/[batchId]/confirm/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a NextRequest for the confirm route. */
function makeReq(
  batchId: string,
  skip: boolean,
  body: object = {},
): { req: NextRequest; params: Promise<{ batchId: string }> } {
  const url = `http://localhost/api/pf/import/${batchId}/confirm?skip=${skip}`;
  const req = new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const params = Promise.resolve({ batchId });
  return { req, params };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/pf/import/[batchId]/confirm", () => {
  const ORG = "org-confirm-test";

  beforeEach(() => {
    vi.clearAllMocks(); // reset call counts and return values between tests
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ organisationId: ORG } as never);
    vi.mocked(db.statementImportBatch.findFirst).mockResolvedValue({ id: "batch-1", organisationId: ORG } as never);
    vi.mocked(db.statementTransaction.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.statementTransaction.count).mockResolvedValue(8);
    vi.mocked(db.statementImportBatch.update).mockResolvedValue({} as never);
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  it("returns 401 when no session exists", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const { req, params } = makeReq("batch-1", false);
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user has no organisation", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ organisationId: null } as never);
    const { req, params } = makeReq("batch-1", false);
    const res = await POST(req, { params });
    expect(res.status).toBe(403);
  });

  it("returns 404 when batch does not exist", async () => {
    vi.mocked(db.statementImportBatch.findFirst).mockResolvedValue(null);
    const { req, params } = makeReq("missing-batch", false);
    const res = await POST(req, { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Batch not found");
  });

  // ── skip=false — import all ────────────────────────────────────────────────

  it("skip=false: does NOT call deleteMany, returns count=8 skipped=0", async () => {
    const { req, params } = makeReq("batch-1", false);
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(vi.mocked(db.statementTransaction.deleteMany)).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.count).toBe(8);
    expect(body.skipped).toBe(0);
    expect(body.batchId).toBe("batch-1");
  });

  it("skip=false: marks batch DONE with the transaction count", async () => {
    const { req, params } = makeReq("batch-1", false);
    await POST(req, { params });
    expect(vi.mocked(db.statementImportBatch.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "batch-1" },
        data: expect.objectContaining({ status: "DONE", transactionCount: 8 }),
      })
    );
  });

  // ── skip=true — remove duplicates ─────────────────────────────────────────

  it("skip=true: deletes the listed duplicate IDs and returns remaining count", async () => {
    vi.mocked(db.statementTransaction.count).mockResolvedValue(5); // 8 saved - 3 deleted
    const { req, params } = makeReq("batch-1", true, { duplicateIds: ["d1", "d2", "d3"] });
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(vi.mocked(db.statementTransaction.deleteMany)).toHaveBeenCalledWith({
      where: { id: { in: ["d1", "d2", "d3"] }, importBatchId: "batch-1", organisationId: ORG },
    });
    const body = await res.json();
    expect(body.count).toBe(5);
    expect(body.skipped).toBe(3);
  });

  it("skip=true with empty duplicateIds: skips the deleteMany call", async () => {
    const { req, params } = makeReq("batch-1", true, { duplicateIds: [] });
    await POST(req, { params });
    expect(vi.mocked(db.statementTransaction.deleteMany)).not.toHaveBeenCalled();
  });

  it("skip=true: marks batch DONE with updated count after deletions", async () => {
    vi.mocked(db.statementTransaction.count).mockResolvedValue(3);
    const { req, params } = makeReq("batch-1", true, { duplicateIds: ["d1", "d2"] });
    await POST(req, { params });
    expect(vi.mocked(db.statementImportBatch.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transactionCount: 3 }) })
    );
  });

  it("skip=true: handles missing body gracefully (treats duplicateIds as [])", async () => {
    // Body exists but has no duplicateIds key
    const { req, params } = makeReq("batch-1", true, {});
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(vi.mocked(db.statementTransaction.deleteMany)).not.toHaveBeenCalled();
  });
});
