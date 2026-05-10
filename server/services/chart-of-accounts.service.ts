import { type PrismaClient } from "@prisma/client";

const DEFAULT_ACCOUNTS = [
  // Assets
  { code: "1000", name: "Current Assets", type: "ASSET" as const, normalBalance: "DEBIT" as const, isParent: true },
  { code: "1100", name: "Cash at Bank", type: "ASSET" as const, normalBalance: "DEBIT" as const, parentCode: "1000" },
  { code: "1110", name: "Petty Cash", type: "ASSET" as const, normalBalance: "DEBIT" as const, parentCode: "1000" },
  { code: "1200", name: "Accounts Receivable", type: "ASSET" as const, normalBalance: "DEBIT" as const, parentCode: "1000" },
  { code: "1300", name: "Prepaid Expenses", type: "ASSET" as const, normalBalance: "DEBIT" as const, parentCode: "1000" },
  { code: "1500", name: "Fixed Assets", type: "ASSET" as const, normalBalance: "DEBIT" as const, isParent: true },
  { code: "1510", name: "Equipment", type: "ASSET" as const, normalBalance: "DEBIT" as const, parentCode: "1500" },
  { code: "1520", name: "Furniture & Fixtures", type: "ASSET" as const, normalBalance: "DEBIT" as const, parentCode: "1500" },
  // Liabilities
  { code: "2000", name: "Current Liabilities", type: "LIABILITY" as const, normalBalance: "CREDIT" as const, isParent: true },
  { code: "2100", name: "Accounts Payable", type: "LIABILITY" as const, normalBalance: "CREDIT" as const, parentCode: "2000" },
  { code: "2200", name: "Tax Payable", type: "LIABILITY" as const, normalBalance: "CREDIT" as const, parentCode: "2000" },
  { code: "2300", name: "Accrued Liabilities", type: "LIABILITY" as const, normalBalance: "CREDIT" as const, parentCode: "2000" },
  { code: "2500", name: "Long-term Liabilities", type: "LIABILITY" as const, normalBalance: "CREDIT" as const, isParent: true },
  { code: "2510", name: "Loans Payable", type: "LIABILITY" as const, normalBalance: "CREDIT" as const, parentCode: "2500" },
  // Equity
  { code: "3000", name: "Equity", type: "EQUITY" as const, normalBalance: "CREDIT" as const, isParent: true },
  { code: "3100", name: "Owner's Capital", type: "EQUITY" as const, normalBalance: "CREDIT" as const, parentCode: "3000" },
  { code: "3200", name: "Retained Earnings", type: "EQUITY" as const, normalBalance: "CREDIT" as const, parentCode: "3000" },
  { code: "3300", name: "Owner's Drawings", type: "EQUITY" as const, normalBalance: "DEBIT" as const, parentCode: "3000" },
  // Income
  { code: "4000", name: "Income", type: "INCOME" as const, normalBalance: "CREDIT" as const, isParent: true },
  { code: "4100", name: "Sales Revenue", type: "INCOME" as const, normalBalance: "CREDIT" as const, parentCode: "4000" },
  { code: "4200", name: "Service Revenue", type: "INCOME" as const, normalBalance: "CREDIT" as const, parentCode: "4000" },
  { code: "4300", name: "Other Income", type: "INCOME" as const, normalBalance: "CREDIT" as const, parentCode: "4000" },
  // Expenses
  { code: "5000", name: "Operating Expenses", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, isParent: true },
  { code: "5100", name: "Cost of Goods Sold", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
  { code: "5200", name: "Salaries & Wages", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
  { code: "5300", name: "Rent & Lease", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
  { code: "5400", name: "Utilities", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
  { code: "5500", name: "Marketing & Advertising", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
  { code: "5600", name: "Professional Fees", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
  { code: "5700", name: "Software & Subscriptions", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
  { code: "5800", name: "Travel & Entertainment", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
  { code: "5900", name: "Depreciation", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
  { code: "5950", name: "Miscellaneous Expenses", type: "EXPENSE" as const, normalBalance: "DEBIT" as const, parentCode: "5000" },
];

export async function seedDefaultChartOfAccounts(
  db: PrismaClient,
  organisationId: string
): Promise<void> {
  const existing = await db.chartAccount.count({ where: { organisationId } });
  if (existing > 0) return;

  // First pass: create parent accounts (no parentCode)
  const parents: Record<string, string> = {};
  for (const [i, account] of DEFAULT_ACCOUNTS.entries()) {
    if (!account.parentCode) {
      const created = await db.chartAccount.create({
        data: {
          organisationId,
          code: account.code,
          name: account.name,
          type: account.type,
          normalBalance: account.normalBalance,
          isSystem: true,
          sortOrder: i,
        },
      });
      parents[account.code] = created.id;
    }
  }

  // Second pass: create child accounts
  for (const [i, account] of DEFAULT_ACCOUNTS.entries()) {
    if (account.parentCode) {
      await db.chartAccount.create({
        data: {
          organisationId,
          code: account.code,
          name: account.name,
          type: account.type,
          normalBalance: account.normalBalance,
          parentId: parents[account.parentCode],
          isSystem: true,
          sortOrder: i,
        },
      });
    }
  }
}
