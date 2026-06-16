// Accounting-module sample data for the onboarding "Explore with sample data" flow.
// All records created here are tagged isSampleData=true and automatically
// cleared when the user creates their first real Invoice, Bill, or JournalEntry.

import { type PrismaClient, Prisma } from "@prisma/client";
import { seedDefaultChartOfAccounts } from "@/server/services/chart-of-accounts.service";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function loadAccountingSampleData(
  db: PrismaClient,
  organisationId: string,
): Promise<number> {
  // Ensure chart of accounts exists
  await seedDefaultChartOfAccounts(db, organisationId);

  const accts = await db.chartAccount.findMany({ where: { organisationId } });
  const by = (code: string) => {
    const a = accts.find((a) => a.code === code);
    if (!a) throw new Error(`Account ${code} not found`);
    return a.id;
  };

  const AR    = by("1200");
  const CASH  = by("1100");
  const AP    = by("2100");
  const REV   = by("4200");
  const SALES = by("4100");
  const SAL   = by("5200");
  const RENT  = by("5300");
  const UTIL  = by("5400");
  const MKT   = by("5500");
  const SW    = by("5700");

  let count = 0;

  await db.$transaction(async (tx) => {
    // ── Contacts ────────────────────────────────────────────────────────────
    const [acme, beta, gamma, delta, officeDepot, cloudHost] = await Promise.all([
      tx.contact.create({ data: { organisationId, isSampleData: true, type: "CUSTOMER", name: "Acme Corp", email: "billing@acmecorp.com", phone: "+1-555-0101" } }),
      tx.contact.create({ data: { organisationId, isSampleData: true, type: "CUSTOMER", name: "Beta Solutions", email: "accounts@betasolutions.io", phone: "+1-555-0102" } }),
      tx.contact.create({ data: { organisationId, isSampleData: true, type: "CUSTOMER", name: "Gamma Industries", email: "finance@gammaindustries.com" } }),
      tx.contact.create({ data: { organisationId, isSampleData: true, type: "CUSTOMER", name: "Delta Partners", email: "ap@deltapartners.com" } }),
      tx.contact.create({ data: { organisationId, isSampleData: true, type: "SUPPLIER", name: "Office Depot", email: "billing@officedepot.com" } }),
      tx.contact.create({ data: { organisationId, isSampleData: true, type: "SUPPLIER", name: "Cloud Hosting Co", email: "invoices@cloudhost.com" } }),
    ]);

    // ── Invoices ─────────────────────────────────────────────────────────────

    // INV-001: Acme — PAID $5,000
    const inv1 = await tx.invoice.create({
      data: {
        organisationId, contactId: acme.id, isSampleData: true,
        number: "DEMO-INV-001", date: daysAgo(65), dueDate: daysAgo(35),
        status: "PAID", subtotal: 5000, taxAmount: 0, totalAmount: 5000, amountPaid: 5000,
        notes: "Website redesign project",
        lines: { create: [
          { description: "UI/UX Design", quantity: 1, unitPrice: 2000, amount: 2000, taxAmount: 0, sortOrder: 0 },
          { description: "Frontend Development", quantity: 1, unitPrice: 2000, amount: 2000, taxAmount: 0, sortOrder: 1 },
          { description: "QA & Testing", quantity: 1, unitPrice: 1000, amount: 1000, taxAmount: 0, sortOrder: 2 },
        ]},
      },
    });
    await tx.journalEntry.create({
      data: {
        organisationId, isSampleData: true, date: daysAgo(65),
        description: "Invoice DEMO-INV-001 — Acme Corp", source: "INVOICE", sourceId: inv1.id,
        lines: { create: [
          { accountId: AR, debit: 5000 }, { accountId: REV, credit: 5000 },
        ]},
      },
    });
    await tx.journalEntry.create({
      data: {
        organisationId, isSampleData: true, date: daysAgo(32),
        description: "Payment received — DEMO-INV-001 Acme Corp", source: "MANUAL",
        lines: { create: [
          { accountId: CASH, debit: 5000 }, { accountId: AR, credit: 5000 },
        ]},
      },
    });

    // INV-002: Beta — SENT $3,500
    const inv2 = await tx.invoice.create({
      data: {
        organisationId, contactId: beta.id, isSampleData: true,
        number: "DEMO-INV-002", date: daysAgo(20), dueDate: daysFromNow(10),
        status: "SENT", subtotal: 3500, taxAmount: 0, totalAmount: 3500, amountPaid: 0,
        notes: "Monthly retainer",
        lines: { create: [
          { description: "Monthly consulting retainer", quantity: 1, unitPrice: 3500, amount: 3500, taxAmount: 0, sortOrder: 0 },
        ]},
      },
    });
    await tx.journalEntry.create({
      data: {
        organisationId, isSampleData: true, date: daysAgo(20),
        description: "Invoice DEMO-INV-002 — Beta Solutions", source: "INVOICE", sourceId: inv2.id,
        lines: { create: [
          { accountId: AR, debit: 3500 }, { accountId: REV, credit: 3500 },
        ]},
      },
    });

    // INV-003: Gamma — PARTIAL $7,200 (paid $3,600)
    const inv3 = await tx.invoice.create({
      data: {
        organisationId, contactId: gamma.id, isSampleData: true,
        number: "DEMO-INV-003", date: daysAgo(45), dueDate: daysAgo(15),
        status: "PARTIAL", subtotal: 7200, taxAmount: 0, totalAmount: 7200, amountPaid: 3600,
        notes: "Data migration project",
        lines: { create: [
          { description: "Database migration", quantity: 1, unitPrice: 3600, amount: 3600, taxAmount: 0, sortOrder: 0 },
          { description: "API integration", quantity: 1, unitPrice: 3600, amount: 3600, taxAmount: 0, sortOrder: 1 },
        ]},
      },
    });
    await tx.journalEntry.create({
      data: {
        organisationId, isSampleData: true, date: daysAgo(45),
        description: "Invoice DEMO-INV-003 — Gamma Industries", source: "INVOICE", sourceId: inv3.id,
        lines: { create: [
          { accountId: AR, debit: 7200 }, { accountId: REV, credit: 7200 },
        ]},
      },
    });
    await tx.journalEntry.create({
      data: {
        organisationId, isSampleData: true, date: daysAgo(22),
        description: "Part payment — DEMO-INV-003 Gamma Industries", source: "MANUAL",
        lines: { create: [
          { accountId: CASH, debit: 3600 }, { accountId: AR, credit: 3600 },
        ]},
      },
    });

    // INV-004: Delta — OVERDUE $1,800
    await tx.invoice.create({
      data: {
        organisationId, contactId: delta.id, isSampleData: true,
        number: "DEMO-INV-004", date: daysAgo(50), dueDate: daysAgo(20),
        status: "OVERDUE", subtotal: 1800, taxAmount: 0, totalAmount: 1800, amountPaid: 0,
        notes: "SEO audit",
        lines: { create: [
          { description: "SEO audit and recommendations", quantity: 1, unitPrice: 1800, amount: 1800, taxAmount: 0, sortOrder: 0 },
        ]},
      },
    });

    // INV-005: Acme — DRAFT $2,500
    await tx.invoice.create({
      data: {
        organisationId, contactId: acme.id, isSampleData: true,
        number: "DEMO-INV-005", date: daysAgo(2), dueDate: daysFromNow(28),
        status: "DRAFT", subtotal: 2500, taxAmount: 0, totalAmount: 2500, amountPaid: 0,
        lines: { create: [
          { description: "Backend API development", quantity: 1, unitPrice: 1500, amount: 1500, taxAmount: 0, sortOrder: 0 },
          { description: "Admin dashboard", quantity: 1, unitPrice: 1000, amount: 1000, taxAmount: 0, sortOrder: 1 },
        ]},
      },
    });

    // ── Bills ─────────────────────────────────────────────────────────────────

    // BILL-001: Office Depot — PAID $1,200
    const bill1 = await tx.bill.create({
      data: {
        organisationId, contactId: officeDepot.id, isSampleData: true,
        number: "OD-44821", date: daysAgo(60), dueDate: daysAgo(30),
        status: "PAID", subtotal: 1200, taxAmount: 0, totalAmount: 1200, amountPaid: 1200,
        lines: { create: [
          { description: "Office supplies Q1", quantity: 1, unitPrice: 1200, amount: 1200, taxAmount: 0, sortOrder: 0 },
        ]},
      },
    });
    await tx.journalEntry.create({
      data: {
        organisationId, isSampleData: true, date: daysAgo(60),
        description: "Bill OD-44821 — Office Depot", source: "BILL", sourceId: bill1.id,
        lines: { create: [
          { accountId: SW, debit: 1200, description: "Office supplies" }, { accountId: AP, credit: 1200 },
        ]},
      },
    });
    await tx.journalEntry.create({
      data: {
        organisationId, isSampleData: true, date: daysAgo(28),
        description: "Payment to Office Depot", source: "MANUAL",
        lines: { create: [
          { accountId: AP, debit: 1200 }, { accountId: CASH, credit: 1200 },
        ]},
      },
    });

    // BILL-002: Cloud Hosting — SENT $450
    await tx.bill.create({
      data: {
        organisationId, contactId: cloudHost.id, isSampleData: true,
        number: "CHC-2026-06", date: daysAgo(5), dueDate: daysFromNow(25),
        status: "SENT", subtotal: 450, taxAmount: 0, totalAmount: 450, amountPaid: 0,
        lines: { create: [
          { description: "Cloud hosting — current month", quantity: 1, unitPrice: 450, amount: 450, taxAmount: 0, sortOrder: 0 },
        ]},
      },
    });

    // ── Operating expenses ────────────────────────────────────────────────────
    const expenses = [
      { date: daysAgo(60), desc: "Office rent",   dr: RENT, amount: 4500 },
      { date: daysAgo(57), desc: "Salaries",       dr: SAL,  amount: 12000 },
      { date: daysAgo(55), desc: "Utilities",      dr: UTIL, amount: 380 },
      { date: daysAgo(50), desc: "Google Ads",     dr: MKT,  amount: 1200 },
      { date: daysAgo(30), desc: "Office rent",    dr: RENT, amount: 4500 },
      { date: daysAgo(27), desc: "Salaries",       dr: SAL,  amount: 12000 },
      { date: daysAgo(25), desc: "Internet & phone", dr: UTIL, amount: 220 },
      { date: daysAgo(12), desc: "Software subscriptions", dr: SW, amount: 495 },
      { date: daysAgo(5),  desc: "Office rent",    dr: RENT, amount: 4500 },
      { date: daysAgo(3),  desc: "Salaries",       dr: SAL,  amount: 12000 },
    ];
    for (const e of expenses) {
      await tx.journalEntry.create({
        data: {
          organisationId, isSampleData: true, date: e.date, description: e.desc, source: "MANUAL",
          lines: { create: [
            { accountId: e.dr, debit: e.amount }, { accountId: CASH, credit: e.amount },
          ]},
        },
      });
    }

    // ── Bank account + statement lines ────────────────────────────────────────
    const bankAccount = await tx.bankAccount.create({
      data: { organisationId, isSampleData: true, name: "Main Operating Account", accountId: CASH, currentBalance: 22350 },
    });
    await tx.bankStatementLine.createMany({
      data: [
        { bankAccountId: bankAccount.id, date: daysAgo(32), description: "ACME CORP PAYMENT", amount: 5000, status: "MATCHED" },
        { bankAccountId: bankAccount.id, date: daysAgo(28), description: "OFFICE DEPOT INV", amount: -1200, status: "MATCHED" },
        { bankAccountId: bankAccount.id, date: daysAgo(22), description: "GAMMA PART PMT", amount: 3600, status: "MATCHED" },
        { bankAccountId: bankAccount.id, date: daysAgo(10), description: "AWS CLOUD SERVICES", amount: -312, status: "UNMATCHED" },
        { bankAccountId: bankAccount.id, date: daysAgo(7),  description: "PAYROLL DIRECT DEPOSIT", amount: -12000, status: "MATCHED" },
        { bankAccountId: bankAccount.id, date: daysAgo(2),  description: "BANK INTEREST", amount: 24, status: "UNMATCHED" },
      ],
    });

    count = 6 + 5 + 2 + expenses.length + 1; // contacts + invoices + bills + expenses + bank
  });

  return count;
}

// Deletes everything tagged isSampleData=true for this org, then clears the flag.
export async function clearAccountingSampleData(
  db: PrismaClient,
  organisationId: string,
): Promise<void> {
  await db.$transaction([
    // JournalEntries cascade-delete their JournalLines
    db.journalEntry.deleteMany({ where: { organisationId, isSampleData: true } }),
    // Invoices cascade-delete InvoiceLine
    db.invoice.deleteMany({ where: { organisationId, isSampleData: true } }),
    // Bills cascade-delete BillLine
    db.bill.deleteMany({ where: { organisationId, isSampleData: true } }),
    // BankAccount cascade-deletes BankStatementLine
    db.bankAccount.deleteMany({ where: { organisationId, isSampleData: true } }),
    // Contacts last (invoices/bills no longer reference them)
    db.contact.deleteMany({ where: { organisationId, isSampleData: true } }),
    // StatementTransactions (PF module — isSampleData already exists there)
    db.statementTransaction.deleteMany({ where: { organisationId, isSampleData: true } }),
    // Clear the org flag
    db.organisation.update({ where: { id: organisationId }, data: { hasSampleData: false } }),
  ]);
}
