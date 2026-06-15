import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const monthInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });

function monthBounds(month: string | undefined): { startOfMonth: Date; endOfMonth: Date } {
  if (month) {
    const [y, m] = month.split("-").map(Number);
    return {
      startOfMonth: new Date(y, m - 1, 1),
      endOfMonth: new Date(y, m, 0, 23, 59, 59, 999),
    };
  }
  const now = new Date();
  return {
    startOfMonth: new Date(now.getFullYear(), now.getMonth(), 1),
    endOfMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

export const dashboardRouter = createTRPCRouter({
  getKPIs: orgProcedure.input(monthInput).query(async ({ ctx, input }) => {
    const { startOfMonth, endOfMonth } = monthBounds(input.month);

    const [
      incomeLines,
      expenseLines,
      arAgg,
      apAgg,
      cashLines,
    ] = await Promise.all([
      // Monthly income
      ctx.db.journalLine.findMany({
        where: {
          journalEntry: {
            organisationId: ctx.organisationId,
            isVoid: false,
            date: { gte: startOfMonth, lte: endOfMonth },
          },
          account: { type: "INCOME", isArchived: false },
        },
        select: { debit: true, credit: true },
      }),
      // Monthly expenses
      ctx.db.journalLine.findMany({
        where: {
          journalEntry: {
            organisationId: ctx.organisationId,
            isVoid: false,
            date: { gte: startOfMonth, lte: endOfMonth },
          },
          account: { type: "EXPENSE", isArchived: false },
        },
        select: { debit: true, credit: true },
      }),
      // Outstanding AR
      ctx.db.invoice.aggregate({
        where: {
          organisationId: ctx.organisationId,
          status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
        },
        _sum: { totalAmount: true, amountPaid: true },
      }),
      // Outstanding AP
      ctx.db.bill.aggregate({
        where: {
          organisationId: ctx.organisationId,
          status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
        },
        _sum: { totalAmount: true, amountPaid: true },
      }),
      // Cash/Bank position: ASSET accounts with code starting with "1" or name containing Cash/Bank
      ctx.db.journalLine.findMany({
        where: {
          journalEntry: {
            organisationId: ctx.organisationId,
            isVoid: false,
          },
          account: {
            type: "ASSET",
            isArchived: false,
            OR: [
              { code: { startsWith: "1" } },
              { name: { contains: "Cash" } },
              { name: { contains: "Bank" } },
            ],
          },
        },
        select: { debit: true, credit: true },
      }),
    ]);

    // Income: credit-normal, so total = credits - debits
    const totalIncome = incomeLines.reduce(
      (acc, l) => acc.plus(l.credit ?? 0).minus(l.debit ?? 0),
      new Prisma.Decimal(0)
    );

    // Expenses: debit-normal, so total = debits - credits
    const totalExpenses = expenseLines.reduce(
      (acc, l) => acc.plus(l.debit ?? 0).minus(l.credit ?? 0),
      new Prisma.Decimal(0)
    );

    const netProfit = totalIncome.minus(totalExpenses);

    const outstandingAR = new Prisma.Decimal(arAgg._sum.totalAmount ?? 0).minus(
      arAgg._sum.amountPaid ?? 0
    );
    const outstandingAP = new Prisma.Decimal(apAgg._sum.totalAmount ?? 0).minus(
      apAgg._sum.amountPaid ?? 0
    );

    // Cash: ASSET debit-normal, so balance = debits - credits
    const cashPosition = cashLines.reduce(
      (acc, l) => acc.plus(l.debit ?? 0).minus(l.credit ?? 0),
      new Prisma.Decimal(0)
    );

    return {
      monthlyIncome: totalIncome.toFixed(4),
      monthlyExpenses: totalExpenses.toFixed(4),
      netProfit: netProfit.toFixed(4),
      outstandingAR: outstandingAR.toFixed(4),
      outstandingAP: outstandingAP.toFixed(4),
      cashPosition: cashPosition.toFixed(4),
    };
  }),

  getIncomeExpenseTrend: orgProcedure.query(async ({ ctx }) => {
    const now = new Date();
    // Build last 12 months range
    const months: { year: number; month: number; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        year: d.getFullYear(),
        month: d.getMonth(), // 0-based
        label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      });
    }

    const start = new Date(months[0].year, months[0].month, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [incomeLines, expenseLines] = await Promise.all([
      ctx.db.journalLine.findMany({
        where: {
          journalEntry: {
            organisationId: ctx.organisationId,
            isVoid: false,
            date: { gte: start, lte: end },
          },
          account: { type: "INCOME", isArchived: false },
        },
        select: { debit: true, credit: true, journalEntry: { select: { date: true } } },
      }),
      ctx.db.journalLine.findMany({
        where: {
          journalEntry: {
            organisationId: ctx.organisationId,
            isVoid: false,
            date: { gte: start, lte: end },
          },
          account: { type: "EXPENSE", isArchived: false },
        },
        select: { debit: true, credit: true, journalEntry: { select: { date: true } } },
      }),
    ]);

    const incomeMap = new Map<string, Prisma.Decimal>();
    const expenseMap = new Map<string, Prisma.Decimal>();

    for (const m of months) {
      incomeMap.set(m.label, new Prisma.Decimal(0));
      expenseMap.set(m.label, new Prisma.Decimal(0));
    }

    for (const l of incomeLines) {
      const d = l.journalEntry.date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const current = incomeMap.get(key);
      if (current !== undefined) {
        incomeMap.set(key, current.plus(l.credit ?? 0).minus(l.debit ?? 0));
      }
    }

    for (const l of expenseLines) {
      const d = l.journalEntry.date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const current = expenseMap.get(key);
      if (current !== undefined) {
        expenseMap.set(key, current.plus(l.debit ?? 0).minus(l.credit ?? 0));
      }
    }

    return months.map((m) => ({
      month: m.label,
      income: (incomeMap.get(m.label) ?? new Prisma.Decimal(0)).toFixed(4),
      expenses: (expenseMap.get(m.label) ?? new Prisma.Decimal(0)).toFixed(4),
    }));
  }),

  getExpenseBreakdown: orgProcedure.input(monthInput).query(async ({ ctx, input }) => {
    const { startOfMonth, endOfMonth } = monthBounds(input.month);

    const lines = await ctx.db.journalLine.findMany({
      where: {
        journalEntry: {
          organisationId: ctx.organisationId,
          isVoid: false,
          date: { gte: startOfMonth, lte: endOfMonth },
        },
        account: { type: "EXPENSE", isArchived: false },
      },
      select: {
        debit: true,
        credit: true,
        account: { select: { name: true } },
      },
    });

    const categoryMap = new Map<string, Prisma.Decimal>();
    for (const l of lines) {
      const name = l.account.name;
      const current = categoryMap.get(name) ?? new Prisma.Decimal(0);
      categoryMap.set(name, current.plus(l.debit ?? 0).minus(l.credit ?? 0));
    }

    const sorted = Array.from(categoryMap.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total.comparedTo(a.total))
      .slice(0, 6);

    return sorted.map((item) => ({
      name: item.name,
      total: item.total.toFixed(4),
    }));
  }),

  getRecentTransactions: orgProcedure.query(async ({ ctx }) => {
    const entries = await ctx.db.journalEntry.findMany({
      where: {
        organisationId: ctx.organisationId,
        isVoid: false,
      },
      orderBy: { date: "desc" },
      take: 10,
      include: {
        lines: {
          select: { debit: true },
        },
      },
    });

    return entries.map((e) => {
      const totalDebit = e.lines.reduce(
        (acc, l) => acc.plus(l.debit ?? 0),
        new Prisma.Decimal(0)
      );
      return {
        id: e.id,
        date: e.date.toISOString(),
        description: e.description,
        source: e.source,
        totalDebit: totalDebit.toFixed(4),
      };
    });
  }),

  getOutstandingInvoices: orgProcedure.query(async ({ ctx }) => {
    const invoices = await ctx.db.invoice.findMany({
      where: {
        organisationId: ctx.organisationId,
        status: { in: ["SENT", "PARTIAL", "OVERDUE"] },
      },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: {
        contact: { select: { name: true } },
      },
    });

    return invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      contactName: inv.contact.name,
      dueDate: inv.dueDate.toISOString(),
      amountDue: new Prisma.Decimal(inv.totalAmount).minus(inv.amountPaid).toFixed(4),
      status: inv.status,
    }));
  }),
});
