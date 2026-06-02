/**
 * Unit tests for /api/pf/import/[batchId]/confirm route
 *
 * The route handles two operations:
 *   POST ?skip=false  — insert pending duplicates (from JSON column), finalise batch
 *   POST ?skip=true   — discard pending duplicates, finalise batch with safe txns only
 *
 * Duplicates are never inserted into StatementTransaction during upload;
 * they are held in StatementImportBatch.pendingDuplicatesJson until confirm.
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
    statementTransaction: { createMany: vi.fn(), count: vi.fn() },
  },
}));

// Import after mocking so the mocked versions are used
import { POST } from "@/app/api/pf/import/[batchId]/confirm/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PENDING_DUPES = [
  { date: "2024-01-15", description: "Netflix", merchantName: "Netflix", amount: 15.99, type: "DEBIT", category: "Entertainment", mccCode: "7841", mccLabel: "Video Rental" },
  { date: "2024-01-20", description: "Spotify", merchantName: "Spotify", amount: 9.99, type: "DEBIT", category: "Entertainment", mccCode: "7929", mccLabel: "Music" },
];

function makeReq(
  batchId: string,
  skip: boolean,
): { req: NextRequest; params: Promise<{ batchId: string }> } {
  const url = `http://localhost/api/pf/import/${batchId}/confirm?skip=${skip}`;
  const req = new NextRequest(url, { method: "POST" });
  return { req, params: Promise.resolve({ batchId }) };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/pf/import/[batchId]/confirm", () => {
  const ORG = "org-confirm-test";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    vi.mocked(db.user.findUnique).mockResolvedValue({ organisationId: ORG } as never);
    vi.mocked(db.statementImportBatch.findFirst).mockResolvedValue({
      id: "batch-1",
      pendingDuplicatesJson: PENDING_DUPES,
    } as never);
    vi.mocked(db.statementTransaction.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(db.statementTransaction.count).mockResolvedValue(8);
    vi.mocked(db.statementImportBatch.update).mockResolvedValue({} as never);
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  it("returns 401 when no session exists", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const { req, params } = makeReq("batch-1", false);
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("returns 403 when user has no organisation", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ organisationId: null } as never);
    const { req, params } = makeReq("batch-1", false);
    const res = await POST(req, { params });
    expect(res.status).toBe(403);
  });

  it("returns 404 when batch does not exist", async () => {
    vi.mocked(db.statementImportBatch.findFirst).mockResolvedValue(null as never);
    const { req, params } = makeReq("missing-batch", false);
    const res = await POST(req, { params });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Batch not found");
  });

  // ── skip=false — import all (including pending duplicates) ─────────────────

  it("skip=false: inserts pending duplicates and returns count=8 skipped=0", async () => {
    const { req, params } = makeReq("batch-1", false);
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(vi.mocked(db.statementTransaction.createMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ description: "Netflix", importBatchId: "batch-1" }),
          expect.objectContaining({ description: "Spotify", importBatchId: "batch-1" }),
        ]),
      })
    );
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.count).toBe(8);
    expect(body.skipped).toBe(0);
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

  it("skip=false with no pending duplicates: skips createMany call", async () => {
    vi.mocked(db.statementImportBatch.findFirst).mockResolvedValue({
      id: "batch-1", pendingDuplicatesJson: null,
    } as never);
    const { req, params } = makeReq("batch-1", false);
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(vi.mocked(db.statementTransaction.createMany)).not.toHaveBeenCalled();
  });

  // ── skip=true — discard pending duplicates ─────────────────────────────────

  it("skip=true: does NOT call createMany, returns skipped count from JSON column", async () => {
    vi.mocked(db.statementTransaction.count).mockResolvedValue(6); // safe txns only
    const { req, params } = makeReq("batch-1", true);
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(vi.mocked(db.statementTransaction.createMany)).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.count).toBe(6);
    expect(body.skipped).toBe(2); // PENDING_DUPES.length
  });

  it("skip=true: marks batch DONE with updated count", async () => {
    vi.mocked(db.statementTransaction.count).mockResolvedValue(3);
    const { req, params } = makeReq("batch-1", true);
    await POST(req, { params });
    expect(vi.mocked(db.statementImportBatch.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transactionCount: 3 }) })
    );
  });

  it("skip=true with no pending duplicates: skipped=0", async () => {
    vi.mocked(db.statementImportBatch.findFirst).mockResolvedValue({
      id: "batch-1", pendingDuplicatesJson: null,
    } as never);
    const { req, params } = makeReq("batch-1", true);
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe(0);
  });
});
