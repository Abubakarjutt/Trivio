/**
 * EasyFinance router tests
 *
 * Tests the tRPC router handlers directly using createCallerFactory with a
 * fully mocked Prisma context — no DB connection required.
 *
 * Each router section covers:
 *  - Happy-path CRUD
 *  - NOT_FOUND / BAD_REQUEST guard-rail errors
 *  - Derived field computation (spend, utilization, progress, isDue, etc.)
 */

import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createCallerFactory } from "@/server/trpc";
import { budgetsRouter } from "@/server/routers/budgets";
import { goalsRouter } from "@/server/routers/goals";
import { recurringItemsRouter } from "@/server/routers/recurringItems";
import { watchlistsRouter } from "@/server/routers/watchlists";

// ─── Mock the module-level db used by orgProcedure middleware ─────────────────
// The middleware does `await db.user.findUnique(...)` using the module import,
// not ctx.db. We stub it to return a valid user so the auth gate passes.

// vi.mock is hoisted before variable initialisation — use literals in the factory
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-unit-test",
        organisation: { id: "org-unit-test", name: "Test Org" },
      }),
    },
  },
}));

const ORG = "org-unit-test";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Decimal mock that satisfies Number(…) coercion used in the routers. */
function dec(n: number) {
  return new Prisma.Decimal(n);
}

/**
 * Build a mock tRPC context.
 * `db` overrides supply the model-level mocks (budget, goal, etc.) used inside
 * each router handler.  The middleware's own db.user call is handled by the
 * vi.mock above so it never touches `ctx.db`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  return {
    session: { user: { id: "user-1" } },
    db,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUDGETS ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const budgetsCaller = createCallerFactory(budgetsRouter);

describe("budgetsRouter.list", () => {
  it("returns empty array when no budgets exist", async () => {
    const ctx = makeCtx({
      budget: { findMany: vi.fn().mockResolvedValue([]) },
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: { debit: null } }) },
    });
    const result = await budgetsCaller(ctx).list({ includeArchived: false });
    expect(result).toEqual([]);
  });

  it("enriches each budget with spent, remaining, utilization", async () => {
    const ctx = makeCtx({
      budget: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "b-1", organisationId: ORG, name: "Marketing",
            category: "Marketing", limitAmount: dec(1000), period: "MONTHLY",
            isArchived: false, createdAt: new Date(), updatedAt: new Date(),
          },
        ]),
      },
      journalLine: {
        // Prisma.Decimal so Number(…) coercion works via valueOf()
        aggregate: vi.fn().mockResolvedValue({ _sum: { debit: dec(400) } }),
      },
    });

    const [b] = await budgetsCaller(ctx).list({ includeArchived: false });
    expect(b.spent).toBe(400);
    expect(b.remaining).toBe(600);
    expect(b.utilization).toBe(40);
    expect(b.limitAmount).toBe(1000);
  });

  it("caps utilization at 100 when over budget", async () => {
    const ctx = makeCtx({
      budget: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "b-2", organisationId: ORG, name: "Rent",
            category: "Rent", limitAmount: dec(500), period: "MONTHLY",
            isArchived: false, createdAt: new Date(), updatedAt: new Date(),
          },
        ]),
      },
      journalLine: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { debit: dec(750) } }),
      },
    });

    const [b] = await budgetsCaller(ctx).list({ includeArchived: false });
    expect(b.utilization).toBe(100);
    expect(b.remaining).toBe(0);
  });

  it("includes archived budgets when includeArchived = true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      budget: { findMany },
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: { debit: null } }) },
    });

    await budgetsCaller(ctx).list({ includeArchived: true });
    // When includeArchived=true the where clause should not contain isArchived:false
    const where = findMany.mock.calls[0][0].where;
    expect(where.isArchived).toBeUndefined();
  });
});

describe("budgetsRouter.create", () => {
  it("creates a budget with correct fields", async () => {
    const created = {
      id: "b-new", organisationId: ORG, name: "Software",
      category: "Software & Subscriptions", limitAmount: dec(500), period: "MONTHLY",
      isArchived: false, createdAt: new Date(), updatedAt: new Date(),
    };
    const ctx = makeCtx({ budget: { create: vi.fn().mockResolvedValue(created) } });

    const result = await budgetsCaller(ctx).create({
      name: "Software", category: "Software & Subscriptions",
      limitAmount: 500, period: "MONTHLY",
    });
    expect(result.id).toBe("b-new");
    expect(result.name).toBe("Software");
  });

  it("passes a Prisma.Decimal for limitAmount", async () => {
    const create = vi.fn().mockResolvedValue({ id: "x" });
    const ctx = makeCtx({ budget: { create } });
    await budgetsCaller(ctx).create({ name: "X", category: "Y", limitAmount: 123.45, period: "WEEKLY" });
    const data = create.mock.calls[0][0].data;
    expect(data.limitAmount).toBeInstanceOf(Prisma.Decimal);
    expect(Number(data.limitAmount)).toBe(123.45);
  });
});

describe("budgetsRouter.update", () => {
  it("throws NOT_FOUND when budget does not belong to org", async () => {
    const ctx = makeCtx({ budget: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(budgetsCaller(ctx).update({ id: "missing" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates fields when budget exists", async () => {
    const existing = { id: "b-1", organisationId: ORG };
    const updated = { ...existing, name: "New Name" };
    const ctx = makeCtx({
      budget: {
        findFirst: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue(updated),
      },
    });
    const result = await budgetsCaller(ctx).update({ id: "b-1", name: "New Name" });
    expect(result.name).toBe("New Name");
  });
});

describe("budgetsRouter.archive", () => {
  it("throws NOT_FOUND for unknown id", async () => {
    const ctx = makeCtx({ budget: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(budgetsCaller(ctx).archive({ id: "gone" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sets isArchived = true", async () => {
    const existing = { id: "b-1" };
    const update = vi.fn().mockResolvedValue({ ...existing, isArchived: true });
    const ctx = makeCtx({
      budget: { findFirst: vi.fn().mockResolvedValue(existing), update },
    });
    await budgetsCaller(ctx).archive({ id: "b-1" });
    expect(update.mock.calls[0][0].data.isArchived).toBe(true);
  });
});

describe("budgetsRouter.delete", () => {
  it("throws NOT_FOUND for unknown id", async () => {
    const ctx = makeCtx({ budget: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(budgetsCaller(ctx).delete({ id: "gone" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns { success: true } on successful delete", async () => {
    const ctx = makeCtx({
      budget: {
        findFirst: vi.fn().mockResolvedValue({ id: "b-1" }),
        delete: vi.fn().mockResolvedValue({}),
      },
    });
    const result = await budgetsCaller(ctx).delete({ id: "b-1" });
    expect(result).toEqual({ success: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GOALS ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const goalsCaller = createCallerFactory(goalsRouter);

describe("goalsRouter.list", () => {
  it("returns empty array when no goals", async () => {
    const ctx = makeCtx({ goal: { findMany: vi.fn().mockResolvedValue([]) } });
    expect(await goalsCaller(ctx).list({ status: "ALL" })).toEqual([]);
  });

  it("enriches goals with progress and remaining", async () => {
    const ctx = makeCtx({
      goal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "g-1", organisationId: ORG, name: "Emergency Fund",
            description: null, targetAmount: dec(10000), currentAmount: dec(3500),
            targetDate: null, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(),
          },
        ]),
      },
    });
    const [g] = await goalsCaller(ctx).list({ status: "ALL" });
    expect(g.progress).toBe(35);
    expect(g.remaining).toBeCloseTo(6500);
    expect(g.targetAmount).toBe(10000);
    expect(g.currentAmount).toBe(3500);
  });

  it("caps progress at 100 when over-saved", async () => {
    const ctx = makeCtx({
      goal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "g-2", organisationId: ORG, name: "Holiday",
            description: null, targetAmount: dec(1000), currentAmount: dec(1200),
            targetDate: null, status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(),
          },
        ]),
      },
    });
    const [g] = await goalsCaller(ctx).list({ status: "ALL" });
    expect(g.progress).toBe(100);
    expect(g.remaining).toBe(0);
  });

  it("filters by status when not ALL", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ goal: { findMany } });
    await goalsCaller(ctx).list({ status: "COMPLETED" });
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe("COMPLETED");
  });

  it("omits status filter when ALL", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ goal: { findMany } });
    await goalsCaller(ctx).list({ status: "ALL" });
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
  });
});

describe("goalsRouter.create", () => {
  it("creates a goal with ACTIVE status", async () => {
    const create = vi.fn().mockResolvedValue({ id: "g-new", status: "ACTIVE" });
    const ctx = makeCtx({ goal: { create } });
    await goalsCaller(ctx).create({ name: "Car fund", targetAmount: 20000, currentAmount: 0 });
    expect(create.mock.calls[0][0].data.status).toBe("ACTIVE");
  });

  it("stores Prisma.Decimal values for monetary fields", async () => {
    const create = vi.fn().mockResolvedValue({ id: "g-new" });
    const ctx = makeCtx({ goal: { create } });
    await goalsCaller(ctx).create({ name: "X", targetAmount: 5000, currentAmount: 250 });
    const { data } = create.mock.calls[0][0];
    expect(data.targetAmount).toBeInstanceOf(Prisma.Decimal);
    expect(data.currentAmount).toBeInstanceOf(Prisma.Decimal);
  });
});

describe("goalsRouter.contribute", () => {
  it("throws NOT_FOUND when goal does not exist", async () => {
    const ctx = makeCtx({ goal: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(goalsCaller(ctx).contribute({ id: "missing", amount: 100 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws BAD_REQUEST when goal is not ACTIVE", async () => {
    const ctx = makeCtx({
      goal: {
        findFirst: vi.fn().mockResolvedValue({
          id: "g-1", currentAmount: dec(500), targetAmount: dec(1000), status: "COMPLETED",
        }),
      },
    });
    await expect(goalsCaller(ctx).contribute({ id: "g-1", amount: 100 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("adds contribution to currentAmount", async () => {
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      goal: {
        findFirst: vi.fn().mockResolvedValue({
          id: "g-1", currentAmount: dec(500), targetAmount: dec(1000), status: "ACTIVE",
        }),
        update,
      },
    });
    await goalsCaller(ctx).contribute({ id: "g-1", amount: 200 });
    const newAmount = Number(update.mock.calls[0][0].data.currentAmount);
    expect(newAmount).toBe(700);
  });

  it("auto-completes goal when contribution reaches target", async () => {
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      goal: {
        findFirst: vi.fn().mockResolvedValue({
          id: "g-1", currentAmount: dec(900), targetAmount: dec(1000), status: "ACTIVE",
        }),
        update,
      },
    });
    await goalsCaller(ctx).contribute({ id: "g-1", amount: 100 }); // exactly hits target
    expect(update.mock.calls[0][0].data.status).toBe("COMPLETED");
  });

  it("auto-completes when contribution exceeds target", async () => {
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      goal: {
        findFirst: vi.fn().mockResolvedValue({
          id: "g-1", currentAmount: dec(0), targetAmount: dec(500), status: "ACTIVE",
        }),
        update,
      },
    });
    await goalsCaller(ctx).contribute({ id: "g-1", amount: 999 });
    expect(update.mock.calls[0][0].data.status).toBe("COMPLETED");
  });

  it("does not mark COMPLETED when still short", async () => {
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      goal: {
        findFirst: vi.fn().mockResolvedValue({
          id: "g-1", currentAmount: dec(0), targetAmount: dec(1000), status: "ACTIVE",
        }),
        update,
      },
    });
    await goalsCaller(ctx).contribute({ id: "g-1", amount: 499 });
    expect(update.mock.calls[0][0].data.status).toBeUndefined();
  });
});

describe("goalsRouter.update", () => {
  it("throws NOT_FOUND for unknown id", async () => {
    const ctx = makeCtx({ goal: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(goalsCaller(ctx).update({ id: "nope", status: "CANCELLED" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates status field", async () => {
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      goal: {
        findFirst: vi.fn().mockResolvedValue({ id: "g-1" }),
        update,
      },
    });
    await goalsCaller(ctx).update({ id: "g-1", status: "CANCELLED" });
    expect(update.mock.calls[0][0].data.status).toBe("CANCELLED");
  });
});

describe("goalsRouter.delete", () => {
  it("throws NOT_FOUND for unknown id", async () => {
    const ctx = makeCtx({ goal: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(goalsCaller(ctx).delete({ id: "nope" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns { success: true } on success", async () => {
    const ctx = makeCtx({
      goal: {
        findFirst: vi.fn().mockResolvedValue({ id: "g-1" }),
        delete: vi.fn().mockResolvedValue({}),
      },
    });
    expect(await goalsCaller(ctx).delete({ id: "g-1" })).toEqual({ success: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RECURRING ITEMS ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const recurringCaller = createCallerFactory(recurringItemsRouter);

function makeRecurringItem(overrides: Partial<{
  id: string; name: string; amount: number; type: string;
  frequency: string; nextDueDate: Date; isActive: boolean;
  category: string | null; lastPaidAt: Date | null;
}> = {}) {
  return {
    id: "ri-1", organisationId: ORG, name: "Office Rent",
    description: null, amount: dec(2000), type: "EXPENSE",
    frequency: "MONTHLY", category: "Rent",
    nextDueDate: new Date(Date.now() + 5 * 86_400_000), // 5 days from now
    lastPaidAt: null, isActive: true,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
    ...(overrides.amount !== undefined ? { amount: dec(overrides.amount) } : {}),
  };
}

describe("recurringItemsRouter.list", () => {
  it("returns empty array when no items", async () => {
    const ctx = makeCtx({ recurringItem: { findMany: vi.fn().mockResolvedValue([]) } });
    expect(await recurringCaller(ctx).list({ activeOnly: false })).toEqual([]);
  });

  it("attaches isDue = false for future items", async () => {
    const future = new Date(Date.now() + 10 * 86_400_000);
    const ctx = makeCtx({
      recurringItem: { findMany: vi.fn().mockResolvedValue([makeRecurringItem({ nextDueDate: future })]) },
    });
    const [item] = await recurringCaller(ctx).list({ activeOnly: true });
    expect(item.isDue).toBe(false);
    expect(item.daysUntilDue).toBeGreaterThan(0);
  });

  it("attaches isDue = true for past-due items", async () => {
    const past = new Date(Date.now() - 2 * 86_400_000);
    const ctx = makeCtx({
      recurringItem: { findMany: vi.fn().mockResolvedValue([makeRecurringItem({ nextDueDate: past })]) },
    });
    const [item] = await recurringCaller(ctx).list({ activeOnly: true });
    expect(item.isDue).toBe(true);
    expect(item.daysUntilDue).toBeLessThan(0);
  });

  it("converts amount Decimal to number", async () => {
    const ctx = makeCtx({
      recurringItem: { findMany: vi.fn().mockResolvedValue([makeRecurringItem({ amount: 1500 })]) },
    });
    const [item] = await recurringCaller(ctx).list({ activeOnly: false });
    expect(item.amount).toBe(1500);
    expect(typeof item.amount).toBe("number");
  });

  it("filters by isActive when activeOnly = true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ recurringItem: { findMany } });
    await recurringCaller(ctx).list({ activeOnly: true });
    expect(findMany.mock.calls[0][0].where.isActive).toBe(true);
  });

  it("does not filter by isActive when activeOnly = false", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ recurringItem: { findMany } });
    await recurringCaller(ctx).list({ activeOnly: false });
    expect(findMany.mock.calls[0][0].where.isActive).toBeUndefined();
  });
});

describe("recurringItemsRouter.markPaid", () => {
  it("throws NOT_FOUND for unknown item", async () => {
    const ctx = makeCtx({ recurringItem: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(recurringCaller(ctx).markPaid({ id: "nope" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("advances nextDueDate by 1 month for MONTHLY frequency", async () => {
    const currentDue = new Date(2026, 4, 1); // May 1 local
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      recurringItem: {
        findFirst: vi.fn().mockResolvedValue(
          makeRecurringItem({ nextDueDate: currentDue, frequency: "MONTHLY" })
        ),
        update,
      },
    });
    await recurringCaller(ctx).markPaid({ id: "ri-1" });
    const nextDue: Date = update.mock.calls[0][0].data.nextDueDate;
    expect(nextDue.getMonth()).toBe(5); // June
    expect(nextDue.getDate()).toBe(1);
  });

  it("advances nextDueDate by 7 days for WEEKLY frequency", async () => {
    const currentDue = new Date(2026, 4, 15); // May 15 local
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      recurringItem: {
        findFirst: vi.fn().mockResolvedValue(
          makeRecurringItem({ nextDueDate: currentDue, frequency: "WEEKLY" })
        ),
        update,
      },
    });
    await recurringCaller(ctx).markPaid({ id: "ri-1" });
    const nextDue: Date = update.mock.calls[0][0].data.nextDueDate;
    expect(nextDue.getDate()).toBe(22);
  });

  it("advances nextDueDate by 1 year for YEARLY frequency", async () => {
    const currentDue = new Date(2026, 0, 10); // Jan 10 local
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      recurringItem: {
        findFirst: vi.fn().mockResolvedValue(
          makeRecurringItem({ nextDueDate: currentDue, frequency: "YEARLY" })
        ),
        update,
      },
    });
    await recurringCaller(ctx).markPaid({ id: "ri-1" });
    const nextDue: Date = update.mock.calls[0][0].data.nextDueDate;
    expect(nextDue.getFullYear()).toBe(2027);
  });

  it("records lastPaidAt as current time", async () => {
    const before = Date.now();
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      recurringItem: {
        findFirst: vi.fn().mockResolvedValue(makeRecurringItem()),
        update,
      },
    });
    await recurringCaller(ctx).markPaid({ id: "ri-1" });
    const lastPaidAt: Date = update.mock.calls[0][0].data.lastPaidAt;
    expect(lastPaidAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("recurringItemsRouter.summary", () => {
  it("returns zeros when no active items", async () => {
    const ctx = makeCtx({ recurringItem: { findMany: vi.fn().mockResolvedValue([]) } });
    const result = await recurringCaller(ctx).summary();
    expect(result.monthlyIncome).toBe(0);
    expect(result.monthlyExpense).toBe(0);
    expect(result.monthlyNet).toBe(0);
    expect(result.totalItems).toBe(0);
  });

  it("calculates monthly income correctly from yearly amount", async () => {
    const ctx = makeCtx({
      recurringItem: {
        findMany: vi.fn().mockResolvedValue([
          makeRecurringItem({ amount: 60000, frequency: "YEARLY", type: "INCOME" }),
        ]),
      },
    });
    const result = await recurringCaller(ctx).summary();
    expect(result.monthlyIncome).toBeCloseTo(5000);
    expect(result.monthlyExpense).toBe(0);
  });

  it("separates income and expense correctly", async () => {
    const ctx = makeCtx({
      recurringItem: {
        findMany: vi.fn().mockResolvedValue([
          makeRecurringItem({ id: "ri-1", amount: 5000, frequency: "MONTHLY", type: "INCOME" }),
          makeRecurringItem({ id: "ri-2", amount: 1200, frequency: "MONTHLY", type: "EXPENSE" }),
          makeRecurringItem({ id: "ri-3", amount: 300, frequency: "MONTHLY", type: "EXPENSE" }),
        ]),
      },
    });
    const result = await recurringCaller(ctx).summary();
    expect(result.monthlyIncome).toBeCloseTo(5000);
    expect(result.monthlyExpense).toBeCloseTo(1500);
    expect(result.monthlyNet).toBeCloseTo(3500);
  });

  it("returns total count of active items", async () => {
    const ctx = makeCtx({
      recurringItem: {
        findMany: vi.fn().mockResolvedValue([
          makeRecurringItem({ id: "ri-1" }),
          makeRecurringItem({ id: "ri-2" }),
          makeRecurringItem({ id: "ri-3" }),
        ]),
      },
    });
    const result = await recurringCaller(ctx).summary();
    expect(result.totalItems).toBe(3);
  });

  it("queries only active items for summary", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ recurringItem: { findMany } });
    await recurringCaller(ctx).summary();
    expect(findMany.mock.calls[0][0].where.isActive).toBe(true);
  });
});

describe("recurringItemsRouter.create", () => {
  it("creates item with Decimal amount", async () => {
    const create = vi.fn().mockResolvedValue({ id: "ri-new" });
    const ctx = makeCtx({ recurringItem: { create } });
    await recurringCaller(ctx).create({
      name: "Rent", amount: 2000, type: "EXPENSE",
      frequency: "MONTHLY", nextDueDate: new Date("2026-06-01"),
    });
    expect(create.mock.calls[0][0].data.amount).toBeInstanceOf(Prisma.Decimal);
    expect(Number(create.mock.calls[0][0].data.amount)).toBe(2000);
  });
});

describe("recurringItemsRouter.update", () => {
  it("throws NOT_FOUND for unknown item", async () => {
    const ctx = makeCtx({ recurringItem: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(recurringCaller(ctx).update({ id: "nope", isActive: false }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates isActive to false (deactivate)", async () => {
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      recurringItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "ri-1" }),
        update,
      },
    });
    await recurringCaller(ctx).update({ id: "ri-1", isActive: false });
    expect(update.mock.calls[0][0].data.isActive).toBe(false);
  });
});

describe("recurringItemsRouter.delete", () => {
  it("throws NOT_FOUND for unknown item", async () => {
    const ctx = makeCtx({ recurringItem: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(recurringCaller(ctx).delete({ id: "nope" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns { success: true } on success", async () => {
    const ctx = makeCtx({
      recurringItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "ri-1" }),
        delete: vi.fn().mockResolvedValue({}),
      },
    });
    expect(await recurringCaller(ctx).delete({ id: "ri-1" })).toEqual({ success: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WATCHLISTS ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const watchlistsCaller = createCallerFactory(watchlistsRouter);

function makeWatchlist(overrides: Partial<{
  id: string; name: string; category: string;
  threshold: number; period: string; isActive: boolean;
}> = {}) {
  return {
    id: "wl-1", organisationId: ORG, name: "Software spend",
    category: "Software", threshold: dec(1000),
    period: "MONTHLY", isActive: true,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
    ...(overrides.threshold !== undefined ? { threshold: dec(overrides.threshold) } : {}),
  };
}

describe("watchlistsRouter.list", () => {
  it("returns empty array when no watchlists", async () => {
    const ctx = makeCtx({
      watchlist: { findMany: vi.fn().mockResolvedValue([]) },
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: { debit: null } }) },
    });
    expect(await watchlistsCaller(ctx).list()).toEqual([]);
  });

  it("enriches with spent, isBreached, percentUsed — not breached", async () => {
    const ctx = makeCtx({
      watchlist: { findMany: vi.fn().mockResolvedValue([makeWatchlist()]) },
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: { debit: dec(400) } }) },
    });
    const [wl] = await watchlistsCaller(ctx).list();
    expect(wl.spent).toBe(400);
    expect(wl.isBreached).toBe(false);
    expect(wl.percentUsed).toBe(40);
    expect(wl.threshold).toBe(1000);
  });

  it("marks isBreached = true when spend exceeds threshold", async () => {
    const ctx = makeCtx({
      watchlist: { findMany: vi.fn().mockResolvedValue([makeWatchlist({ threshold: 500 })]) },
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: { debit: dec(600) } }) },
    });
    const [wl] = await watchlistsCaller(ctx).list();
    expect(wl.isBreached).toBe(true);
    expect(wl.percentUsed).toBe(120);
  });

  it("isBreached = false at exactly threshold", async () => {
    const ctx = makeCtx({
      watchlist: { findMany: vi.fn().mockResolvedValue([makeWatchlist({ threshold: 1000 })]) },
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: { debit: dec(1000) } }) },
    });
    const [wl] = await watchlistsCaller(ctx).list();
    expect(wl.isBreached).toBe(false); // strict >
    expect(wl.percentUsed).toBe(100);
  });

  it("handles null debit sum (no matching lines)", async () => {
    const ctx = makeCtx({
      watchlist: { findMany: vi.fn().mockResolvedValue([makeWatchlist()]) },
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: { debit: null } }) },
    });
    const [wl] = await watchlistsCaller(ctx).list();
    expect(wl.spent).toBe(0);
    expect(wl.isBreached).toBe(false);
  });

  it("queries only active watchlists", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      watchlist: { findMany },
      journalLine: { aggregate: vi.fn().mockResolvedValue({ _sum: { debit: null } }) },
    });
    await watchlistsCaller(ctx).list();
    expect(findMany.mock.calls[0][0].where.isActive).toBe(true);
  });
});

describe("watchlistsRouter.create", () => {
  it("stores Prisma.Decimal for threshold", async () => {
    const create = vi.fn().mockResolvedValue({ id: "wl-new" });
    const ctx = makeCtx({ watchlist: { create } });
    await watchlistsCaller(ctx).create({
      name: "Ads", category: "Advertising", threshold: 2500, period: "MONTHLY",
    });
    const data = create.mock.calls[0][0].data;
    expect(data.threshold).toBeInstanceOf(Prisma.Decimal);
    expect(Number(data.threshold)).toBe(2500);
  });
});

describe("watchlistsRouter.update", () => {
  it("throws NOT_FOUND for unknown id", async () => {
    const ctx = makeCtx({ watchlist: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(watchlistsCaller(ctx).update({ id: "nope", isActive: false }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("toggles isActive to false (pause)", async () => {
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      watchlist: {
        findFirst: vi.fn().mockResolvedValue({ id: "wl-1" }),
        update,
      },
    });
    await watchlistsCaller(ctx).update({ id: "wl-1", isActive: false });
    expect(update.mock.calls[0][0].data.isActive).toBe(false);
  });

  it("converts threshold to Prisma.Decimal on update", async () => {
    const update = vi.fn().mockResolvedValue({});
    const ctx = makeCtx({
      watchlist: {
        findFirst: vi.fn().mockResolvedValue({ id: "wl-1" }),
        update,
      },
    });
    await watchlistsCaller(ctx).update({ id: "wl-1", threshold: 999 });
    expect(update.mock.calls[0][0].data.threshold).toBeInstanceOf(Prisma.Decimal);
  });
});

describe("watchlistsRouter.delete", () => {
  it("throws NOT_FOUND for unknown id", async () => {
    const ctx = makeCtx({ watchlist: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(watchlistsCaller(ctx).delete({ id: "nope" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns { success: true } on success", async () => {
    const ctx = makeCtx({
      watchlist: {
        findFirst: vi.fn().mockResolvedValue({ id: "wl-1" }),
        delete: vi.fn().mockResolvedValue({}),
      },
    });
    expect(await watchlistsCaller(ctx).delete({ id: "wl-1" })).toEqual({ success: true });
  });
});
