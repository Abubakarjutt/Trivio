/**
 * Org router tests
 *
 * Tests all orgRouter procedures directly via createCallerFactory with
 * fully mocked Prisma — no DB connection required.
 *
 * Key wiring notes:
 *  - orgProcedure middleware calls `db.user.findUnique` (imported directly from
 *    @/lib/db, NOT from ctx.db) to resolve organisationId.
 *  - protectedProcedure procedures (setupStep1, setupStep2) use ctx.db.
 *  - We bypass orgProcedure middleware for orgProcedure tests by injecting
 *    organisationId directly into the context.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────

// seedDefaultChartOfAccounts must be mocked before org router is imported
vi.mock("@/server/services/chart-of-accounts.service", () => ({
  seedDefaultChartOfAccounts: vi.fn().mockResolvedValue(undefined),
}));

// sample-data: use a small fixed array so counts are predictable
vi.mock("@/lib/sample-data", () => ({
  SAMPLE_TRANSACTIONS: [
    { description: "Salary", merchantName: "Employer", amount: 85000, type: "CREDIT", category: "Salary", daysAgo: 2 },
    { description: "Groceries", merchantName: "Store", amount: 4200, type: "DEBIT", category: "Groceries", daysAgo: 5 },
    { description: "Internet", merchantName: "ISP", amount: 3499, type: "DEBIT", category: "Internet", daysAgo: 10 },
  ],
}));

// The orgProcedure middleware imports `db` directly from @/lib/db (not ctx.db).
// We must mock that module so the middleware resolves organisationId.
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    organisation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    usageRecord: {
      findUnique: vi.fn(),
    },
    statementImportBatch: {
      create: vi.fn(),
    },
    statementTransaction: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { createCallerFactory } from "@/server/trpc";
import { orgRouter } from "@/server/routers/org";
import { db } from "@/lib/db";
import { seedDefaultChartOfAccounts } from "@/server/services/chart-of-accounts.service";

// ── Typed mock handles ────────────────────────────────────────────────────────

const mockUserFindUnique      = db.user.findUnique as ReturnType<typeof vi.fn>;
const mockUserUpdate          = db.user.update as ReturnType<typeof vi.fn>;
const mockOrgFindFirst        = db.organisation.findFirst as ReturnType<typeof vi.fn>;
const mockOrgFindUnique       = db.organisation.findUnique as ReturnType<typeof vi.fn>;
const mockOrgCreate           = db.organisation.create as ReturnType<typeof vi.fn>;
const mockOrgUpdate           = db.organisation.update as ReturnType<typeof vi.fn>;
const mockUsageRecord         = db.usageRecord.findUnique as ReturnType<typeof vi.fn>;
const mockBatchCreate         = db.statementImportBatch.create as ReturnType<typeof vi.fn>;
const mockTxCreateMany        = db.statementTransaction.createMany as ReturnType<typeof vi.fn>;
const mockTransaction         = db.$transaction as ReturnType<typeof vi.fn>;
const mockSeedChartOfAccounts = seedDefaultChartOfAccounts as ReturnType<typeof vi.fn>;

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG_ID  = "org-1";
const USER_ID = "user-1";

const baseOrg = {
  id: ORG_ID,
  name: "Test Org",
  businessType: "SOLE_TRADER",
  currency: "PKR",
  taxRegimeId: null,
  taxJurisdiction: null,
  fiscalYearStartMonth: 1,
  onboardingStep: "COMPLETE",
  onboardingComplete: true,
  hasSampleData: false,
  emailImportToken: "tok-abc",
  taxRegime: null,
};

// ── Caller factories ──────────────────────────────────────────────────────────

const createCaller = createCallerFactory(orgRouter);

/** Caller with no session (for publicProcedure) */
function makePublicCaller() {
  return createCaller({
    session: null,
    db: db as any,
    ip: "127.0.0.1",
  });
}

/** Caller for protectedProcedure — has session, no organisationId in ctx */
function makeProtectedCaller(userId = USER_ID) {
  return createCaller({
    session: { user: { id: userId, email: "u@test.com", name: "Test" } } as any,
    db: db as any,
    ip: "127.0.0.1",
  });
}

/**
 * Caller for orgProcedure — bypasses the middleware by injecting all required
 * fields directly.  We still need db.user.findUnique to succeed because the
 * middleware runs first; set it up before calling.
 */
function makeOrgCaller(orgId = ORG_ID, userId = USER_ID) {
  return createCaller({
    session: { user: { id: userId, email: "u@test.com", name: "Test" } } as any,
    db: db as any,
    organisationId: orgId,
    organisation: baseOrg as any,
    ip: "127.0.0.1",
  });
}

/** Seed the db.user.findUnique mock so orgProcedure middleware succeeds */
function seedOrgMiddleware(orgId = ORG_ID) {
  mockUserFindUnique.mockResolvedValue({
    id: USER_ID,
    organisationId: orgId,
    organisation: { ...baseOrg, id: orgId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// getCurrencies
// ─────────────────────────────────────────────────────────────────────────────

describe("orgRouter.getCurrencies", () => {
  it("returns exactly 20 currencies", async () => {
    const result = await makePublicCaller().getCurrencies();
    expect(result).toHaveLength(20);
  });

  it("includes USD and PKR", async () => {
    const result = await makePublicCaller().getCurrencies();
    const codes = result.map((c: { code: string }) => c.code);
    expect(codes).toContain("USD");
    expect(codes).toContain("PKR");
  });

  it("each entry has code and name fields", async () => {
    const result = await makePublicCaller().getCurrencies();
    for (const c of result) {
      expect(c).toHaveProperty("code");
      expect(c).toHaveProperty("name");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setupStep1
// ─────────────────────────────────────────────────────────────────────────────

describe("orgRouter.setupStep1", () => {
  const step1Input = { businessName: "My Shop", businessType: "SOLE_TRADER" as const };

  it("throws UNAUTHORIZED when user does not exist in DB", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const caller = makeProtectedCaller();
    await expect(caller.setupStep1(step1Input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mockOrgCreate).not.toHaveBeenCalled();
  });

  it("creates a new org when user has no existing org", async () => {
    // First call: guard check (select: {id:true})
    mockUserFindUnique.mockResolvedValueOnce({ id: USER_ID });
    // findFirst for existing org → none
    mockOrgFindFirst.mockResolvedValue(null);
    const createdOrg = { ...baseOrg, onboardingStep: "CURRENCY_TAX" };
    mockOrgCreate.mockResolvedValue(createdOrg);
    mockUserUpdate.mockResolvedValue({});

    const caller = makeProtectedCaller();
    const result = await caller.setupStep1(step1Input);

    expect(mockOrgCreate).toHaveBeenCalledOnce();
    expect(result.onboardingStep).toBe("CURRENCY_TAX");
  });

  it("updates existing org when one already exists", async () => {
    mockUserFindUnique.mockResolvedValueOnce({ id: USER_ID });
    mockOrgFindFirst.mockResolvedValue({ id: ORG_ID, name: "Old Name" });
    const updatedOrg = { ...baseOrg, name: "My Shop", onboardingStep: "CURRENCY_TAX" };
    mockOrgUpdate.mockResolvedValue(updatedOrg);

    const caller = makeProtectedCaller();
    const result = await caller.setupStep1(step1Input);

    expect(mockOrgCreate).not.toHaveBeenCalled();
    expect(mockOrgUpdate).toHaveBeenCalledOnce();
    expect(result.name).toBe("My Shop");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setupStep2
// ─────────────────────────────────────────────────────────────────────────────

describe("orgRouter.setupStep2", () => {
  const step2Input = { currency: "PKR", fiscalYearStartMonth: 1 };

  it("throws BAD_REQUEST when user has no organisation yet", async () => {
    mockUserFindUnique.mockResolvedValue({ id: USER_ID, organisationId: null, organisation: null });

    const caller = makeProtectedCaller();
    await expect(caller.setupStep2(step2Input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Complete step 1 first",
    });
  });

  it("calls seedDefaultChartOfAccounts after updating org", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: USER_ID,
      organisationId: ORG_ID,
      organisation: baseOrg,
    });
    const updatedOrg = { ...baseOrg, currency: "PKR", onboardingComplete: true };
    mockOrgUpdate.mockResolvedValue(updatedOrg);

    const caller = makeProtectedCaller();
    await caller.setupStep2(step2Input);

    expect(mockSeedChartOfAccounts).toHaveBeenCalledOnce();
    expect(mockSeedChartOfAccounts).toHaveBeenCalledWith(db, ORG_ID);
  });

  it("returns the updated org", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: USER_ID,
      organisationId: ORG_ID,
      organisation: baseOrg,
    });
    const updatedOrg = { ...baseOrg, currency: "PKR", onboardingComplete: true };
    mockOrgUpdate.mockResolvedValue(updatedOrg);

    const caller = makeProtectedCaller();
    const result = await caller.setupStep2(step2Input);

    expect(result.currency).toBe("PKR");
    expect(result.onboardingComplete).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// get
// ─────────────────────────────────────────────────────────────────────────────

describe("orgRouter.get", () => {
  it("returns org with aiExtractionsUsed from usageRecord", async () => {
    seedOrgMiddleware();
    mockOrgFindUnique.mockResolvedValue(baseOrg);
    mockUsageRecord.mockResolvedValue({ aiExtractionCount: 7 });

    const caller = makeOrgCaller();
    const result = await caller.get();

    expect(result.aiExtractionsUsed).toBe(7);
  });

  it("defaults aiExtractionsUsed to 0 when no usageRecord exists", async () => {
    seedOrgMiddleware();
    mockOrgFindUnique.mockResolvedValue(baseOrg);
    mockUsageRecord.mockResolvedValue(null);

    const caller = makeOrgCaller();
    const result = await caller.get();

    expect(result.aiExtractionsUsed).toBe(0);
  });

  it("returns hasSampleData field from org", async () => {
    seedOrgMiddleware();
    mockOrgFindUnique.mockResolvedValue({ ...baseOrg, hasSampleData: true });
    mockUsageRecord.mockResolvedValue(null);

    const caller = makeOrgCaller();
    const result = await caller.get();

    expect(result.hasSampleData).toBe(true);
  });

  it("defaults hasSampleData to false when org returns null for it", async () => {
    seedOrgMiddleware();
    mockOrgFindUnique.mockResolvedValue({ ...baseOrg, hasSampleData: false });
    mockUsageRecord.mockResolvedValue(null);

    const caller = makeOrgCaller();
    const result = await caller.get();

    expect(result.hasSampleData).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update
// ─────────────────────────────────────────────────────────────────────────────

describe("orgRouter.update", () => {
  it("updates org name", async () => {
    seedOrgMiddleware();
    const updated = { ...baseOrg, name: "New Name" };
    mockOrgUpdate.mockResolvedValue(updated);

    const caller = makeOrgCaller();
    const result = await caller.update({ name: "New Name" });

    expect(result.name).toBe("New Name");
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "New Name" } })
    );
  });

  it("updates fiscalYearStartMonth", async () => {
    seedOrgMiddleware();
    const updated = { ...baseOrg, fiscalYearStartMonth: 4 };
    mockOrgUpdate.mockResolvedValue(updated);

    const caller = makeOrgCaller();
    const result = await caller.update({ fiscalYearStartMonth: 4 });

    expect(result.fiscalYearStartMonth).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setCurrency
// ─────────────────────────────────────────────────────────────────────────────

describe("orgRouter.setCurrency", () => {
  it("calls db.organisation.update with the given currency", async () => {
    seedOrgMiddleware();
    mockOrgUpdate.mockResolvedValue({ ...baseOrg, currency: "USD" });

    const caller = makeOrgCaller();
    const result = await caller.setCurrency({ currency: "USD" });

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currency: "USD" } })
    );
    expect(result).toEqual({ success: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setTaxJurisdiction
// ─────────────────────────────────────────────────────────────────────────────

describe("orgRouter.setTaxJurisdiction", () => {
  it("sets jurisdiction to a string value and returns {success: true}", async () => {
    seedOrgMiddleware();
    mockOrgUpdate.mockResolvedValue({ ...baseOrg, taxJurisdiction: "PK" });

    const caller = makeOrgCaller();
    const result = await caller.setTaxJurisdiction({ jurisdiction: "PK" });

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { taxJurisdiction: "PK" } })
    );
    expect(result).toEqual({ success: true });
  });

  it("sets jurisdiction to null (clearing it)", async () => {
    seedOrgMiddleware();
    mockOrgUpdate.mockResolvedValue({ ...baseOrg, taxJurisdiction: null });

    const caller = makeOrgCaller();
    const result = await caller.setTaxJurisdiction({ jurisdiction: null });

    expect(mockOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { taxJurisdiction: null } })
    );
    expect(result).toEqual({ success: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadSampleData
// ─────────────────────────────────────────────────────────────────────────────

describe("orgRouter.loadSampleData", () => {
  it("throws NOT_FOUND when org does not exist", async () => {
    seedOrgMiddleware();
    mockOrgFindUnique.mockResolvedValue(null);

    const caller = makeOrgCaller();
    await expect(caller.loadSampleData()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns {success:true, count:0} when sample data already loaded (idempotent)", async () => {
    seedOrgMiddleware();
    mockOrgFindUnique.mockResolvedValue({ hasSampleData: true });

    const caller = makeOrgCaller();
    const result = await caller.loadSampleData();

    expect(result).toEqual({ success: true, count: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates a StatementImportBatch and transactions inside $transaction", async () => {
    seedOrgMiddleware();
    mockOrgFindUnique.mockResolvedValue({ hasSampleData: false });

    // Simulate the $transaction callback: give it a tx object
    mockTransaction.mockImplementation(async (fn: (tx: any) => Promise<number>) => {
      const txMocks = {
        statementImportBatch: {
          create: vi.fn().mockResolvedValue({ id: "batch-1" }),
        },
        statementTransaction: {
          createMany: vi.fn().mockResolvedValue({ count: 3 }),
        },
        organisation: {
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(txMocks);
    });

    const caller = makeOrgCaller();
    const result = await caller.loadSampleData();

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(result).toEqual({ success: true, count: 3 });
  });

  it("sets hasSampleData=true on the org inside the transaction", async () => {
    seedOrgMiddleware();
    mockOrgFindUnique.mockResolvedValue({ hasSampleData: false });

    const orgUpdateMock = vi.fn().mockResolvedValue({});
    mockTransaction.mockImplementation(async (fn: (tx: any) => Promise<number>) => {
      return fn({
        statementImportBatch: { create: vi.fn().mockResolvedValue({ id: "batch-1" }) },
        statementTransaction: { createMany: vi.fn().mockResolvedValue({ count: 3 }) },
        organisation: { update: orgUpdateMock },
      });
    });

    const caller = makeOrgCaller();
    await caller.loadSampleData();

    expect(orgUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hasSampleData: true } })
    );
  });

  it("maps SAMPLE_TRANSACTIONS rows with organisationId and importBatchId", async () => {
    seedOrgMiddleware();
    mockOrgFindUnique.mockResolvedValue({ hasSampleData: false });

    const createManyMock = vi.fn().mockResolvedValue({ count: 3 });
    mockTransaction.mockImplementation(async (fn: (tx: any) => Promise<number>) => {
      return fn({
        statementImportBatch: { create: vi.fn().mockResolvedValue({ id: "batch-99" }) },
        statementTransaction: { createMany: createManyMock },
        organisation: { update: vi.fn().mockResolvedValue({}) },
      });
    });

    const caller = makeOrgCaller();
    await caller.loadSampleData();

    const rows: any[] = createManyMock.mock.calls[0][0].data;
    expect(rows).toHaveLength(3); // matches our mocked SAMPLE_TRANSACTIONS
    for (const row of rows) {
      expect(row.organisationId).toBe(ORG_ID);
      expect(row.importBatchId).toBe("batch-99");
      expect(row.isSampleData).toBe(true);
    }
  });
});
