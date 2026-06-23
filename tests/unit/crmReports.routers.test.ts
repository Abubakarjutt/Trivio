/**
 * CRM Reports router tests
 *
 * Tests all 5 procedures of the crmReportsRouter directly via
 * createCallerFactory with fully mocked Prisma — no DB connection required.
 */

import { describe, it, expect, vi } from "vitest";
import { createCallerFactory } from "@/server/trpc";
import { crmReportsRouter } from "@/server/routers/crmReports";

// Mock crm.service — toNum as a passthrough so plain numbers work in mock data
vi.mock("@/server/services/crm.service", () => ({
  toNum: (v: unknown) => Number(v),
  calcWeightedForecast: vi.fn().mockReturnValue([]),
}));

// vi.mock is hoisted — use literals in factory, not variable references
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
    },
  },
}));

const ORG = "org-1";
const USER_ID = "user-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  return {
    session: { user: { id: USER_ID } },
    user: { id: USER_ID, organisationId: ORG, organisation: { id: ORG, name: "Test Org" } },
    db,
    organisationId: ORG,
    organisation: { id: ORG, name: "Test Org" },
  };
}

const createCaller = createCallerFactory(crmReportsRouter);

// ═══════════════════════════════════════════════════════════════════════════════
// pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe("crmReportsRouter.pipeline", () => {
  it("returns stage summary with correct totalValue and weightedValue", async () => {
    const stages = [
      {
        id: "stage-1",
        name: "Prospecting",
        deals: [
          { value: 1000, probability: 50 },
          { value: 2000, probability: 25 },
        ],
      },
    ];
    const ctx = makeCtx({ crmPipelineStage: { findMany: vi.fn().mockResolvedValue(stages) } });
    const result = await createCaller(ctx).pipeline({});
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      stageId: "stage-1",
      stageName: "Prospecting",
      dealCount: 2,
      totalValue: 3000,
      weightedValue: 1000, // 1000*0.5 + 2000*0.25 = 500 + 500 = 1000
    });
  });

  it("returns zeros for an empty stage", async () => {
    const stages = [{ id: "stage-2", name: "Closed", deals: [] }];
    const ctx = makeCtx({ crmPipelineStage: { findMany: vi.fn().mockResolvedValue(stages) } });
    const result = await createCaller(ctx).pipeline({});
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dealCount: 0,
      totalValue: 0,
      weightedValue: 0,
    });
  });

  it("filters by pipelineId when provided", async () => {
    const findManyMock = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ crmPipelineStage: { findMany: findManyMock } });
    await createCaller(ctx).pipeline({ pipelineId: "pipe-1" });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pipelineId: "pipe-1" } })
    );
  });

  it("queries by organisationId when pipelineId is omitted", async () => {
    const findManyMock = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ crmPipelineStage: { findMany: findManyMock } });
    await createCaller(ctx).pipeline({});
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pipeline: { organisationId: ORG } } })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// wonLostAnalysis
// ═══════════════════════════════════════════════════════════════════════════════

describe("crmReportsRouter.wonLostAnalysis", () => {
  it("returns correct counts, winRate, avgDealSize, and lossReasons", async () => {
    const deals = [
      // won — probability 100
      { value: 2000, probability: 100, invoiceId: null, wonLostReason: null, closedAt: new Date(), createdAt: new Date() },
      // won — has invoiceId
      { value: 3000, probability: 50, invoiceId: "inv-1", wonLostReason: null, closedAt: new Date(), createdAt: new Date() },
      // lost
      { value: 1000, probability: 0, invoiceId: null, wonLostReason: "Too expensive", closedAt: new Date(), createdAt: new Date() },
      // lost with no reason
      { value: 500, probability: 0, invoiceId: null, wonLostReason: null, closedAt: new Date(), createdAt: new Date() },
    ];
    const ctx = makeCtx({ crmDeal: { findMany: vi.fn().mockResolvedValue(deals) } });
    const result = await createCaller(ctx).wonLostAnalysis({ from: "2026-01-01", to: "2026-12-31" });

    expect(result.totalClosed).toBe(4);
    expect(result.wonCount).toBe(2);
    expect(result.lostCount).toBe(2);
    expect(result.winRate).toBe(50); // 2/4 * 100
    expect(result.avgDealSize).toBe(2500); // (2000 + 3000) / 2
    expect(result.lossReasons).toEqual(
      expect.arrayContaining([
        { reason: "Too expensive", count: 1 },
        { reason: "No reason given", count: 1 },
      ])
    );
  });

  it("returns zeros and empty arrays when no deals", async () => {
    const ctx = makeCtx({ crmDeal: { findMany: vi.fn().mockResolvedValue([]) } });
    const result = await createCaller(ctx).wonLostAnalysis({ from: "2026-01-01", to: "2026-12-31" });
    expect(result).toMatchObject({
      totalClosed: 0,
      wonCount: 0,
      lostCount: 0,
      winRate: 0,
      avgDealSize: 0,
      lossReasons: [],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// activityReport
// ═══════════════════════════════════════════════════════════════════════════════

describe("crmReportsRouter.activityReport", () => {
  it("groups activities by type and user, sorted by count desc", async () => {
    const user2 = "user-2";
    const activities = [
      { type: "CALL", createdById: USER_ID, createdBy: { id: USER_ID, name: "Alice" } },
      { type: "CALL", createdById: USER_ID, createdBy: { id: USER_ID, name: "Alice" } },
      { type: "EMAIL", createdById: USER_ID, createdBy: { id: USER_ID, name: "Alice" } },
      { type: "CALL", createdById: user2, createdBy: { id: user2, name: "Bob" } },
    ];
    const ctx = makeCtx({ crmActivity: { findMany: vi.fn().mockResolvedValue(activities) } });
    const result = await createCaller(ctx).activityReport({ from: "2026-01-01", to: "2026-12-31" });

    expect(result.total).toBe(4);
    expect(result.byType).toEqual(
      expect.arrayContaining([
        { type: "CALL", count: 3 },
        { type: "EMAIL", count: 1 },
      ])
    );
    // byUser sorted descending by count — Alice (3) before Bob (1)
    expect(result.byUser[0]).toMatchObject({ userId: USER_ID, userName: "Alice", count: 3 });
    expect(result.byUser[1]).toMatchObject({ userId: user2, userName: "Bob", count: 1 });
  });

  it("returns empty totals when no activities", async () => {
    const ctx = makeCtx({ crmActivity: { findMany: vi.fn().mockResolvedValue([]) } });
    const result = await createCaller(ctx).activityReport({ from: "2026-01-01", to: "2026-12-31" });
    expect(result).toMatchObject({ total: 0, byType: [], byUser: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// leadSourceReport
// ═══════════════════════════════════════════════════════════════════════════════

describe("crmReportsRouter.leadSourceReport", () => {
  it("groups leads by source and calculates conversionRate", async () => {
    const leads = [
      { source: "LinkedIn", status: "CONVERTED" },
      { source: "LinkedIn", status: "CONVERTED" },
      { source: "LinkedIn", status: "NEW" },
      { source: "Website", status: "CONVERTED" },
      { source: "Website", status: "NEW" },
    ];
    const ctx = makeCtx({ crmLead: { findMany: vi.fn().mockResolvedValue(leads) } });
    const result = await createCaller(ctx).leadSourceReport();

    const linkedin = result.find((r) => r.source === "LinkedIn");
    const website = result.find((r) => r.source === "Website");

    expect(linkedin).toMatchObject({ total: 3, converted: 2, conversionRate: 67 });
    expect(website).toMatchObject({ total: 2, converted: 1, conversionRate: 50 });
  });

  it("returns empty array when no leads", async () => {
    const ctx = makeCtx({ crmLead: { findMany: vi.fn().mockResolvedValue([]) } });
    const result = await createCaller(ctx).leadSourceReport();
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// salesForecast
// ═══════════════════════════════════════════════════════════════════════════════

describe("crmReportsRouter.salesForecast", () => {
  it("returns 6 months by default with known slot from calcWeightedForecast", async () => {
    const { calcWeightedForecast } = await import("@/server/services/crm.service");
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    vi.mocked(calcWeightedForecast).mockReturnValue([
      { month: currentMonth, totalValue: 5000, weightedValue: 2500, dealCount: 3 },
    ]);

    const ctx = makeCtx({ crmDeal: { findMany: vi.fn().mockResolvedValue([]) } });
    const result = await createCaller(ctx).salesForecast({});

    expect(result).toHaveLength(6);
    const slot = result.find((r) => r.month === currentMonth);
    expect(slot).toMatchObject({ totalValue: 5000, weightedValue: 2500, dealCount: 3 });
  });

  it("returns N months based on input.months parameter", async () => {
    const { calcWeightedForecast } = await import("@/server/services/crm.service");
    vi.mocked(calcWeightedForecast).mockReturnValue([]);

    const ctx = makeCtx({ crmDeal: { findMany: vi.fn().mockResolvedValue([]) } });
    const result = await createCaller(ctx).salesForecast({ months: 3 });
    expect(result).toHaveLength(3);
  });

  it("returns zero-filled slots when calcWeightedForecast returns no matches", async () => {
    const { calcWeightedForecast } = await import("@/server/services/crm.service");
    vi.mocked(calcWeightedForecast).mockReturnValue([]);

    const ctx = makeCtx({ crmDeal: { findMany: vi.fn().mockResolvedValue([]) } });
    const result = await createCaller(ctx).salesForecast({ months: 2 });
    for (const slot of result) {
      expect(slot).toMatchObject({ totalValue: 0, weightedValue: 0, dealCount: 0 });
    }
  });
});
