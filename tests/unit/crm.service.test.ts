import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calcWeightedForecast,
  calcWinRate,
  calcAvgCloseTime,
  suggestProbability,
  isOverdue,
  toNum,
  type DealLike,
} from "@/server/services/crm.service";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDeal(overrides: Partial<DealLike> = {}): DealLike {
  return {
    id: "d1",
    value: 1000,
    probability: 50,
    expectedCloseDate: null,
    closedAt: null,
    wonLostReason: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// ─── toNum ───────────────────────────────────────────────────────────────────

describe("toNum", () => {
  it("returns number as-is", () => {
    expect(toNum(42)).toBe(42);
  });

  it("parses string", () => {
    expect(toNum("123.45")).toBe(123.45);
  });

  it("calls toNumber() on Decimal-like object", () => {
    expect(toNum({ toNumber: () => 99.99 })).toBe(99.99);
  });

  it("returns 0 for null", () => {
    expect(toNum(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(toNum(undefined)).toBe(0);
  });
});

// ─── suggestProbability ───────────────────────────────────────────────────────

describe("suggestProbability", () => {
  it("returns 0 for first stage when there is only one stage", () => {
    // order=1, total=1 → 1/1 * 100 = 100
    expect(suggestProbability(1, 1)).toBe(100);
  });

  it("returns 50 for middle stage of 4", () => {
    expect(suggestProbability(2, 4)).toBe(50);
  });

  it("returns 100 for last stage", () => {
    expect(suggestProbability(5, 5)).toBe(100);
  });

  it("clamps to 0 for order 0", () => {
    expect(suggestProbability(0, 5)).toBe(0);
  });

  it("returns 50 for totalStages = 0", () => {
    expect(suggestProbability(1, 0)).toBe(50);
  });

  it("clamps maximum to 100", () => {
    expect(suggestProbability(10, 5)).toBe(100);
  });
});

// ─── isOverdue ────────────────────────────────────────────────────────────────

describe("isOverdue", () => {
  const past = new Date("2020-01-01");
  const future = new Date("2099-01-01");

  it("returns true when dueDate is past and not completed", () => {
    expect(isOverdue(past, null)).toBe(true);
  });

  it("returns false when dueDate is in the future", () => {
    expect(isOverdue(future, null)).toBe(false);
  });

  it("returns false when completed regardless of dueDate", () => {
    expect(isOverdue(past, new Date())).toBe(false);
  });

  it("returns false when dueDate is null", () => {
    expect(isOverdue(null, null)).toBe(false);
  });

  it("returns false when dueDate is undefined", () => {
    expect(isOverdue(undefined, null)).toBe(false);
  });
});

// ─── calcWeightedForecast ────────────────────────────────────────────────────

describe("calcWeightedForecast", () => {
  it("returns empty array when no deals", () => {
    expect(calcWeightedForecast([])).toEqual([]);
  });

  it("excludes closed deals", () => {
    const deal = makeDeal({ closedAt: new Date(), expectedCloseDate: new Date("2026-06-01") });
    expect(calcWeightedForecast([deal])).toEqual([]);
  });

  it("excludes deals without expectedCloseDate", () => {
    const deal = makeDeal({ expectedCloseDate: null });
    expect(calcWeightedForecast([deal])).toEqual([]);
  });

  it("groups deals by month and sums values", () => {
    const deal1 = makeDeal({ value: 1000, probability: 50, expectedCloseDate: new Date(2026, 6, 15) }); // July 15
    const deal2 = makeDeal({ id: "d2", value: 2000, probability: 100, expectedCloseDate: new Date(2026, 6, 20) }); // July 20
    const result = calcWeightedForecast([deal1, deal2]);
    expect(result).toHaveLength(1);
    expect(result[0].month).toBe("2026-07");
    expect(result[0].totalValue).toBe(3000);
    expect(result[0].weightedValue).toBe(2500); // 500 + 2000
    expect(result[0].dealCount).toBe(2);
  });

  it("puts deals from different months in separate buckets", () => {
    // Use local-time constructors to avoid UTC-offset month shift
    const deal1 = makeDeal({ value: 1000, probability: 100, expectedCloseDate: new Date(2026, 5, 1) }); // June
    const deal2 = makeDeal({ id: "d2", value: 2000, probability: 100, expectedCloseDate: new Date(2026, 6, 1) }); // July
    const result = calcWeightedForecast([deal1, deal2]);
    expect(result).toHaveLength(2);
    expect(result[0].month).toBe("2026-06");
    expect(result[1].month).toBe("2026-07");
  });

  it("sorts results by month ascending", () => {
    const deal1 = makeDeal({ value: 1000, probability: 100, expectedCloseDate: new Date(2026, 8, 1) }); // September
    const deal2 = makeDeal({ id: "d2", value: 500, probability: 100, expectedCloseDate: new Date(2026, 5, 1) }); // June
    const result = calcWeightedForecast([deal1, deal2]);
    expect(result[0].month).toBe("2026-06");
    expect(result[1].month).toBe("2026-09");
  });

  it("rounds values to 2 decimal places", () => {
    const deal = makeDeal({ value: 100, probability: 33, expectedCloseDate: new Date(2026, 6, 1) }); // July 1 local
    const result = calcWeightedForecast([deal]);
    expect(result[0].weightedValue).toBe(33); // 100 * 0.33
  });

  it("handles Decimal-like value objects", () => {
    const deal = makeDeal({ value: { toNumber: () => 5000 }, probability: 50, expectedCloseDate: new Date(2026, 6, 1) }); // July 1 local
    const result = calcWeightedForecast([deal]);
    expect(result[0].totalValue).toBe(5000);
    expect(result[0].weightedValue).toBe(2500);
  });
});

// ─── calcWinRate ─────────────────────────────────────────────────────────────

describe("calcWinRate", () => {
  const from = new Date("2026-01-01");

  it("returns 0 when no deals closed in period", () => {
    const deal = makeDeal({ closedAt: new Date("2025-12-31") });
    expect(calcWinRate([deal], from)).toBe(0);
  });

  it("returns 0 when no closed deals at all", () => {
    expect(calcWinRate([], from)).toBe(0);
  });

  it("returns 1.0 when all closed deals are won (no LOST reason)", () => {
    const d1 = makeDeal({ closedAt: new Date("2026-02-01"), wonLostReason: null });
    const d2 = makeDeal({ id: "d2", closedAt: new Date("2026-03-01"), wonLostReason: "Contract signed" });
    expect(calcWinRate([d1, d2], from)).toBe(1);
  });

  it("calculates correct ratio with mixed won/lost", () => {
    const won = makeDeal({ closedAt: new Date("2026-02-01"), wonLostReason: null });
    const lost = makeDeal({ id: "d2", closedAt: new Date("2026-03-01"), wonLostReason: "LOST" });
    const result = calcWinRate([won, lost], from);
    expect(result).toBe(0.5);
  });
});

// ─── calcAvgCloseTime ────────────────────────────────────────────────────────

describe("calcAvgCloseTime", () => {
  it("returns 0 for empty array", () => {
    expect(calcAvgCloseTime([])).toBe(0);
  });

  it("returns 0 when no deals have closedAt", () => {
    const deal = makeDeal({ closedAt: null });
    expect(calcAvgCloseTime([deal])).toBe(0);
  });

  it("calculates average days from createdAt to closedAt", () => {
    const deal = makeDeal({
      createdAt: new Date("2026-01-01"),
      closedAt: new Date("2026-01-11"), // 10 days
    });
    expect(calcAvgCloseTime([deal])).toBe(10);
  });

  it("averages multiple deals", () => {
    const d1 = makeDeal({
      createdAt: new Date("2026-01-01"),
      closedAt: new Date("2026-01-11"), // 10 days
    });
    const d2 = makeDeal({
      id: "d2",
      createdAt: new Date("2026-01-01"),
      closedAt: new Date("2026-01-31"), // 30 days
    });
    expect(calcAvgCloseTime([d1, d2])).toBe(20); // (10+30)/2
  });

  it("rounds to whole days", () => {
    const d1 = makeDeal({ createdAt: new Date("2026-01-01"), closedAt: new Date("2026-01-02") }); // 1 day
    const d2 = makeDeal({ id: "d2", createdAt: new Date("2026-01-01"), closedAt: new Date("2026-01-04") }); // 3 days
    expect(calcAvgCloseTime([d1, d2])).toBe(2); // (1+3)/2 = 2
  });
});
