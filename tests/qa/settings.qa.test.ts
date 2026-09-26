// QA: organisation settings, sample data, billing status and GDPR tools
// (audit log, export, consent, chat retention, account deletion).
import { describe, it, expect, beforeAll, vi } from "vitest";
import { callerFor, db, newUser, today, type QaUser } from "./harness";

// recordConsent reads the request IP from next/headers, which only exists
// inside a real Next request.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

let u: QaUser;

async function ledgerBalanced(orgId: string) {
  const lines = await db.journalLine.findMany({
    where: { journalEntry: { organisationId: orgId } },
    select: { debit: true, credit: true },
  });
  const d = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
  const c = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
  return Math.round(d * 100) === Math.round(c * 100);
}

beforeAll(async () => {
  u = await newUser({ businessName: "Settings Co" });
});

describe("organisation settings", () => {
  it("shows the organisation and the signed-in user", async () => {
    const org = await u.api.org.get();
    expect(org.name).toBe("Settings Co");
    expect(org.currency).toBe("USD");
    expect(org.aiExtractionsUsed).toBe(0);
    const me = await u.api.auth.me();
    expect(me?.email).toBe(u.email);
  });

  it("renames the business and changes the fiscal year", async () => {
    await u.api.org.update({ name: "Renamed Co", fiscalYearStartMonth: 7 });
    const org = await u.api.org.get();
    expect(org.name).toBe("Renamed Co");
    expect(org.fiscalYearStartMonth).toBe(7);
    await expect(u.api.org.update({ fiscalYearStartMonth: 13 })).rejects.toThrow();
  });

  it("only accepts currencies the app supports", async () => {
    await u.api.org.setCurrency({ currency: "gbp" });
    expect((await u.api.org.get()).currency).toBe("GBP");
    await expect(u.api.org.setCurrency({ currency: "ZZZ" })).rejects.toThrow(/Unsupported/);
    expect((await u.api.org.get()).currency).toBe("GBP");
    const codes = (await callerFor(null).org.getCurrencies()).map((c) => c.code);
    expect(codes).toContain("PKR");
  });

  it("sets and clears the tax regime, and rejects an unknown one", async () => {
    const regimes = await u.api.org.getTaxRegimes();
    expect(regimes.length).toBeGreaterThan(0);
    await u.api.org.setTaxRegime({ taxRegimeId: regimes[0]!.id });
    expect((await u.api.org.get()).taxRegime?.id).toBe(regimes[0]!.id);
    await expect(u.api.org.setTaxRegime({ taxRegimeId: "nope" })).rejects.toThrow(/not found/);
    await u.api.org.setTaxRegime({ taxRegimeId: null });
    expect((await u.api.org.get()).taxRegimeId).toBeNull();
  });

  it("sets the personal tax jurisdiction", async () => {
    await u.api.org.setTaxJurisdiction({ jurisdiction: "PAK" });
    expect((await u.api.org.get()).taxJurisdiction).toBe("PAK");
    await u.api.org.setTaxJurisdiction({ jurisdiction: null });
    expect((await u.api.org.get()).taxJurisdiction).toBeNull();
  });

  it("rotates the email-import token", async () => {
    const a = await u.api.org.resetEmailImportToken();
    const b = await u.api.org.resetEmailImportToken();
    expect(a.emailImportToken).toBeTruthy();
    expect(b.emailImportToken).not.toBe(a.emailImportToken);
  });

  it("onboarding rejects an unsupported currency or unknown tax regime", async () => {
    await callerFor(null).auth.register({
      name: "Onb",
      email: "onb-check@example.test",
      password: "correct-horse-1",
    });
    const user = await db.user.findUniqueOrThrow({ where: { email: "onb-check@example.test" } });
    const api = callerFor(user.id);
    await api.org.setupStep1({ businessName: "Onb", businessType: "COMPANY" });
    await expect(api.org.setupStep2({ currency: "XXX", fiscalYearStartMonth: 1 })).rejects.toThrow(
      /Unsupported/
    );
    await expect(
      api.org.setupStep2({ currency: "USD", taxRegimeId: "missing", fiscalYearStartMonth: 1 })
    ).rejects.toThrow(/not found/);
    const org = await api.org.setupStep2({ currency: "usd", fiscalYearStartMonth: 1 });
    expect(org.currency).toBe("USD");
    // Re-running the final step must not duplicate the chart of accounts.
    const count = await db.chartAccount.count({ where: { organisationId: org.id } });
    await api.org.setupStep2({ currency: "USD", fiscalYearStartMonth: 1 });
    expect(await db.chartAccount.count({ where: { organisationId: org.id } })).toBe(count);
  });
});

describe("sample data", () => {
  it("loads once, keeps the ledger balanced, and is cleared by the first real invoice", async () => {
    const s = await newUser();
    const first = await s.api.org.loadSampleData();
    expect(first.count).toBeGreaterThan(0);
    expect((await s.api.org.get()).hasSampleData).toBe(true);
    expect((await s.api.org.loadSampleData()).count).toBe(0);
    expect(await ledgerBalanced(s.orgId)).toBe(true);
    expect(
      await db.invoice.count({ where: { organisationId: s.orgId, isSampleData: true } })
    ).toBeGreaterThan(0);

    const bs = await s.api.reports.balanceSheet({ asOf: "2100-01-01" });
    expect(Number(bs.totalAssets)).toBeCloseTo(
      Number(bs.totalLiabilities) + Number(bs.totalEquity),
      2
    );

    const contact = await s.api.contacts.create({ type: "CUSTOMER", name: "Real customer" });
    await s.api.invoices.create({
      contactId: contact.id,
      date: today(),
      dueDate: today(),
      lines: [{ description: "Real work", quantity: 1, unitPrice: 10 }],
    });
    expect(await db.invoice.count({ where: { organisationId: s.orgId, isSampleData: true } })).toBe(
      0
    );
    expect(
      await db.journalEntry.count({ where: { organisationId: s.orgId, isSampleData: true } })
    ).toBe(0);
    expect(await ledgerBalanced(s.orgId)).toBe(true);
  });
});

describe("subscription", () => {
  it("reports the plan and fails cleanly when Stripe isn't configured", async () => {
    const status = await u.api.subscription.getStatus();
    expect(status.tier).toBeTruthy();
    await expect(u.api.subscription.createCheckoutSession({ plan: "pro_monthly" })).rejects.toThrow(
      /Stripe is not configured/
    );
    await expect(u.api.subscription.createPortalSession()).rejects.toThrow(
      /Stripe is not configured/
    );
  });
});

describe("GDPR tools", () => {
  it("records consent and shows it in the audit log", async () => {
    await u.api.gdpr.recordConsent();
    const user = await db.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(user.gdprConsentAt).not.toBeNull();
    const { logs } = await u.api.gdpr.auditLog({ limit: 10 });
    const consent = logs.find((l) => l.entityType === "GdprConsent");
    expect(consent).toBeDefined();
  });

  it("exports only this organisation's data", async () => {
    const other = await newUser();
    await other.api.contacts.create({ type: "CUSTOMER", name: "Other org's customer" });
    await u.api.contacts.create({ type: "CUSTOMER", name: "My customer" });

    const data = await u.api.gdpr.exportData();
    expect(data.user?.email).toBe(u.email);
    expect(data.organisation?.id).toBe(u.orgId);
    const names = data.contacts.map((c) => c.name);
    expect(names).toContain("My customer");
    expect(names).not.toContain("Other org's customer");
    expect((await u.api.gdpr.auditLog({})).logs.some((l) => l.action === "EXPORT")).toBe(true);
  });

  it("purges only old chat messages, and only in this organisation", async () => {
    const other = await newUser();
    const old = new Date(Date.now() - 400 * 86400_000);
    const mk = async (orgId: string, userId: string, createdAt: Date) => {
      const conv = await db.chatConversation.create({ data: { organisationId: orgId, userId } });
      return db.chatMessage.create({
        data: { conversationId: conv.id, role: "user", content: "hi", createdAt },
      });
    };
    const mineOld = await mk(u.orgId, u.userId, old);
    const mineNew = await mk(u.orgId, u.userId, new Date());
    const theirsOld = await mk(other.orgId, other.userId, old);

    await expect(u.api.gdpr.purgeOldChatMessages({ olderThanDays: 5 })).rejects.toThrow();
    const res = await u.api.gdpr.purgeOldChatMessages({ olderThanDays: 365 });
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    expect(await db.chatMessage.findUnique({ where: { id: mineOld.id } })).toBeNull();
    expect(await db.chatMessage.findUnique({ where: { id: mineNew.id } })).not.toBeNull();
    expect(await db.chatMessage.findUnique({ where: { id: theirsOld.id } })).not.toBeNull();
  });

  it("deleting an account anonymises the user and removes their organisation's data", async () => {
    const d = await newUser();
    await d.api.contacts.create({ type: "CUSTOMER", name: "Gone soon" });
    await expect(d.api.gdpr.deleteAccount({ confirmText: "delete" as "DELETE" })).rejects.toThrow();

    await d.api.gdpr.deleteAccount({ confirmText: "DELETE" });
    const user = await db.user.findUniqueOrThrow({ where: { id: d.userId } });
    expect(user.email).toMatch(/@deleted\.invalid$/);
    expect(user.hashedPassword).toBeNull();
    expect(await db.organisation.findUnique({ where: { id: d.orgId } })).toBeNull();
    expect(await db.contact.count({ where: { organisationId: d.orgId } })).toBe(0);
    await expect(d.api.contacts.list({})).rejects.toThrow();

    // The freed email address can sign up again.
    await expect(
      callerFor(null).auth.register({ name: "Back", email: d.email, password: "correct-horse-1" })
    ).resolves.toBeDefined();
  });
});
