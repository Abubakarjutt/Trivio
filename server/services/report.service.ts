import { type PrismaClient, AccountType } from "@prisma/client";
import { Prisma } from "@prisma/client";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface AccountBalance {
  code: string;
  name: string;
  type: AccountType;
  total: Prisma.Decimal;
}

export interface ProfitAndLossResult {
  accounts: AccountBalance[];
  totalIncome: Prisma.Decimal;
  totalExpenses: Prisma.Decimal;
  netProfit: Prisma.Decimal;
}

export interface BalanceSheetResult {
  assets: AccountBalance[];
  liabilities: AccountBalance[];
  equity: AccountBalance[];
  totalAssets: Prisma.Decimal;
  totalLiabilities: Prisma.Decimal;
  totalEquity: Prisma.Decimal;
}

export interface TrialBalanceAccount {
  code: string;
  name: string;
  type: AccountType;
  totalDebit: Prisma.Decimal;
  totalCredit: Prisma.Decimal;
  balance: Prisma.Decimal;
}

export interface TrialBalanceResult {
  accounts: TrialBalanceAccount[];
  totalDebits: Prisma.Decimal;
  totalCredits: Prisma.Decimal;
}

export interface TaxSummaryResult {
  outputTax: Prisma.Decimal;
  inputTax: Prisma.Decimal;
  netTaxPayable: Prisma.Decimal;
  invoiceCount: number;
  billCount: number;
}

export async function getProfitAndLoss(
  prisma: PrismaClient,
  organisationId: string,
  range: DateRange
): Promise<ProfitAndLossResult> {
  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: {
        organisationId,
        isVoid: false,
        date: {
          gte: range.from,
          lte: range.to,
        },
      },
      account: {
        type: { in: ["INCOME", "EXPENSE"] },
        isArchived: false,
      },
    },
    include: {
      account: {
        select: { code: true, name: true, type: true },
      },
    },
  });

  // Aggregate by account
  const accountMap = new Map<string, { code: string; name: string; type: AccountType; debit: Prisma.Decimal; credit: Prisma.Decimal }>();

  for (const line of lines) {
    const key = line.accountId;
    if (!accountMap.has(key)) {
      accountMap.set(key, {
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      });
    }
    const entry = accountMap.get(key)!;
    entry.debit = entry.debit.plus(line.debit ?? 0);
    entry.credit = entry.credit.plus(line.credit ?? 0);
  }

  const accounts: AccountBalance[] = [];
  let totalIncome = new Prisma.Decimal(0);
  let totalExpenses = new Prisma.Decimal(0);

  for (const [, acct] of accountMap) {
    let total: Prisma.Decimal;
    if (acct.type === "INCOME") {
      // Income: normal balance is credit, so total = credits - debits
      total = acct.credit.minus(acct.debit);
      totalIncome = totalIncome.plus(total);
    } else {
      // Expense: normal balance is debit, so total = debits - credits
      total = acct.debit.minus(acct.credit);
      totalExpenses = totalExpenses.plus(total);
    }
    accounts.push({ code: acct.code, name: acct.name, type: acct.type, total });
  }

  // Sort by code
  accounts.sort((a, b) => a.code.localeCompare(b.code));

  const netProfit = totalIncome.minus(totalExpenses);

  return { accounts, totalIncome, totalExpenses, netProfit };
}

export async function getBalanceSheet(
  prisma: PrismaClient,
  organisationId: string,
  asOf: Date
): Promise<BalanceSheetResult> {
  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: {
        organisationId,
        isVoid: false,
        date: { lte: asOf },
      },
      account: {
        type: { in: ["ASSET", "LIABILITY", "EQUITY"] },
        isArchived: false,
      },
    },
    include: {
      account: {
        select: { code: true, name: true, type: true },
      },
    },
  });

  const accountMap = new Map<string, { code: string; name: string; type: AccountType; debit: Prisma.Decimal; credit: Prisma.Decimal }>();

  for (const line of lines) {
    const key = line.accountId;
    if (!accountMap.has(key)) {
      accountMap.set(key, {
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      });
    }
    const entry = accountMap.get(key)!;
    entry.debit = entry.debit.plus(line.debit ?? 0);
    entry.credit = entry.credit.plus(line.credit ?? 0);
  }

  const assets: AccountBalance[] = [];
  const liabilities: AccountBalance[] = [];
  const equity: AccountBalance[] = [];
  let totalAssets = new Prisma.Decimal(0);
  let totalLiabilities = new Prisma.Decimal(0);
  let totalEquity = new Prisma.Decimal(0);

  for (const [, acct] of accountMap) {
    let total: Prisma.Decimal;
    if (acct.type === "ASSET") {
      // Asset: debit-normal
      total = acct.debit.minus(acct.credit);
      totalAssets = totalAssets.plus(total);
      assets.push({ code: acct.code, name: acct.name, type: acct.type, total });
    } else if (acct.type === "LIABILITY") {
      // Liability: credit-normal
      total = acct.credit.minus(acct.debit);
      totalLiabilities = totalLiabilities.plus(total);
      liabilities.push({ code: acct.code, name: acct.name, type: acct.type, total });
    } else {
      // Equity: credit-normal
      total = acct.credit.minus(acct.debit);
      totalEquity = totalEquity.plus(total);
      equity.push({ code: acct.code, name: acct.name, type: acct.type, total });
    }
  }

  assets.sort((a, b) => a.code.localeCompare(b.code));
  liabilities.sort((a, b) => a.code.localeCompare(b.code));
  equity.sort((a, b) => a.code.localeCompare(b.code));

  return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity };
}

export async function getTrialBalance(
  prisma: PrismaClient,
  organisationId: string,
  range: DateRange
): Promise<TrialBalanceResult> {
  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntry: {
        organisationId,
        isVoid: false,
        date: {
          gte: range.from,
          lte: range.to,
        },
      },
      account: {
        isArchived: false,
      },
    },
    include: {
      account: {
        select: { code: true, name: true, type: true },
      },
    },
  });

  const accountMap = new Map<string, { code: string; name: string; type: AccountType; debit: Prisma.Decimal; credit: Prisma.Decimal }>();

  for (const line of lines) {
    const key = line.accountId;
    if (!accountMap.has(key)) {
      accountMap.set(key, {
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      });
    }
    const entry = accountMap.get(key)!;
    entry.debit = entry.debit.plus(line.debit ?? 0);
    entry.credit = entry.credit.plus(line.credit ?? 0);
  }

  const accounts: TrialBalanceAccount[] = [];
  let totalDebits = new Prisma.Decimal(0);
  let totalCredits = new Prisma.Decimal(0);

  for (const [, acct] of accountMap) {
    const balance = acct.debit.minus(acct.credit);
    accounts.push({
      code: acct.code,
      name: acct.name,
      type: acct.type,
      totalDebit: acct.debit,
      totalCredit: acct.credit,
      balance,
    });
    totalDebits = totalDebits.plus(acct.debit);
    totalCredits = totalCredits.plus(acct.credit);
  }

  accounts.sort((a, b) => a.code.localeCompare(b.code));

  return { accounts, totalDebits, totalCredits };
}

export async function getTaxSummary(
  prisma: PrismaClient,
  organisationId: string,
  range: DateRange
): Promise<TaxSummaryResult> {
  const [invoiceAgg, billAgg] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        organisationId,
        status: { not: "VOID" },
        date: {
          gte: range.from,
          lte: range.to,
        },
      },
      _sum: { taxAmount: true },
      _count: { id: true },
    }),
    prisma.bill.aggregate({
      where: {
        organisationId,
        status: { not: "VOID" },
        date: {
          gte: range.from,
          lte: range.to,
        },
      },
      _sum: { taxAmount: true },
      _count: { id: true },
    }),
  ]);

  const outputTax = new Prisma.Decimal(invoiceAgg._sum.taxAmount ?? 0);
  const inputTax = new Prisma.Decimal(billAgg._sum.taxAmount ?? 0);
  const netTaxPayable = outputTax.minus(inputTax);

  return {
    outputTax,
    inputTax,
    netTaxPayable,
    invoiceCount: invoiceAgg._count.id,
    billCount: billAgg._count.id,
  };
}
