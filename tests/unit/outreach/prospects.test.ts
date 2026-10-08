import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handoff = vi.hoisted(() => ({ linkCrmLead: vi.fn(), tryStartPilot: vi.fn() }));
vi.mock("@/server/services/outreach/crm-handoff", () => handoff);

import { loadConfig, requireConfig, type OutreachConfig } from "@/server/services/outreach/config";
import {
  applyEvent,
  applyEvents,
  capStatus,
  deleteProspect,
  markDnc,
  recentVoice,
  saveDrafts,
  saveProspect,
  type ProspectInput,
} from "@/server/services/outreach/prospects";
import { DEFAULT_CADENCE, DEFAULT_WEIGHTS } from "@/server/services/outreach/types";
import { makeDb, makeProspect, NOW, type MockDb } from "./helpers";

process.env.TZ = "UTC";
const actor = { orgId: "org-1", userId: "user-1" };
const config: OutreachConfig = {
  sellerProfile: "S",
  weights: DEFAULT_WEIGHTS,
  cadence: DEFAULT_CADENCE,
  dailyCap: 20,
  weeklyCap: 100,
  hiringKeywords: [],
};
const input: ProspectInput = {
  profileUrl: "https://www.linkedin.com/in/jane-doe",
  name: "Jane Doe",
  title: "CTO",
  company: "Acme AI",
  companyWebsite: null,
  companySize: null,
  location: null,
  profileText: "…",
  stack: [],
  signals: [{ name: "hiring", evidence: "Careers page lists “AI Engineer”" }],
  enrichmentStatus: "checked",
};
let db: MockDb;
const client = () => db as unknown as PrismaClient;

beforeEach(() => {
  db = makeDb();
  handoff.linkCrmLead.mockReset();
  handoff.tryStartPilot.mockReset().mockResolvedValue(null);
  db.outreachEvent.count.mockResolvedValue(0);
  db.outreachProspect.updateMany.mockResolvedValue({ count: 1 });
});

describe("config", () => {
  it("requires settings and falls back to defaults for bad Json", async () => {
    db.outreachSettings.findUnique.mockResolvedValue(null);
    await expect(requireConfig(client(), "org-1")).rejects.toThrow("Set up Outreach first");
    db.outreachSettings.findUnique.mockResolvedValue({
      sellerProfile: "S",
      signalWeights: { hiring: "lots" },
      cadence: null,
      dailyCap: 10,
      weeklyCap: 50,
      hiringKeywords: ["ai"],
    });
    expect(await loadConfig(client(), "org-1")).toEqual({
      sellerProfile: "S",
      weights: DEFAULT_WEIGHTS,
      cadence: DEFAULT_CADENCE,
      dailyCap: 10,
      weeklyCap: 50,
      hiringKeywords: ["ai"],
    });
  });
});

describe("saveProspect", () => {
  it("creates a new prospect in QUEUED with a source and a created event", async () => {
    db.outreachDnc.findUnique.mockResolvedValue(null);
    db.outreachProspect.findUnique.mockResolvedValue(null);
    db.outreachProspect.create.mockResolvedValue({ id: "p1" });
    expect(await saveProspect(client(), "org-1", input, DEFAULT_WEIGHTS, NOW)).toEqual({
      id: "p1",
      created: true,
    });
    expect(db.outreachProspect.create.mock.calls[0][0].data).toMatchObject({
      organisationId: "org-1",
      stage: "QUEUED",
      stageChangedAt: NOW,
      score: 3,
      primarySignal: "hiring",
      source: "Sales Navigator, manual capture, 2026-10-07",
    });
    expect(db.outreachEvent.create).toHaveBeenCalledWith({
      data: {
        organisationId: "org-1",
        prospectId: "p1",
        kind: "created",
        at: NOW,
        meta: { score: 3, primarySignal: "hiring" },
      },
    });
  });

  it("updates an existing URL without touching its stage", async () => {
    db.outreachDnc.findUnique.mockResolvedValue(null);
    db.outreachProspect.findUnique.mockResolvedValue({ id: "p1" });
    expect(
      await saveProspect(client(), "org-1", { ...input, title: "CEO & CTO" }, DEFAULT_WEIGHTS, NOW)
    ).toEqual({ id: "p1", created: false });
    const data = db.outreachProspect.update.mock.calls[0][0].data;
    expect(data.title).toBe("CEO & CTO");
    expect(data).not.toHaveProperty("stage");
    expect(db.outreachEvent.create.mock.calls[0][0].data).toMatchObject({
      kind: "refreshed",
      meta: { score: 3 },
    });
  });

  it("refuses someone on the do-not-contact list", async () => {
    db.outreachDnc.findUnique.mockResolvedValue({ id: "d1" });
    await expect(saveProspect(client(), "org-1", input, DEFAULT_WEIGHTS, NOW)).rejects.toThrow(
      "This person is on your do-not-contact list."
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.outreachDnc.findUnique).toHaveBeenCalledWith({
      where: {
        organisationId_profileUrl: { organisationId: "org-1", profileUrl: input.profileUrl },
      },
    });
  });
});

describe("capStatus", () => {
  it("counts the organisation's request_sent events today and this week", async () => {
    db.outreachEvent.count.mockResolvedValueOnce(3).mockResolvedValueOnce(8);
    expect((await capStatus(client(), "org-1", NOW, config)).remaining).toBe(17);
    expect(db.outreachEvent.count).toHaveBeenNthCalledWith(1, {
      where: {
        organisationId: "org-1",
        kind: "request_sent",
        at: { gte: new Date("2026-10-07T00:00:00Z") },
      },
    });
    expect(db.outreachEvent.count).toHaveBeenNthCalledWith(2, {
      where: {
        organisationId: "org-1",
        kind: "request_sent",
        at: { gte: new Date("2026-10-05T00:00:00Z") },
      },
    });
  });
});

describe("applyEvent", () => {
  it("applies the transition with an optimistic-concurrency guard and logs {from, to}", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect());
    expect(await applyEvent(client(), actor, "p1", "request_sent", NOW, config)).toEqual({
      stage: "REQUEST_SENT",
      handoffError: null,
    });
    expect(db.outreachProspect.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", organisationId: "org-1", stage: "QUEUED", updatedAt: NOW },
      data: { stage: "REQUEST_SENT", stageChangedAt: NOW },
    });
    expect(db.outreachEvent.create.mock.calls[0][0].data).toMatchObject({
      kind: "request_sent",
      meta: { from: "QUEUED", to: "REQUEST_SENT" },
    });
  });

  it("refuses a write when another window changed the prospect (Review Focus #1)", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect());
    db.outreachProspect.updateMany.mockResolvedValue({ count: 0 });
    await expect(applyEvent(client(), actor, "p1", "request_sent", NOW, config)).rejects.toThrow(
      "This prospect changed in another window. Reload and try again."
    );
    expect(db.outreachEvent.create).not.toHaveBeenCalled();
  });

  it("refuses request_sent at the cap", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect());
    db.outreachEvent.count.mockResolvedValue(20);
    await expect(applyEvent(client(), actor, "p1", "request_sent", NOW, config)).rejects.toThrow(
      "Connection request cap reached. Try again tomorrow (or next week)."
    );
    expect(db.outreachProspect.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an invalid event", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect());
    await expect(applyEvent(client(), actor, "p1", "won", NOW, config)).rejects.toThrow(
      "Can't log"
    );
  });

  it("saves what was actually sent as an anonymised voice example", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect({ stage: "CONNECTED" }));
    await applyEvent(client(), actor, "p1", "message_sent", NOW, config, {
      sentText: "Hi Jane, how do you grade evals?",
    });
    expect(db.outreachVoiceExample.create).toHaveBeenCalledWith({
      data: {
        organisationId: "org-1",
        prospectId: "p1",
        kind: "message_sent",
        body: "Hi X, how do you grade evals?",
        createdAt: NOW,
      },
    });
  });

  it("ignores blank sent text", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect({ stage: "CONNECTED" }));
    await applyEvent(client(), actor, "p1", "message_sent", NOW, config, { sentText: "   " });
    expect(db.outreachVoiceExample.create).not.toHaveBeenCalled();
  });

  it("links the CRM lead inside the transaction on teardown_booked", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect({ stage: "ENGAGED" }));
    await applyEvent(client(), actor, "p1", "teardown_booked", NOW, config);
    expect(handoff.linkCrmLead).toHaveBeenCalledWith(
      db,
      "org-1",
      expect.objectContaining({ id: "p1", stage: "TEARDOWN" })
    );
  });

  it("starts the pilot handoff after the commit and reports its error", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect({ stage: "TEARDOWN" }));
    handoff.tryStartPilot.mockResolvedValue("Not in CRM yet: create a pipeline first.");
    expect(await applyEvent(client(), actor, "p1", "pilot_started", NOW, config)).toEqual({
      stage: "PILOT",
      handoffError: "Not in CRM yet: create a pipeline first.",
    });
    expect(handoff.tryStartPilot).toHaveBeenCalledWith(db, actor, "p1");
  });

  it("is scoped to the organisation", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(null);
    await expect(applyEvent(client(), actor, "p1", "request_sent", NOW, config)).rejects.toThrow(
      "Prospect not found."
    );
    expect(db.outreachProspect.findFirst).toHaveBeenCalledWith({
      where: { id: "p1", organisationId: "org-1" },
    });
  });
});

describe("applyEvents", () => {
  it("applies in order and stops at the first error", async () => {
    db.outreachProspect.findFirst
      .mockResolvedValueOnce(makeProspect({ stage: "REQUEST_SENT" }))
      .mockResolvedValueOnce(makeProspect({ stage: "CONNECTED" }));
    const result = await applyEvents(
      client(),
      actor,
      "p1",
      ["accepted", "won", "message_sent"],
      NOW,
      config
    );
    expect(result.applied).toEqual(["accepted"]);
    expect(result.stage).toBe("CONNECTED");
    expect(result.error).toContain("won");
    expect(db.outreachProspect.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe("markDnc and deleteProspect", () => {
  it("marks DNC: adds the DNC row, clears drafts, keeps CRM rows", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(
      makeProspect({ stage: "VALUE_SENT", crmLeadId: "lead-1" })
    );
    expect(await markDnc(client(), "org-1", "p1", NOW)).toEqual({
      crmLeadId: "lead-1",
      crmDealId: null,
    });
    expect(db.outreachDnc.upsert.mock.calls[0][0].create).toMatchObject({
      organisationId: "org-1",
      reason: "asked not to be contacted",
    });
    expect(db.outreachProspect.update.mock.calls[0][0].data).toMatchObject({
      stage: "DNC",
      stageChangedAt: NOW,
    });
    expect(db.outreachDraft.deleteMany).toHaveBeenCalledWith({
      where: { organisationId: "org-1", prospectId: "p1" },
    });
    expect(db.outreachEvent.create.mock.calls[0][0].data).toMatchObject({
      kind: "dnc",
      meta: { from: "VALUE_SENT" },
    });
    expect(db.crmLead.delete).not.toHaveBeenCalled();
  });

  it("deletes: adds the DNC row and records an anonymous event", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect());
    await deleteProspect(client(), "org-1", "p1", NOW);
    expect(db.outreachDnc.upsert.mock.calls[0][0].create).toMatchObject({
      reason: "deleted on request",
    });
    expect(db.outreachProspect.deleteMany).toHaveBeenCalledWith({
      where: { id: "p1", organisationId: "org-1" },
    });
    expect(db.outreachEvent.create).toHaveBeenCalledWith({
      data: { organisationId: "org-1", prospectId: null, kind: "deleted", at: NOW, meta: {} },
    });
  });
});

describe("voice and drafts", () => {
  it("returns the newest voice bodies first", async () => {
    db.outreachVoiceExample.findMany.mockResolvedValue([{ body: "msg 9" }, { body: "msg 8" }]);
    expect(await recentVoice(client(), "org-1", 2)).toEqual(["msg 9", "msg 8"]);
    expect(db.outreachVoiceExample.findMany).toHaveBeenCalledWith({
      where: { organisationId: "org-1" },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { body: true },
    });
  });

  it("replaces the previous drafts of the same kind", async () => {
    await saveDrafts(client(), "org-1", "p1", "CONNECTION_NOTE", [
      { variant: "A", body: "three", violations: ["too long"] },
      { variant: "B", body: "four", violations: [] },
    ]);
    expect(db.outreachDraft.deleteMany).toHaveBeenCalledWith({
      where: { organisationId: "org-1", prospectId: "p1", kind: "CONNECTION_NOTE" },
    });
    expect(db.outreachDraft.createMany.mock.calls[0][0].data).toEqual([
      {
        organisationId: "org-1",
        prospectId: "p1",
        kind: "CONNECTION_NOTE",
        variant: "A",
        body: "three",
        violations: ["too long"],
      },
      {
        organisationId: "org-1",
        prospectId: "p1",
        kind: "CONNECTION_NOTE",
        variant: "B",
        body: "four",
        violations: [],
      },
    ]);
  });
});
