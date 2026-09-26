// QA: CRM — pipelines & stages, leads → conversion, companies, deals through
// close and invoicing, activities, reports, and tenant isolation throughout.
import { describe, it, expect, beforeAll } from "vitest";
import { db, newUser, type QaUser } from "./harness";

let u: QaUser;
let other: QaUser;
let contactId: string;
let foreignContactId: string;
let pipelineId: string;
let stages: { id: string; name: string; order: number }[];
let otherPipelineId: string;
let otherStageId: string;
let foreignStageId: string;

async function withTZ<T>(tz: string, fn: () => Promise<T>): Promise<T> {
  const old = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
}

beforeAll(async () => {
  u = await newUser();
  other = await newUser();
  contactId = (await u.api.contacts.create({ type: "CUSTOMER", name: "Globex" })).id;
  foreignContactId = (await other.api.contacts.create({ type: "CUSTOMER", name: "Not yours" })).id;
  const theirs = await other.api.crmPipelines.create({ name: "Their sales" });
  foreignStageId = theirs!.stages[0]!.id;
});

describe("pipelines & stages", () => {
  it("creates a pipeline with a starter stage, adds/renames stages, keeps one default", async () => {
    const p = await u.api.crmPipelines.create({ name: "Sales", isDefault: true });
    pipelineId = p!.id;
    expect(p!.stages.map((s) => s.name)).toEqual(["New"]);
    await u.api.crmPipelines.createStage({ pipelineId, name: "Qualified", order: 2 });
    await u.api.crmPipelines.createStage({ pipelineId, name: "Proposal", order: 3 });
    const won = await u.api.crmPipelines.createStage({ pipelineId, name: "Closing", order: 4 });
    await u.api.crmPipelines.updateStage({ stageId: won.id, name: "Won", probability: 100 });

    const second = await u.api.crmPipelines.create({ name: "Partnerships", isDefault: true });
    otherPipelineId = second!.id;
    otherStageId = second!.stages[0]!.id;
    await u.api.crmPipelines.update({ id: pipelineId, isDefault: true });

    const list = await u.api.crmPipelines.list();
    expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([pipelineId]);
    stages = list.find((x) => x.id === pipelineId)!.stages;
    expect(stages.map((s) => s.name)).toEqual(["New", "Qualified", "Proposal", "Won"]);

    await expect(
      other.api.crmPipelines.createStage({ pipelineId, name: "Sneaky", order: 9 })
    ).rejects.toThrow();
    await expect(
      other.api.crmPipelines.updateStage({ stageId: stages[0]!.id, name: "Hacked" })
    ).rejects.toThrow();
  });

  it("reorders only this pipeline's own stages", async () => {
    const theirsBefore = await db.crmPipelineStage.findUniqueOrThrow({ where: { id: foreignStageId } });
    await expect(
      u.api.crmPipelines.reorderStages({ pipelineId, stageIds: [foreignStageId, stages[0]!.id] })
    ).rejects.toThrow(/belong to this pipeline/);
    await expect(
      u.api.crmPipelines.reorderStages({ pipelineId, stageIds: [otherStageId] })
    ).rejects.toThrow(/belong to this pipeline/);
    expect(
      (await db.crmPipelineStage.findUniqueOrThrow({ where: { id: foreignStageId } })).order
    ).toBe(theirsBefore.order);

    const [a, b, c, d] = stages.map((s) => s.id);
    await u.api.crmPipelines.reorderStages({ pipelineId, stageIds: [b!, a!, c!, d!] });
    await u.api.crmPipelines.reorderStages({ pipelineId, stageIds: [a!, b!, c!, d!] });
    const again = (await u.api.crmPipelines.list()).find((x) => x.id === pipelineId)!.stages;
    expect(again.map((s) => s.name)).toEqual(["New", "Qualified", "Proposal", "Won"]);
  });
});

describe("leads", () => {
  it("creates, filters, edits (clearing email) and only assigns org members", async () => {
    const lead = await u.api.crmLeads.create({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      companyName: "Analytical Engines",
      estimatedValue: 5000,
      source: "REFERRAL",
      tags: ["hot"],
      assignedToId: u.userId,
    });
    await expect(
      u.api.crmLeads.create({ firstName: "X", lastName: "Y", assignedToId: other.userId })
    ).rejects.toThrow(/User not found/);
    await expect(
      u.api.crmLeads.update({ id: lead.id, assignedToId: other.userId })
    ).rejects.toThrow(/User not found/);

    expect((await u.api.crmLeads.list({ tag: "hot" })).map((l) => l.id)).toEqual([lead.id]);
    expect(await u.api.crmLeads.list({ status: "QUALIFIED" })).toHaveLength(0);

    await u.api.crmLeads.update({ id: lead.id, email: "", phone: "555" });
    const got = await u.api.crmLeads.get({ id: lead.id });
    expect(got.email).toBeNull();
    expect(got.phone).toBe("555");
    expect(got.assignedTo?.id).toBe(u.userId);

    await expect(other.api.crmLeads.get({ id: lead.id })).rejects.toThrow();
    await expect(other.api.crmLeads.update({ id: lead.id, notes: "x" })).rejects.toThrow();
    await expect(other.api.crmLeads.delete({ id: lead.id })).rejects.toThrow();
  });

  it("converts only qualified leads into contact + company + deal in the default pipeline", async () => {
    const lead = (await u.api.crmLeads.list({ tag: "hot" }))[0]!;
    await expect(u.api.crmLeads.convert({ id: lead.id })).rejects.toThrow(/QUALIFIED/);
    await u.api.crmLeads.update({ id: lead.id, status: "QUALIFIED" });
    await expect(other.api.crmLeads.convert({ id: lead.id })).rejects.toThrow();

    const res = await u.api.crmLeads.convert({ id: lead.id });
    const deal = await u.api.crmDeals.get({ id: res.dealId });
    expect(deal.pipeline.id).toBe(pipelineId);
    expect(deal.stage.name).toBe("New");
    expect(Number(deal.value)).toBe(5000);
    expect(deal.contact.id).toBe(res.contactId);
    expect(deal.crmCompany?.name).toBe("Analytical Engines");
    expect((await u.api.crmLeads.get({ id: lead.id })).status).toBe("CONVERTED");
    await expect(u.api.crmLeads.convert({ id: lead.id })).rejects.toThrow();

    const junk = await u.api.crmLeads.create({ firstName: "Spam", lastName: "Bot", source: "OTHER" });
    const report = await u.api.crmReports.leadSourceReport();
    expect(report.find((r) => r.source === "REFERRAL")).toMatchObject({
      total: 1,
      converted: 1,
      conversionRate: 100,
    });
    await u.api.crmLeads.delete({ id: junk.id });
    expect((await u.api.crmLeads.list({})).map((l) => l.id)).not.toContain(junk.id);
  });
});

describe("companies", () => {
  it("creates, edits (clearing website), links only own contacts, deletes", async () => {
    const co = await u.api.crmCompanies.create({
      name: "Initech",
      website: "https://initech.test",
      size: "MEDIUM",
    });
    await u.api.crmCompanies.update({ id: co.id, website: "", industry: "Software" });
    let got = await u.api.crmCompanies.get({ id: co.id });
    expect(got.website).toBeNull();
    expect(got.industry).toBe("Software");

    await expect(
      u.api.crmCompanies.linkContact({ id: co.id, contactId: foreignContactId })
    ).rejects.toThrow(/Contact not found/);
    await u.api.crmCompanies.linkContact({ id: co.id, contactId });
    got = await u.api.crmCompanies.get({ id: co.id });
    expect(got.linkedContact?.id).toBe(contactId);
    await u.api.crmCompanies.linkContact({ id: co.id, contactId: null });

    expect((await u.api.crmCompanies.list()).map((c) => c.id)).toContain(co.id);
    await expect(other.api.crmCompanies.get({ id: co.id })).rejects.toThrow();
    await expect(other.api.crmCompanies.update({ id: co.id, name: "x" })).rejects.toThrow();
    await expect(other.api.crmCompanies.delete({ id: co.id })).rejects.toThrow();
    await u.api.crmCompanies.delete({ id: co.id });
    await expect(u.api.crmCompanies.get({ id: co.id })).rejects.toThrow();
  });
});

describe("deals", () => {
  let dealId: string;
  let foreignCompanyId: string;

  it("refuses references to other organisations or mismatched pipeline/stage", async () => {
    foreignCompanyId = (await other.api.crmCompanies.create({ name: "Theirs" })).id;
    const base = { name: "Big sale", value: 1000, contactId, pipelineId, stageId: stages[1]!.id };
    await expect(u.api.crmDeals.create({ ...base, contactId: foreignContactId })).rejects.toThrow(
      /Contact not found/
    );
    await expect(
      u.api.crmDeals.create({ ...base, crmCompanyId: foreignCompanyId })
    ).rejects.toThrow(/Company not found/);
    await expect(u.api.crmDeals.create({ ...base, stageId: foreignStageId })).rejects.toThrow(
      /Stage not found/
    );
    await expect(u.api.crmDeals.create({ ...base, stageId: otherStageId })).rejects.toThrow(
      /different pipeline/
    );
    expect(await db.crmDeal.count({ where: { name: "Big sale" } })).toBe(0);

    const deal = await u.api.crmDeals.create(base);
    dealId = deal.id;
    expect(deal.probability).toBe(50); // stage 2 of 4
  });

  it("edits a deal and keeps its stage inside its pipeline", async () => {
    await expect(u.api.crmDeals.update({ id: dealId, stageId: otherStageId })).rejects.toThrow(
      /different pipeline/
    );
    await expect(
      u.api.crmDeals.update({ id: dealId, pipelineId: otherPipelineId })
    ).rejects.toThrow(/different pipeline/);
    await expect(
      u.api.crmDeals.update({ id: dealId, contactId: foreignContactId })
    ).rejects.toThrow(/Contact not found/);
    await u.api.crmDeals.update({ id: dealId, pipelineId: otherPipelineId, stageId: otherStageId });
    await u.api.crmDeals.update({
      id: dealId,
      pipelineId,
      stageId: stages[2]!.id,
      value: 1200,
      probability: 60,
    });
    const got = await u.api.crmDeals.get({ id: dealId });
    expect(got.stage.name).toBe("Proposal");
    expect(Number(got.value)).toBe(1200);
    expect((await u.api.crmDeals.list({ stageId: stages[2]!.id })).map((d) => d.id)).toEqual([
      dealId,
    ]);
    await expect(other.api.crmDeals.get({ id: dealId })).rejects.toThrow();
    await expect(other.api.crmDeals.update({ id: dealId, name: "x" })).rejects.toThrow();
  });

  it("forecasts a deal closing on the 1st in that month, even west of UTC", async () => {
    await withTZ("America/Los_Angeles", async () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
      await u.api.crmDeals.update({ id: dealId, expectedCloseDate: `${key}-01` });

      const forecast = await u.api.crmDeals.forecast();
      expect(forecast.find((m) => m.month === key)).toMatchObject({
        totalValue: 1200,
        weightedValue: 720,
        dealCount: 1,
      });
      const sales = await u.api.crmReports.salesForecast({ months: 3 });
      expect(sales).toHaveLength(3);
      expect(sales[1]).toMatchObject({ month: key, weightedValue: 720 });
      expect(sales[0]!.dealCount).toBe(0);
    });
  });

  it("closes once, invoices a won deal once, and never invoices a lost one", async () => {
    await expect(other.api.crmDeals.close({ id: dealId, outcome: "WON" })).rejects.toThrow();
    await u.api.crmDeals.close({ id: dealId, outcome: "WON" });
    await expect(u.api.crmDeals.close({ id: dealId, outcome: "LOST" })).rejects.toThrow(
      /already closed/
    );
    expect((await u.api.crmDeals.get({ id: dealId })).probability).toBe(100);
    expect((await u.api.crmDeals.list({})).map((d) => d.id)).not.toContain(dealId);
    expect((await u.api.crmDeals.list({ includeWonLost: true })).map((d) => d.id)).toContain(dealId);

    await expect(other.api.crmDeals.convertToInvoice({ id: dealId })).rejects.toThrow();
    const { invoiceId } = await u.api.crmDeals.convertToInvoice({ id: dealId });
    const inv = await u.api.invoices.getById({ id: invoiceId });
    expect(inv.status).toBe("DRAFT");
    expect(Number(inv.totalAmount)).toBe(1200);
    expect(inv.contactId).toBe(contactId);
    await expect(u.api.crmDeals.convertToInvoice({ id: dealId })).rejects.toThrow(/already/);
    await expect(u.api.crmDeals.delete({ id: dealId })).rejects.toThrow(/linked to an invoice/);

    const lost = await u.api.crmDeals.create({
      name: "Lost cause",
      value: 300,
      contactId,
      pipelineId,
      stageId: stages[0]!.id,
    });
    await u.api.crmDeals.close({ id: lost.id, outcome: "LOST", reason: "Too expensive" });
    await expect(u.api.crmDeals.convertToInvoice({ id: lost.id })).rejects.toThrow(/lost deal/);

    const from = new Date(Date.now() - 86400_000).toISOString();
    const to = new Date(Date.now() + 86400_000).toISOString();
    const wl = await u.api.crmReports.wonLostAnalysis({ from, to });
    expect(wl).toMatchObject({ totalClosed: 2, wonCount: 1, lostCount: 1, winRate: 50 });
    expect(wl.avgDealSize).toBe(1200);
    expect(wl.lossReasons).toEqual([{ reason: "Too expensive", count: 1 }]);

    await expect(other.api.crmDeals.delete({ id: lost.id })).rejects.toThrow();
    await u.api.crmDeals.delete({ id: lost.id });
    await expect(u.api.crmDeals.get({ id: lost.id })).rejects.toThrow();
  });

  it("pipeline report counts open deals per stage and never leaks another org's stages", async () => {
    const open = await u.api.crmDeals.create({
      name: "Open one",
      value: 400,
      contactId,
      pipelineId,
      stageId: stages[1]!.id,
      probability: 25,
    });
    const report = await u.api.crmReports.pipeline({ pipelineId });
    expect(report.map((r) => r.stageName)).toEqual(["New", "Qualified", "Proposal", "Won"]);
    const qualified = report.find((r) => r.stageName === "Qualified")!;
    expect(qualified).toMatchObject({ dealCount: 1, totalValue: 400, weightedValue: 100 });
    const all = await u.api.crmReports.pipeline({});
    expect(all.length).toBe(stages.length + 1); // + Partnerships' starter stage

    const theirPipeline = (await other.api.crmPipelines.list())[0]!.id;
    expect(await u.api.crmReports.pipeline({ pipelineId: theirPipeline })).toEqual([]);

    // Stage/pipeline with deals can't be deleted out from under them.
    await expect(u.api.crmPipelines.deleteStage({ stageId: stages[1]!.id })).rejects.toThrow(
      /active deals/
    );
    await expect(u.api.crmPipelines.delete({ id: pipelineId })).rejects.toThrow(/active deals/);
    await expect(other.api.crmPipelines.delete({ id: otherPipelineId })).rejects.toThrow();
    await u.api.crmDeals.delete({ id: open.id });

    const spare = await u.api.crmPipelines.createStage({ pipelineId, name: "Spare", order: 5 });
    await expect(other.api.crmPipelines.deleteStage({ stageId: spare.id })).rejects.toThrow();
    await u.api.crmPipelines.deleteStage({ stageId: spare.id });
    await u.api.crmPipelines.delete({ id: otherPipelineId });
    expect((await u.api.crmPipelines.list()).map((p) => p.id)).toEqual([pipelineId]);
  });
});

describe("activities", () => {
  it("logs activities only against this organisation's records", async () => {
    const deal = (await u.api.crmDeals.list({ includeWonLost: true }))[0]!;
    const theirDeal = await other.api.crmDeals.create({
      name: "Theirs",
      value: 1,
      contactId: foreignContactId,
      pipelineId: (await other.api.crmPipelines.list())[0]!.id,
      stageId: foreignStageId,
    });
    await expect(
      u.api.crmActivities.create({ type: "CALL", subject: "x", dealId: theirDeal.id })
    ).rejects.toThrow(/Deal not found/);
    await expect(
      u.api.crmActivities.create({ type: "CALL", subject: "x", contactId: foreignContactId })
    ).rejects.toThrow(/Contact not found/);

    const yesterday = new Date(Date.now() - 86400_000).toISOString();
    const call = await u.api.crmActivities.create({
      type: "CALL",
      subject: "Follow up",
      dueDate: yesterday,
      contactId,
      dealId: deal.id,
    });
    await u.api.crmActivities.create({ type: "NOTE", subject: "Met at expo", contactId });

    expect((await u.api.crmActivities.list({ overdueOnly: true })).map((a) => a.id)).toEqual([
      call.id,
    ]);
    expect(await u.api.crmActivities.list({ dealId: deal.id })).toHaveLength(1);
    expect(await u.api.crmActivities.list({ type: "NOTE" })).toHaveLength(1);

    await expect(
      u.api.crmActivities.update({ id: call.id, dealId: theirDeal.id })
    ).rejects.toThrow(/Deal not found/);
    await u.api.crmActivities.update({ id: call.id, completedAt: new Date().toISOString() });
    expect(await u.api.crmActivities.list({ overdueOnly: true })).toHaveLength(0);

    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const rep = await u.api.crmReports.activityReport({ from, to });
    expect(rep.total).toBe(2);
    expect(rep.byUser).toEqual([expect.objectContaining({ userId: u.userId, count: 2 })]);
    expect((await other.api.crmReports.activityReport({ from, to })).total).toBe(0);

    await expect(other.api.crmActivities.update({ id: call.id, subject: "x" })).rejects.toThrow();
    await expect(other.api.crmActivities.delete({ id: call.id })).rejects.toThrow();
    await u.api.crmActivities.delete({ id: call.id });
    expect(await u.api.crmActivities.list({ type: "CALL" })).toHaveLength(0);
  });
});
