// QA: contacts, invoices (AR), bills (AP) and their attachments — the full
// draft → post → pay → void lifecycle, with the ledger checked at every step.
import { describe, it, expect, beforeAll } from "vitest";
import { accountId, daysFromNow, db, newUser, today, type QaUser } from "./harness";

let u: QaUser;
let other: QaUser;
let cash: string;
let customerId: string;
let supplierId: string;
let foreignContactId: string;

/** Net balance (debit − credit) an account holds across non-void entries. */
async function net(orgId: string, code: string) {
  const lines = await db.journalLine.findMany({
    where: { account: { organisationId: orgId, code }, journalEntry: { isVoid: false } },
    select: { debit: true, credit: true },
  });
  const v = lines.reduce((s, l) => s + Number(l.debit ?? 0) - Number(l.credit ?? 0), 0);
  return Math.round(v * 100) / 100;
}

async function ledgerBalanced(orgId: string) {
  const lines = await db.journalLine.findMany({
    where: { journalEntry: { organisationId: orgId } },
    select: { debit: true, credit: true },
  });
  const d = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
  const c = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
  return Math.round(d * 100) === Math.round(c * 100);
}

const line = (unitPrice: number, taxAmount = 0) => ({
  description: "Work",
  quantity: 1,
  unitPrice,
  taxAmount,
});

beforeAll(async () => {
  u = await newUser();
  other = await newUser();
  cash = await accountId(u.orgId, "1100");
  customerId = (
    await u.api.contacts.create({
      type: "CUSTOMER",
      name: "Acme Ltd",
      email: "billing@acme.test",
      phone: "555-0100",
      address: "1 Road",
      taxNumber: "TX-1",
    })
  ).id;
  supplierId = (await u.api.contacts.create({ type: "SUPPLIER", name: "Paper Co" })).id;
  foreignContactId = (await other.api.contacts.create({ type: "CUSTOMER", name: "Not yours" })).id;
});

describe("contacts", () => {
  it("lists, searches, fetches and archives contacts", async () => {
    const all = await u.api.contacts.list({});
    expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([customerId, supplierId]));
    const suppliers = await u.api.contacts.list({ type: "SUPPLIER" });
    expect(suppliers.map((c) => c.id)).not.toContain(customerId);
    expect((await u.api.contacts.list({ search: "acme" })).map((c) => c.id)).toEqual([customerId]);
    expect((await u.api.contacts.getById({ id: customerId })).name).toBe("Acme Ltd");

    const temp = await u.api.contacts.create({ type: "BOTH", name: "Temp" });
    await u.api.contacts.archive({ id: temp.id, archive: true });
    expect((await u.api.contacts.list({})).map((c) => c.id)).not.toContain(temp.id);
    expect((await u.api.contacts.list({ includeArchived: true })).map((c) => c.id)).toContain(
      temp.id
    );
  });

  it("a partial update keeps the fields you didn't touch", async () => {
    const updated = await u.api.contacts.update({ id: customerId, name: "Acme Limited" });
    expect(updated.name).toBe("Acme Limited");
    expect(updated.email).toBe("billing@acme.test");
    expect(updated.phone).toBe("555-0100");
    expect(updated.address).toBe("1 Road");
    expect(updated.taxNumber).toBe("TX-1");
    // An explicit empty string still clears a field.
    expect((await u.api.contacts.update({ id: customerId, phone: "" })).phone).toBeNull();
  });

  it("cannot read or change another organisation's contact", async () => {
    await expect(u.api.contacts.getById({ id: foreignContactId })).rejects.toThrow();
    await expect(u.api.contacts.update({ id: foreignContactId, name: "x" })).rejects.toThrow();
    await expect(u.api.contacts.archive({ id: foreignContactId, archive: true })).rejects.toThrow();
  });
});

describe("invoices", () => {
  it("draft → edit → send posts AR, income and tax to the ledger", async () => {
    const inv = await u.api.invoices.create({
      contactId: customerId,
      date: today(),
      dueDate: daysFromNow(30),
      lines: [line(100)],
    });
    expect(inv.status).toBe("DRAFT");
    expect(inv.number).toMatch(/^INV-\d{4}$/);

    const edited = await u.api.invoices.update({ id: inv.id, lines: [line(200, 20)] });
    expect(Number(edited.totalAmount)).toBe(220);

    const arBefore = await net(u.orgId, "1200");
    await u.api.invoices.send({ id: inv.id, sendEmail: false });
    expect(await net(u.orgId, "1200")).toBe(arBefore + 220);
    const got = await u.api.invoices.getById({ id: inv.id });
    expect(got.status).toBe("SENT");
    expect(got.amountDue).toBe(220);

    await expect(u.api.invoices.update({ id: inv.id, notes: "late edit" })).rejects.toThrow(
      /draft/
    );
    await expect(u.api.invoices.send({ id: inv.id, sendEmail: false })).rejects.toThrow();
    expect(await ledgerBalanced(u.orgId)).toBe(true);
  });

  it("partial then full payment moves it to PARTIAL then PAID and clears AR", async () => {
    const inv = await u.api.invoices.create({
      contactId: customerId,
      date: today(),
      dueDate: daysFromNow(14),
      lines: [line(300)],
    });
    await expect(
      u.api.invoices.recordPayment({ id: inv.id, amount: 10, cashAccountId: cash, date: today() })
    ).rejects.toThrow(/draft/);
    await u.api.invoices.send({ id: inv.id, sendEmail: false });

    const ar = await net(u.orgId, "1200");
    await u.api.invoices.recordPayment({
      id: inv.id,
      amount: 100,
      cashAccountId: cash,
      date: today(),
    });
    expect((await u.api.invoices.getById({ id: inv.id })).status).toBe("PARTIAL");
    await expect(
      u.api.invoices.recordPayment({ id: inv.id, amount: 500, cashAccountId: cash, date: today() })
    ).rejects.toThrow(/exceeds/);
    await u.api.invoices.recordPayment({
      id: inv.id,
      amount: 200,
      cashAccountId: cash,
      date: today(),
    });
    expect((await u.api.invoices.getById({ id: inv.id })).status).toBe("PAID");
    expect(await net(u.orgId, "1200")).toBe(ar - 300);
  });

  it("voiding a paid invoice reverses income, AR and cash back to where they were", async () => {
    const before = {
      ar: await net(u.orgId, "1200"),
      cash: await net(u.orgId, "1100"),
      sales: await net(u.orgId, "4100"),
    };
    const inv = await u.api.invoices.create({
      contactId: customerId,
      date: today(),
      dueDate: daysFromNow(7),
      lines: [line(80)],
    });
    await u.api.invoices.send({ id: inv.id, sendEmail: false });
    await u.api.invoices.recordPayment({
      id: inv.id,
      amount: 80,
      cashAccountId: cash,
      date: today(),
    });
    await u.api.invoices.void({ id: inv.id, reason: "Refunded" });

    expect(await net(u.orgId, "1200")).toBe(before.ar);
    expect(await net(u.orgId, "1100")).toBe(before.cash);
    expect(await net(u.orgId, "4100")).toBe(before.sales);
    expect((await u.api.invoices.getById({ id: inv.id })).status).toBe("VOID");
    await expect(u.api.invoices.void({ id: inv.id })).rejects.toThrow(/Already voided/);
    await expect(
      u.api.invoices.recordPayment({ id: inv.id, amount: 1, cashAccountId: cash, date: today() })
    ).rejects.toThrow();
    expect(await ledgerBalanced(u.orgId)).toBe(true);
  });

  it("lists by status, ages receivables and builds PDF data", async () => {
    const overdue = await u.api.invoices.create({
      contactId: customerId,
      date: daysFromNow(-60),
      dueDate: daysFromNow(-45),
      lines: [line(50)],
    });
    await u.api.invoices.send({ id: overdue.id, sendEmail: false });

    const list = await u.api.invoices.list({ status: "OVERDUE" });
    expect(list.items.map((i) => i.id)).toContain(overdue.id);
    expect((await u.api.invoices.list({ status: "VOID" })).items.length).toBeGreaterThan(0);
    expect((await u.api.invoices.list({ search: overdue.number })).items[0]?.id).toBe(overdue.id);

    const aging = await u.api.invoices.arAging();
    expect(aging.totals.days60).toBeGreaterThanOrEqual(50);
    expect(aging.totals.total).toBeCloseTo(
      aging.totals.current +
        aging.totals.days30 +
        aging.totals.days60 +
        aging.totals.days90 +
        aging.totals.over90,
      2
    );

    const pdf = await u.api.invoices.getPdfData({ id: overdue.id });
    expect(pdf.invoice.number).toBe(overdue.number);
    expect(pdf.contact.name).toBe("Acme Limited");
    expect(pdf.invoice.status).toBe("OVERDUE");
  });

  it("refuses another organisation's contact, and hides its invoices", async () => {
    await expect(
      u.api.invoices.create({
        contactId: foreignContactId,
        date: today(),
        dueDate: daysFromNow(1),
        lines: [line(1)],
      })
    ).rejects.toThrow(/Contact not found/);
    const mine = await u.api.invoices.create({
      contactId: customerId,
      date: today(),
      dueDate: daysFromNow(1),
      lines: [line(1)],
    });
    await expect(
      u.api.invoices.update({ id: mine.id, contactId: foreignContactId })
    ).rejects.toThrow(/Contact not found/);
    await expect(other.api.invoices.getById({ id: mine.id })).rejects.toThrow();
    await expect(other.api.invoices.void({ id: mine.id })).rejects.toThrow();
    expect((await other.api.invoices.list({})).items.map((i) => i.id)).not.toContain(mine.id);
  });
});

describe("bills", () => {
  it("approving a bill with tax posts a balanced entry (expense + tax, credit AP)", async () => {
    const bill = await u.api.bills.create({
      contactId: supplierId,
      date: today(),
      dueDate: daysFromNow(30),
      lines: [line(400, 40)],
    });
    expect(bill.number).toMatch(/^BILL-\d{4}$/);
    const edited = await u.api.bills.update({ id: bill.id, notes: "Ream of A4" });
    expect(edited.notes).toBe("Ream of A4");

    const ap = await net(u.orgId, "2100");
    await u.api.bills.approve({ id: bill.id });
    expect(await net(u.orgId, "2100")).toBe(ap - 440); // AP is credit-normal
    const got = await u.api.bills.getById({ id: bill.id });
    expect(got.status).toBe("SENT");
    await expect(u.api.bills.approve({ id: bill.id })).rejects.toThrow(/draft/);
    await expect(u.api.bills.update({ id: bill.id, notes: "x" })).rejects.toThrow(/draft/);
    expect(await ledgerBalanced(u.orgId)).toBe(true);
  });

  it("pays, ages, lists and voids bills without leaving AP or cash behind", async () => {
    const before = { ap: await net(u.orgId, "2100"), cash: await net(u.orgId, "1100") };
    const bill = await u.api.bills.create({
      contactId: supplierId,
      date: daysFromNow(-40),
      dueDate: daysFromNow(-35),
      lines: [line(120)],
    });
    await expect(
      u.api.bills.recordPayment({ id: bill.id, amount: 1, cashAccountId: cash, date: today() })
    ).rejects.toThrow(/approve/);
    await u.api.bills.approve({ id: bill.id });

    const aging = await u.api.bills.apAging();
    expect(aging.totals.days60).toBeGreaterThanOrEqual(120);
    expect((await u.api.bills.list({ status: "OVERDUE" })).items.map((b) => b.id)).toContain(
      bill.id
    );

    await u.api.bills.recordPayment({
      id: bill.id,
      amount: 20,
      cashAccountId: cash,
      date: today(),
    });
    expect((await u.api.bills.getById({ id: bill.id })).status).toBe("PARTIAL");
    await expect(
      u.api.bills.recordPayment({ id: bill.id, amount: 1000, cashAccountId: cash, date: today() })
    ).rejects.toThrow(/exceeds/);

    await u.api.bills.void({ id: bill.id, reason: "Wrong supplier" });
    expect(await net(u.orgId, "2100")).toBe(before.ap);
    expect(await net(u.orgId, "1100")).toBe(before.cash);
    await expect(u.api.bills.void({ id: bill.id })).rejects.toThrow(/Already voided/);
    expect(await ledgerBalanced(u.orgId)).toBe(true);
  });

  it("refuses another organisation's contact and cash account", async () => {
    await expect(
      u.api.bills.create({
        contactId: foreignContactId,
        date: today(),
        dueDate: daysFromNow(1),
        lines: [line(1)],
      })
    ).rejects.toThrow(/Contact not found/);
    const mine = await u.api.bills.create({
      contactId: supplierId,
      date: today(),
      dueDate: daysFromNow(1),
      lines: [line(10)],
    });
    await expect(u.api.bills.update({ id: mine.id, contactId: foreignContactId })).rejects.toThrow(
      /Contact not found/
    );
    await u.api.bills.approve({ id: mine.id });
    const foreignCash = await accountId(other.orgId, "1100");
    await expect(
      u.api.bills.recordPayment({
        id: mine.id,
        amount: 5,
        cashAccountId: foreignCash,
        date: today(),
      })
    ).rejects.toThrow();
    expect((await u.api.bills.getById({ id: mine.id })).status).toBe("SENT");
    await expect(other.api.bills.getById({ id: mine.id })).rejects.toThrow();
  });

  it("tax summary counts invoice output tax and bill input tax", async () => {
    const tax = await u.api.reports.taxSummary({ from: "2000-01-01", to: "2100-01-01" });
    expect(Number(tax.outputTax)).toBeGreaterThanOrEqual(20);
    expect(Number(tax.inputTax)).toBeGreaterThanOrEqual(40);
  });
});

describe("attachments", () => {
  it("links a receipt to an invoice then a bill, lists it, and deletes it", async () => {
    const inv = (await u.api.invoices.list({})).items[0]!;
    const bill = (await u.api.bills.list({})).items[0]!;
    const att = await db.attachment.create({
      data: {
        organisationId: u.orgId,
        s3Key: `attachments/${u.orgId}/r.pdf`,
        originalFilename: "receipt.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1234,
      },
    });
    expect((await u.api.attachments.getStatus({ id: att.id })).extractionStatus).toBe("PENDING");

    await u.api.attachments.linkToInvoice({ id: att.id, invoiceId: inv.id });
    expect(
      (await u.api.attachments.listForInvoice({ invoiceId: inv.id })).map((a) => a.id)
    ).toContain(att.id);
    await u.api.attachments.linkToBill({ id: att.id, billId: bill.id });
    expect((await u.api.attachments.listForBill({ billId: bill.id })).map((a) => a.id)).toContain(
      att.id
    );
    expect(
      (await u.api.attachments.listForInvoice({ invoiceId: inv.id })).map((a) => a.id)
    ).not.toContain(att.id);

    await expect(other.api.attachments.getStatus({ id: att.id })).rejects.toThrow();
    await expect(other.api.attachments.delete({ id: att.id })).rejects.toThrow();
    await expect(other.api.attachments.listForBill({ billId: bill.id })).rejects.toThrow();

    await u.api.attachments.delete({ id: att.id });
    expect(await db.attachment.findUnique({ where: { id: att.id } })).toBeNull();
  });
});
