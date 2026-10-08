import { Prisma, type PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const crm = vi.hoisted(() => ({ convertLeadToContact: vi.fn() }));
vi.mock("@/server/services/crm.service", () => crm);

import {
  linkCrmLead,
  latestProposalOffer,
  splitName,
  startPilotHandoff,
  tryStartPilot,
} from "@/server/services/outreach/crm-handoff";
import { makeDb, makeProspect, type MockDb } from "./helpers";

const actor = { orgId: "org-1", userId: "user-1" };
let db: MockDb;
const asClient = (d: MockDb) => d as unknown as PrismaClient;
const asTx = (d: MockDb) => d as unknown as Prisma.TransactionClient;

beforeEach(() => {
  db = makeDb();
  crm.convertLeadToContact.mockReset();
});

describe("splitName", () => {
  it("splits on the first space and handles one-word names (Review Focus #3)", () => {
    expect(splitName("Jane van der Berg")).toEqual({ firstName: "Jane", lastName: "van der Berg" });
    expect(splitName("  Cher ")).toEqual({ firstName: "Cher", lastName: "" });
  });
});

describe("linkCrmLead", () => {
  it("keeps an existing link", async () => {
    expect(await linkCrmLead(asTx(db), "org-1", makeProspect({ crmLeadId: "lead-9" }))).toBe(
      "lead-9"
    );
    expect(db.crmLead.findFirst).not.toHaveBeenCalled();
  });

  it("links a matching unlinked lead in the same organisation", async () => {
    db.crmLead.findFirst.mockResolvedValue({ id: "lead-1" });
    expect(await linkCrmLead(asTx(db), "org-1", makeProspect())).toBe("lead-1");
    expect(db.crmLead.findFirst).toHaveBeenCalledWith({
      where: {
        organisationId: "org-1",
        firstName: "Jane",
        lastName: "Doe",
        companyName: "Acme AI",
        outreachProspect: { is: null },
      },
      select: { id: true },
    });
    expect(db.crmLead.create).not.toHaveBeenCalled();
    expect(db.outreachProspect.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { crmLeadId: "lead-1" },
    });
  });

  it("creates a lead for a one-word name with no company (Review Focus #3)", async () => {
    db.crmLead.findFirst.mockResolvedValue(null);
    db.crmLead.create.mockResolvedValue({ id: "lead-2" });
    await linkCrmLead(
      asTx(db),
      "org-1",
      makeProspect({ name: "Cher", company: "", title: "", primarySignal: null, score: 0 })
    );
    expect(db.crmLead.create).toHaveBeenCalledWith({
      data: {
        organisationId: "org-1",
        firstName: "Cher",
        lastName: "",
        companyName: null,
        jobTitle: null,
        source: "COLD_OUTREACH",
        status: "CONTACTED",
        notes: "Added from Outreach. Primary signal: none, score 0.",
      },
      select: { id: true },
    });
  });
});

describe("latestProposalOffer", () => {
  it("reads the price from the organisation's offer", async () => {
    db.outreachDoc.findFirst.mockResolvedValue({
      body: { offerId: "o1", offerName: "RAG Audit", text: "…" },
    });
    db.outreachOffer.findFirst.mockResolvedValue({
      name: "RAG Audit",
      price: new Prisma.Decimal("4000"),
    });
    const offer = await latestProposalOffer(asClient(db), "org-1", "p1");
    expect(offer?.name).toBe("RAG Audit");
    expect(offer?.price?.toString()).toBe("4000");
    expect(db.outreachOffer.findFirst).toHaveBeenCalledWith({
      where: { id: "o1", organisationId: "org-1" },
    });
  });

  it("falls back to the doc's offer name with no price, or null without a proposal", async () => {
    db.outreachDoc.findFirst.mockResolvedValueOnce({
      body: { offerId: null, offerName: "Custom", text: "…" },
    });
    expect(await latestProposalOffer(asClient(db), "org-1", "p1")).toEqual({
      name: "Custom",
      price: null,
    });
    db.outreachDoc.findFirst.mockResolvedValueOnce(null);
    expect(await latestProposalOffer(asClient(db), "org-1", "p1")).toBeNull();
  });
});

describe("startPilotHandoff", () => {
  const ready = () => {
    db.outreachProspect.findFirst.mockResolvedValue(
      makeProspect({ crmLeadId: "lead-1", company: "Lexora" })
    );
    db.crmLead.findFirst.mockResolvedValue({ id: "lead-1", status: "CONTACTED" });
    db.outreachDoc.findFirst.mockResolvedValue({
      body: { offerId: "o1", offerName: "RAG Audit", text: "…" },
    });
    db.outreachOffer.findFirst.mockResolvedValue({
      name: "RAG Audit",
      price: new Prisma.Decimal("4000"),
    });
    crm.convertLeadToContact.mockResolvedValue({ contactId: "c1", companyId: "co1", dealId: "d1" });
  };

  it("qualifies, converts, then names and prices the deal", async () => {
    ready();
    expect(await startPilotHandoff(asClient(db), actor, "p1")).toEqual({ dealId: "d1" });
    expect(db.crmLead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { status: "QUALIFIED", estimatedValue: new Prisma.Decimal("4000") },
    });
    expect(crm.convertLeadToContact).toHaveBeenCalledWith(db, "lead-1", "org-1");
    expect(db.crmDeal.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { name: "RAG Audit — Lexora", value: new Prisma.Decimal("4000"), source: "Outreach" },
    });
    expect(db.crmActivity.create).toHaveBeenCalledWith({
      data: {
        organisationId: "org-1",
        type: "NOTE",
        subject: "Pilot started via Outreach",
        dealId: "d1",
        contactId: "c1",
        createdById: "user-1",
      },
    });
    expect(db.outreachProspect.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { crmDealId: "d1" },
    });
  });

  it("uses Pilot and a zero value without a proposal", async () => {
    ready();
    db.outreachDoc.findFirst.mockResolvedValue(null);
    await startPilotHandoff(asClient(db), actor, "p1");
    expect(db.crmDeal.update.mock.calls[0][0].data).toMatchObject({
      name: "Pilot — Lexora",
      value: 0,
    });
  });

  it("keeps a hand-made lead's estimate when there is no proposal price", async () => {
    ready();
    db.outreachDoc.findFirst.mockResolvedValue(null);
    await startPilotHandoff(asClient(db), actor, "p1");
    expect(db.crmLead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { status: "QUALIFIED" },
    });
  });

  it("can be retried: a stored deal is returned without converting again", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(
      makeProspect({ crmLeadId: "lead-1", crmDealId: "d1" })
    );
    expect(await startPilotHandoff(asClient(db), actor, "p1")).toEqual({ dealId: "d1" });
    expect(crm.convertLeadToContact).not.toHaveBeenCalled();
  });

  it("resumes a half-finished handoff: converted lead with a deal and no stored deal id", async () => {
    ready();
    db.crmLead.findFirst.mockResolvedValue({
      id: "lead-1",
      status: "CONVERTED",
      convertedContactId: "c1",
    });
    db.outreachDoc.findFirst.mockResolvedValue(null); // no offer: a rewrite would zero the value
    db.crmDeal.findFirst.mockResolvedValue({
      id: "d1",
      name: "Manual deal",
      value: new Prisma.Decimal("1500"),
      source: "Referral",
    });
    expect(await tryStartPilot(asClient(db), actor, "p1")).toBeNull();
    expect(db.crmDeal.findFirst).toHaveBeenCalledWith({
      where: { organisationId: "org-1", contactId: "c1" },
      orderBy: { createdAt: "desc" },
    });
    expect(crm.convertLeadToContact).not.toHaveBeenCalled();
    // The user's deal (name, value, source) is left untouched.
    expect(db.crmDeal.update).not.toHaveBeenCalled();
    expect(db.crmActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "NOTE", dealId: "d1", contactId: "c1" }),
    });
    expect(db.outreachProspect.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { crmDealId: "d1" },
    });
  });

  it("keeps the refusal when a converted lead has no deal for its contact", async () => {
    ready();
    db.crmLead.findFirst.mockResolvedValue({
      id: "lead-1",
      status: "CONVERTED",
      convertedContactId: "c1",
    });
    db.crmDeal.findFirst.mockResolvedValue(null);
    expect(await tryStartPilot(asClient(db), actor, "p1")).toBe(
      "This lead is already converted in CRM. Open it there to find the deal."
    );
  });

  it("refuses to convert a lead twice", async () => {
    ready();
    db.crmLead.findFirst.mockResolvedValue({ id: "lead-1", status: "CONVERTED" });
    await expect(startPilotHandoff(asClient(db), actor, "p1")).rejects.toThrow(
      "already converted in CRM"
    );
  });

  it("creates the lead first when there isn't one", async () => {
    ready();
    db.outreachProspect.findFirst.mockResolvedValue(
      makeProspect({ crmLeadId: null, company: "Lexora" })
    );
    db.crmLead.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "lead-3", status: "CONTACTED" });
    db.crmLead.create.mockResolvedValue({ id: "lead-3" });
    await startPilotHandoff(asClient(db), actor, "p1");
    expect(crm.convertLeadToContact).toHaveBeenCalledWith(db, "lead-3", "org-1");
  });

  it("is scoped to the organisation", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(null);
    await expect(startPilotHandoff(asClient(db), actor, "p1")).rejects.toThrow(
      "Prospect not found."
    );
    expect(db.outreachProspect.findFirst).toHaveBeenCalledWith({
      where: { id: "p1", organisationId: "org-1" },
    });
  });
});

describe("tryStartPilot", () => {
  it("returns null on success and a card message on failure", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect({ crmDealId: "d1" }));
    expect(await tryStartPilot(asClient(db), actor, "p1")).toBeNull();

    db.outreachProspect.findFirst.mockResolvedValue(makeProspect({ crmLeadId: "lead-1" }));
    db.crmLead.findFirst.mockResolvedValue({ id: "lead-1", status: "CONTACTED" });
    db.outreachDoc.findFirst.mockResolvedValue(null);
    crm.convertLeadToContact.mockRejectedValue(
      new Error("No pipeline with stages found. Create a pipeline first.")
    );
    expect(await tryStartPilot(asClient(db), actor, "p1")).toBe(
      "Not in CRM yet: create a pipeline first."
    );

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    crm.convertLeadToContact.mockRejectedValue(new Error("connection reset"));
    expect(await tryStartPilot(asClient(db), actor, "p1")).toBe(
      "Not in CRM yet: something went wrong. Retry from the prospect page."
    );
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
