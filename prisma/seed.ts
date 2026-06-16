import {
  PrismaClient,
  ContactType,
  InvoiceStatus,
  JournalEntrySource,
  CrmLeadStatus,
  CrmLeadSource,
  CrmCompanySize,
  CrmActivityType,
  RecurringType,
  RecurringFrequency,
  BudgetPeriod,
  GoalStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { seedDefaultChartOfAccounts } from "../server/services/chart-of-accounts.service";

const db = new PrismaClient();

// ─── Tax Regimes ─────────────────────────────────────────────────────────────

const TAX_REGIMES = [
  {
    code: "NONE",
    name: "No Tax",
    country: "Global",
    rates: [{ code: "NONE", name: "No Tax (0%)", rate: 0.0 }],
  },
  {
    code: "UK_VAT",
    name: "UK VAT",
    country: "GB",
    rates: [
      { code: "STANDARD", name: "Standard Rate (20%)", rate: 0.2 },
      { code: "REDUCED", name: "Reduced Rate (5%)", rate: 0.05 },
      { code: "ZERO", name: "Zero Rate (0%)", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "EU_VAT",
    name: "EU VAT",
    country: "EU",
    rates: [
      { code: "STANDARD", name: "Standard Rate (20%)", rate: 0.2 },
      { code: "REDUCED", name: "Reduced Rate (10%)", rate: 0.1 },
      { code: "SUPER_REDUCED", name: "Super Reduced (5%)", rate: 0.05 },
      { code: "ZERO", name: "Zero Rate (0%)", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "US_SALES_TAX",
    name: "US Sales Tax",
    country: "US",
    rates: [
      { code: "STANDARD", name: "Sales Tax", rate: 0.0875 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "AU_GST",
    name: "Australian GST",
    country: "AU",
    rates: [
      { code: "STANDARD", name: "GST (10%)", rate: 0.1 },
      { code: "ZERO", name: "GST-Free", rate: 0.0 },
      { code: "EXEMPT", name: "Input Taxed", rate: 0.0 },
    ],
  },
  {
    code: "IN_GST",
    name: "Indian GST",
    country: "IN",
    rates: [
      { code: "STANDARD_28", name: "GST 28%", rate: 0.28 },
      { code: "STANDARD_18", name: "GST 18%", rate: 0.18 },
      { code: "STANDARD_12", name: "GST 12%", rate: 0.12 },
      { code: "STANDARD_5", name: "GST 5%", rate: 0.05 },
      { code: "ZERO", name: "GST 0%", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "CA_GST_HST",
    name: "Canadian GST/HST",
    country: "CA",
    rates: [
      { code: "HST", name: "HST (15%)", rate: 0.15 },
      { code: "GST", name: "GST (5%)", rate: 0.05 },
      { code: "ZERO", name: "Zero-Rated", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "PK_GST",
    name: "Pakistan GST/Sales Tax",
    country: "PK",
    rates: [
      { code: "STANDARD", name: "Standard (17%)", rate: 0.17 },
      { code: "REDUCED", name: "Reduced (5%)", rate: 0.05 },
      { code: "ZERO", name: "Zero Rate", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Tax regimes ──────────────────────────────────────────────────────────
  console.log("🌱 Seeding tax regimes...");
  for (const regime of TAX_REGIMES) {
    await db.taxRegime.upsert({
      where: { code: regime.code },
      update: {},
      create: {
        code: regime.code,
        name: regime.name,
        country: regime.country,
        rates: { create: regime.rates },
      },
    });
  }
  console.log("✅ Tax regimes seeded");

  // ── 2. Skip demo org if already present ─────────────────────────────────────
  const DEMO_EMAIL = "demo@trivio.app";
  const existingUser = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existingUser) {
    console.log("ℹ️  Demo data already exists — skipping");
    return;
  }

  // ── 3. Demo organisation + user ──────────────────────────────────────────────
  console.log("🌱 Seeding demo organisation and user...");
  const hashedPassword = await bcrypt.hash("demo1234", 12);

  const org = await db.organisation.create({
    data: {
      name: "Acme Tech Ltd",
      businessType: "COMPANY",
      currency: "USD",
      fiscalYearStartMonth: 1,
      onboardingStep: "COMPLETE",
      onboardingComplete: true,
    },
  });

  const user = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Demo User",
      hashedPassword,
      emailVerified: new Date(),
      organisationId: org.id,
      role: "OWNER",
    },
  });

  // ── 4. Chart of accounts ─────────────────────────────────────────────────────
  console.log("🌱 Seeding chart of accounts...");
  await seedDefaultChartOfAccounts(db as any, org.id);

  // Fetch the accounts we'll need by code
  const accts = await db.chartAccount.findMany({ where: { organisationId: org.id } });
  const acctByCode = Object.fromEntries(accts.map((a) => [a.code, a]));
  const AR    = acctByCode["1200"]; // Accounts Receivable
  const CASH  = acctByCode["1100"]; // Cash at Bank
  const AP    = acctByCode["2100"]; // Accounts Payable
  const REV   = acctByCode["4200"]; // Service Revenue
  const SALES = acctByCode["4100"]; // Sales Revenue
  const SAL   = acctByCode["5200"]; // Salaries & Wages
  const RENT  = acctByCode["5300"]; // Rent & Lease
  const UTIL  = acctByCode["5400"]; // Utilities
  const MKT   = acctByCode["5500"]; // Marketing & Advertising
  const PROF  = acctByCode["5600"]; // Professional Fees
  const SW    = acctByCode["5700"]; // Software & Subscriptions

  // ── 5. Contacts ──────────────────────────────────────────────────────────────
  console.log("🌱 Seeding contacts...");
  const [acme, beta, gamma, delta, officeDepot, cloudHost, agency] = await Promise.all([
    db.contact.create({ data: { organisationId: org.id, type: "CUSTOMER", name: "Acme Corp", email: "billing@acmecorp.com", phone: "+1-555-0101", address: "123 Main St, New York, NY 10001" } }),
    db.contact.create({ data: { organisationId: org.id, type: "CUSTOMER", name: "Beta Solutions", email: "accounts@betasolutions.io", phone: "+1-555-0102", address: "456 Park Ave, San Francisco, CA 94102" } }),
    db.contact.create({ data: { organisationId: org.id, type: "CUSTOMER", name: "Gamma Industries", email: "finance@gammaindustries.com", phone: "+1-555-0103", address: "789 Oak Blvd, Chicago, IL 60601" } }),
    db.contact.create({ data: { organisationId: org.id, type: "CUSTOMER", name: "Delta Partners", email: "ap@deltapartners.com", phone: "+1-555-0104" } }),
    db.contact.create({ data: { organisationId: org.id, type: "SUPPLIER", name: "Office Depot", email: "billing@officedepot.com" } }),
    db.contact.create({ data: { organisationId: org.id, type: "SUPPLIER", name: "Cloud Hosting Co", email: "invoices@cloudhost.com" } }),
    db.contact.create({ data: { organisationId: org.id, type: "SUPPLIER", name: "Creative Agency", email: "hello@creativeagency.com" } }),
  ]);

  // ── 6. Invoices ──────────────────────────────────────────────────────────────
  console.log("🌱 Seeding invoices...");

  // INV-001: Acme Corp — PAID ($5,000)
  const inv1 = await db.invoice.create({
    data: {
      organisationId: org.id,
      contactId: acme.id,
      number: "INV-001",
      date: daysAgo(65),
      dueDate: daysAgo(35),
      status: "PAID",
      subtotal: 5000,
      taxAmount: 0,
      totalAmount: 5000,
      amountPaid: 5000,
      notes: "Website redesign project",
      lines: {
        create: [
          { description: "UI/UX Design", quantity: 1, unitPrice: 2000, amount: 2000, taxAmount: 0, sortOrder: 0 },
          { description: "Frontend Development", quantity: 1, unitPrice: 2000, amount: 2000, taxAmount: 0, sortOrder: 1 },
          { description: "QA & Testing", quantity: 1, unitPrice: 1000, amount: 1000, taxAmount: 0, sortOrder: 2 },
        ],
      },
    },
  });
  // Journal: DR AR 5000 / CR Revenue 5000
  await db.journalEntry.create({
    data: {
      organisationId: org.id, date: daysAgo(65), description: "Invoice INV-001 — Acme Corp", source: "INVOICE", sourceId: inv1.id,
      lines: { create: [
        { accountId: AR.id, debit: 5000, credit: null },
        { accountId: REV.id, debit: null, credit: 5000 },
      ]},
    },
  });
  // Payment: DR Cash 5000 / CR AR 5000
  await db.journalEntry.create({
    data: {
      organisationId: org.id, date: daysAgo(32), description: "Payment received — INV-001 Acme Corp", source: "MANUAL",
      lines: { create: [
        { accountId: CASH.id, debit: 5000, credit: null },
        { accountId: AR.id, debit: null, credit: 5000 },
      ]},
    },
  });

  // INV-002: Beta Solutions — SENT ($3,500)
  const inv2 = await db.invoice.create({
    data: {
      organisationId: org.id,
      contactId: beta.id,
      number: "INV-002",
      date: daysAgo(20),
      dueDate: daysFromNow(10),
      status: "SENT",
      subtotal: 3500,
      taxAmount: 0,
      totalAmount: 3500,
      amountPaid: 0,
      notes: "Monthly retainer — April",
      lines: {
        create: [
          { description: "Monthly consulting retainer", quantity: 1, unitPrice: 3500, amount: 3500, taxAmount: 0, sortOrder: 0 },
        ],
      },
    },
  });
  await db.journalEntry.create({
    data: {
      organisationId: org.id, date: daysAgo(20), description: "Invoice INV-002 — Beta Solutions", source: "INVOICE", sourceId: inv2.id,
      lines: { create: [
        { accountId: AR.id, debit: 3500, credit: null },
        { accountId: REV.id, debit: null, credit: 3500 },
      ]},
    },
  });

  // INV-003: Gamma Industries — PARTIAL ($7,200, paid $3,600)
  const inv3 = await db.invoice.create({
    data: {
      organisationId: org.id,
      contactId: gamma.id,
      number: "INV-003",
      date: daysAgo(45),
      dueDate: daysAgo(15),
      status: "PARTIAL",
      subtotal: 7200,
      taxAmount: 0,
      totalAmount: 7200,
      amountPaid: 3600,
      notes: "Data migration & integration project",
      lines: {
        create: [
          { description: "Database migration", quantity: 1, unitPrice: 3600, amount: 3600, taxAmount: 0, sortOrder: 0 },
          { description: "API integration", quantity: 1, unitPrice: 2400, amount: 2400, taxAmount: 0, sortOrder: 1 },
          { description: "Testing & deployment", quantity: 1, unitPrice: 1200, amount: 1200, taxAmount: 0, sortOrder: 2 },
        ],
      },
    },
  });
  await db.journalEntry.create({
    data: {
      organisationId: org.id, date: daysAgo(45), description: "Invoice INV-003 — Gamma Industries", source: "INVOICE", sourceId: inv3.id,
      lines: { create: [
        { accountId: AR.id, debit: 7200, credit: null },
        { accountId: REV.id, debit: null, credit: 7200 },
      ]},
    },
  });
  await db.journalEntry.create({
    data: {
      organisationId: org.id, date: daysAgo(20), description: "Part payment received — INV-003 Gamma Industries", source: "MANUAL",
      lines: { create: [
        { accountId: CASH.id, debit: 3600, credit: null },
        { accountId: AR.id, debit: null, credit: 3600 },
      ]},
    },
  });

  // INV-004: Delta Partners — OVERDUE ($1,800)
  await db.invoice.create({
    data: {
      organisationId: org.id,
      contactId: delta.id,
      number: "INV-004",
      date: daysAgo(50),
      dueDate: daysAgo(20),
      status: "OVERDUE",
      subtotal: 1800,
      taxAmount: 0,
      totalAmount: 1800,
      amountPaid: 0,
      notes: "SEO audit report",
      lines: {
        create: [
          { description: "SEO audit and recommendations", quantity: 1, unitPrice: 1800, amount: 1800, taxAmount: 0, sortOrder: 0 },
        ],
      },
    },
  });

  // INV-005: Acme Corp — DRAFT ($2,500)
  await db.invoice.create({
    data: {
      organisationId: org.id,
      contactId: acme.id,
      number: "INV-005",
      date: daysAgo(2),
      dueDate: daysFromNow(28),
      status: "DRAFT",
      subtotal: 2500,
      taxAmount: 0,
      totalAmount: 2500,
      amountPaid: 0,
      notes: "Phase 2 development",
      lines: {
        create: [
          { description: "Backend API development", quantity: 1, unitPrice: 1500, amount: 1500, taxAmount: 0, sortOrder: 0 },
          { description: "Admin dashboard", quantity: 1, unitPrice: 1000, amount: 1000, taxAmount: 0, sortOrder: 1 },
        ],
      },
    },
  });

  // ── 7. Bills ──────────────────────────────────────────────────────────────────
  console.log("🌱 Seeding bills...");

  // BILL-001: Office Depot — PAID ($1,200)
  const bill1 = await db.bill.create({
    data: {
      organisationId: org.id,
      contactId: officeDepot.id,
      number: "OD-44821",
      date: daysAgo(60),
      dueDate: daysAgo(30),
      status: "PAID",
      subtotal: 1200,
      taxAmount: 0,
      totalAmount: 1200,
      amountPaid: 1200,
      notes: "Office supplies Q1",
      lines: {
        create: [
          { description: "Printer paper (10 reams)", quantity: 10, unitPrice: 45, amount: 450, taxAmount: 0, sortOrder: 0 },
          { description: "Ink cartridges", quantity: 3, unitPrice: 85, amount: 255, taxAmount: 0, sortOrder: 1 },
          { description: "Stationery & misc", quantity: 1, unitPrice: 495, amount: 495, taxAmount: 0, sortOrder: 2 },
        ],
      },
    },
  });
  await db.journalEntry.create({
    data: {
      organisationId: org.id, date: daysAgo(60), description: "Bill OD-44821 — Office Depot", source: "BILL", sourceId: bill1.id,
      lines: { create: [
        { accountId: PROF.id, debit: 1200, credit: null, description: "Office supplies" },
        { accountId: AP.id, debit: null, credit: 1200 },
      ]},
    },
  });
  await db.journalEntry.create({
    data: {
      organisationId: org.id, date: daysAgo(28), description: "Payment to Office Depot — OD-44821", source: "MANUAL",
      lines: { create: [
        { accountId: AP.id, debit: 1200, credit: null },
        { accountId: CASH.id, debit: null, credit: 1200 },
      ]},
    },
  });

  // BILL-002: Cloud Hosting Co — SENT ($450/month)
  await db.bill.create({
    data: {
      organisationId: org.id,
      contactId: cloudHost.id,
      number: "CHC-2026-06",
      date: daysAgo(5),
      dueDate: daysFromNow(25),
      status: "SENT",
      subtotal: 450,
      taxAmount: 0,
      totalAmount: 450,
      amountPaid: 0,
      lines: {
        create: [
          { description: "Cloud hosting — June 2026", quantity: 1, unitPrice: 450, amount: 450, taxAmount: 0, sortOrder: 0 },
        ],
      },
    },
  });

  // BILL-003: Creative Agency — PARTIAL ($3,000, paid $1,500)
  await db.bill.create({
    data: {
      organisationId: org.id,
      contactId: agency.id,
      number: "CA-0091",
      date: daysAgo(40),
      dueDate: daysAgo(10),
      status: "PARTIAL",
      subtotal: 3000,
      taxAmount: 0,
      totalAmount: 3000,
      amountPaid: 1500,
      notes: "Brand refresh campaign",
      lines: {
        create: [
          { description: "Logo redesign", quantity: 1, unitPrice: 1200, amount: 1200, taxAmount: 0, sortOrder: 0 },
          { description: "Social media graphics pack", quantity: 1, unitPrice: 800, amount: 800, taxAmount: 0, sortOrder: 1 },
          { description: "Brand guidelines document", quantity: 1, unitPrice: 1000, amount: 1000, taxAmount: 0, sortOrder: 2 },
        ],
      },
    },
  });

  // ── 8. Operating expense journal entries ─────────────────────────────────────
  console.log("🌱 Seeding journal entries...");

  const expenseEntries = [
    { date: daysAgo(60), desc: "Office rent — April 2026",  dr: RENT.id, cr: CASH.id, amount: 4500 },
    { date: daysAgo(57), desc: "Salaries — April 2026",      dr: SAL.id,  cr: CASH.id, amount: 12000 },
    { date: daysAgo(55), desc: "Electricity & utilities",    dr: UTIL.id, cr: CASH.id, amount: 380 },
    { date: daysAgo(50), desc: "Google Ads campaign",        dr: MKT.id,  cr: CASH.id, amount: 1200 },
    { date: daysAgo(30), desc: "Office rent — May 2026",     dr: RENT.id, cr: CASH.id, amount: 4500 },
    { date: daysAgo(27), desc: "Salaries — May 2026",        dr: SAL.id,  cr: CASH.id, amount: 12000 },
    { date: daysAgo(25), desc: "Internet & phone",           dr: UTIL.id, cr: CASH.id, amount: 220 },
    { date: daysAgo(22), desc: "LinkedIn advertising",       dr: MKT.id,  cr: CASH.id, amount: 800 },
    { date: daysAgo(18), desc: "Legal consultation",         dr: PROF.id, cr: CASH.id, amount: 650 },
    { date: daysAgo(12), desc: "Software subscriptions",     dr: SW.id,   cr: CASH.id, amount: 495 },
    { date: daysAgo(5),  desc: "Office rent — June 2026",    dr: RENT.id, cr: CASH.id, amount: 4500 },
    { date: daysAgo(3),  desc: "Salaries — June 2026",       dr: SAL.id,  cr: CASH.id, amount: 12000 },
  ];

  for (const e of expenseEntries) {
    await db.journalEntry.create({
      data: {
        organisationId: org.id, date: e.date, description: e.desc, source: "MANUAL",
        lines: { create: [
          { accountId: e.dr, debit: e.amount, credit: null },
          { accountId: e.cr, debit: null, credit: e.amount },
        ]},
      },
    });
  }

  // ── 9. Bank account ──────────────────────────────────────────────────────────
  console.log("🌱 Seeding bank account...");
  const bankAccount = await db.bankAccount.create({
    data: {
      organisationId: org.id,
      name: "Main Operating Account",
      accountId: CASH.id,
      currentBalance: 24350,
    },
  });

  // Bank statement lines (some matched, some unmatched)
  await db.bankStatementLine.createMany({
    data: [
      { bankAccountId: bankAccount.id, date: daysAgo(32), description: "ACME CORP PAYMENT", amount: 5000,  status: "MATCHED" },
      { bankAccountId: bankAccount.id, date: daysAgo(28), description: "OFFICE DEPOT INV", amount: -1200,  status: "MATCHED" },
      { bankAccountId: bankAccount.id, date: daysAgo(20), description: "GAMMA INDUSTRIES PART PMT", amount: 3600, status: "MATCHED" },
      { bankAccountId: bankAccount.id, date: daysAgo(15), description: "STRIPE PAYOUT", amount: 1840,  status: "UNMATCHED" },
      { bankAccountId: bankAccount.id, date: daysAgo(10), description: "AWS CLOUD SERVICES", amount: -312, status: "UNMATCHED" },
      { bankAccountId: bankAccount.id, date: daysAgo(7),  description: "PAYROLL DIRECT DEPOSIT", amount: -12000, status: "MATCHED" },
      { bankAccountId: bankAccount.id, date: daysAgo(4),  description: "GOOGLE ADS", amount: -800, status: "UNMATCHED" },
      { bankAccountId: bankAccount.id, date: daysAgo(2),  description: "BANK INTEREST", amount: 24, status: "UNMATCHED" },
    ],
  });

  // ── 10. Budgets ───────────────────────────────────────────────────────────────
  console.log("🌱 Seeding budgets...");
  await db.budget.createMany({
    data: [
      { organisationId: org.id, name: "Marketing Budget", category: "Marketing & Advertising", limitAmount: 3000, period: "MONTHLY" },
      { organisationId: org.id, name: "Software Budget",  category: "Software & Subscriptions", limitAmount: 1000, period: "MONTHLY" },
      { organisationId: org.id, name: "Travel Budget",    category: "Travel & Entertainment",  limitAmount: 2000, period: "MONTHLY" },
      { organisationId: org.id, name: "Office Supplies",  category: "Miscellaneous Expenses",  limitAmount: 500,  period: "MONTHLY" },
    ],
  });

  // ── 11. Goals ─────────────────────────────────────────────────────────────────
  console.log("🌱 Seeding goals...");
  await db.goal.createMany({
    data: [
      { organisationId: org.id, name: "Emergency Fund",     description: "6 months of operating expenses", targetAmount: 50000, currentAmount: 24350, targetDate: daysFromNow(180), status: "ACTIVE" },
      { organisationId: org.id, name: "New Equipment",      description: "MacBook Pros for the team",       targetAmount: 12000, currentAmount: 4500,  targetDate: daysFromNow(90),  status: "ACTIVE" },
      { organisationId: org.id, name: "Marketing Campaign", description: "Q3 growth campaign budget",       targetAmount: 8000,  currentAmount: 8000,  status: "COMPLETED" },
    ],
  });

  // ── 12. Recurring items ───────────────────────────────────────────────────────
  console.log("🌱 Seeding recurring items...");
  await db.recurringItem.createMany({
    data: [
      { organisationId: org.id, name: "Office Rent",          amount: 4500,  type: "EXPENSE", frequency: "MONTHLY",   category: "Rent & Lease",             nextDueDate: daysFromNow(25), isActive: true },
      { organisationId: org.id, name: "Cloud Hosting",        amount: 450,   type: "EXPENSE", frequency: "MONTHLY",   category: "Software & Subscriptions", nextDueDate: daysFromNow(25), isActive: true },
      { organisationId: org.id, name: "Beta Solutions Retainer", amount: 3500, type: "INCOME", frequency: "MONTHLY",  category: "Service Revenue",          nextDueDate: daysFromNow(10), isActive: true },
      { organisationId: org.id, name: "LinkedIn Ads",         amount: 800,   type: "EXPENSE", frequency: "MONTHLY",   category: "Marketing & Advertising",  nextDueDate: daysFromNow(8),  isActive: true },
      { organisationId: org.id, name: "Annual Software License", amount: 1200, type: "EXPENSE", frequency: "YEARLY", category: "Software & Subscriptions", nextDueDate: daysFromNow(200), isActive: true },
    ],
  });

  // ── 13. Watchlists ────────────────────────────────────────────────────────────
  console.log("🌱 Seeding watchlists...");
  await db.watchlist.createMany({
    data: [
      { organisationId: org.id, name: "Ad Spend Watch",    category: "Marketing & Advertising",  threshold: 2500, period: "MONTHLY", isActive: true },
      { organisationId: org.id, name: "SaaS Cost Watch",   category: "Software & Subscriptions", threshold: 800,  period: "MONTHLY", isActive: true },
    ],
  });

  // ── 14. CRM ───────────────────────────────────────────────────────────────────
  console.log("🌱 Seeding CRM...");

  // Pipeline + stages
  const pipeline = await db.crmPipeline.create({
    data: {
      organisationId: org.id,
      name: "Sales Pipeline",
      isDefault: true,
      stages: {
        create: [
          { name: "Prospecting",    order: 1, probability: 10 },
          { name: "Qualification",  order: 2, probability: 25 },
          { name: "Proposal",       order: 3, probability: 50 },
          { name: "Negotiation",    order: 4, probability: 75 },
          { name: "Closed Won",     order: 5, probability: 100 },
        ],
      },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  const [prospecting, qualification, proposal, negotiation, closedWon] = pipeline.stages;

  // CRM Companies
  const [techCo, retailCo] = await Promise.all([
    db.crmCompany.create({ data: { organisationId: org.id, name: "TechFlow Inc", industry: "Technology", website: "https://techflow.io", size: "MEDIUM", tags: ["saas", "startup"] } }),
    db.crmCompany.create({ data: { organisationId: org.id, name: "Retail Giant Corp", industry: "Retail", size: "LARGE", tags: ["enterprise", "retail"] } }),
  ]);

  // CRM Contacts (separate from billing contacts)
  const [leadContact1, leadContact2] = await Promise.all([
    db.contact.create({ data: { organisationId: org.id, type: "CUSTOMER", name: "Sarah Chen", email: "sarah.chen@techflow.io", phone: "+1-555-0201" } }),
    db.contact.create({ data: { organisationId: org.id, type: "CUSTOMER", name: "Marcus Williams", email: "m.williams@retailgiant.com", phone: "+1-555-0202" } }),
  ]);

  // Leads
  await Promise.all([
    db.crmLead.create({ data: { organisationId: org.id, firstName: "Sarah", lastName: "Chen", email: "sarah.chen@techflow.io", companyName: "TechFlow Inc", jobTitle: "CTO", estimatedValue: 15000, source: "WEBSITE", status: "QUALIFIED", assignedToId: user.id, tags: ["hot-lead", "saas"] } }),
    db.crmLead.create({ data: { organisationId: org.id, firstName: "Marcus", lastName: "Williams", email: "m.williams@retailgiant.com", companyName: "Retail Giant Corp", jobTitle: "VP Operations", estimatedValue: 45000, source: "REFERRAL", status: "CONTACTED", assignedToId: user.id, tags: ["enterprise"] } }),
    db.crmLead.create({ data: { organisationId: org.id, firstName: "Priya", lastName: "Patel", email: "priya@newstartup.com", companyName: "New Startup Co", estimatedValue: 8000, source: "SOCIAL_MEDIA", status: "NEW" } }),
    db.crmLead.create({ data: { organisationId: org.id, firstName: "James", lastName: "Morrison", email: "j.morrison@oldcorp.com", companyName: "Old Corp Ltd", estimatedValue: 5000, source: "COLD_OUTREACH", status: "UNQUALIFIED", notes: "Not the right fit — too small" } }),
  ]);

  // Deals
  const deal1 = await db.crmDeal.create({
    data: {
      organisationId: org.id,
      name: "TechFlow — Platform Integration",
      value: 15000,
      contactId: leadContact1.id,
      crmCompanyId: techCo.id,
      pipelineId: pipeline.id,
      stageId: proposal.id,
      expectedCloseDate: daysFromNow(30),
      probability: 60,
      source: "Inbound website",
    },
  });

  await db.crmDeal.create({
    data: {
      organisationId: org.id,
      name: "Retail Giant — ERP Consulting",
      value: 45000,
      contactId: leadContact2.id,
      crmCompanyId: retailCo.id,
      pipelineId: pipeline.id,
      stageId: negotiation.id,
      expectedCloseDate: daysFromNow(14),
      probability: 80,
      source: "Referral — Acme Corp",
    },
  });

  // CRM Activities
  await db.crmActivity.createMany({
    data: [
      { organisationId: org.id, type: "CALL",    subject: "Discovery call with Sarah Chen", notes: "Discussed platform needs, budget confirmed at $15k", contactId: leadContact1.id, dealId: deal1.id, completedAt: daysAgo(10), createdById: user.id },
      { organisationId: org.id, type: "EMAIL",   subject: "Sent proposal to TechFlow", notes: "Proposal sent covering integration timeline and deliverables", contactId: leadContact1.id, dealId: deal1.id, completedAt: daysAgo(5), createdById: user.id },
      { organisationId: org.id, type: "MEETING", subject: "Follow-up with Marcus Williams", notes: "In-person meeting at their office. Very positive, awaiting internal approval", contactId: leadContact2.id, completedAt: daysAgo(3), createdById: user.id },
      { organisationId: org.id, type: "TASK",    subject: "Send revised contract to Retail Giant", dueDate: daysFromNow(2), contactId: leadContact2.id, createdById: user.id },
    ],
  });

  // ── 15. Chat conversation ─────────────────────────────────────────────────────
  console.log("🌱 Seeding chat conversation...");
  const conversation = await db.chatConversation.create({
    data: { organisationId: org.id, userId: user.id, title: "Monthly P&L overview" },
  });
  await db.chatMessage.createMany({
    data: [
      { conversationId: conversation.id, role: "user",      content: "Can you give me an overview of this month's profit and loss?" },
      { conversationId: conversation.id, role: "assistant", content: "Sure! Based on your records for June 2026:\n\n**Income:** $10,700 (service revenue)\n**Expenses:** $17,570 (salaries $12,000, rent $4,500, marketing $800, utilities $220, software $50)\n\n**Net Loss: -$6,870** this month. Note that your outstanding AR of $12,500 (INV-002 and balance of INV-003) when collected will significantly improve the picture. The overdue INV-004 of $1,800 should be followed up." },
      { conversationId: conversation.id, role: "user",      content: "Which invoice is most overdue?" },
      { conversationId: conversation.id, role: "assistant", content: "**INV-004** issued to Delta Partners for $1,800 is your most overdue invoice — it was due 20 days ago (May 26th) and remains fully unpaid. I'd recommend sending a payment reminder immediately." },
    ],
  });

  console.log("\n✅ Demo data seeded successfully!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Login:    demo@trivio.app");
  console.log("  Password: demo1234");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
