import { Prisma, type PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libDb = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => libDb);
const llmBox = vi.hoisted(() => ({ llm: null as unknown }));
vi.mock("@/server/services/outreach/llm", async (orig) => ({
  ...(await orig<typeof import("@/server/services/outreach/llm")>()),
  createLlm: () => llmBox.llm,
}));
const fetchBox = vi.hoisted(() => ({ fetchPage: vi.fn() }));
vi.mock("@/server/services/outreach/website", async (orig) => ({
  ...(await orig<typeof import("@/server/services/outreach/website")>()),
  createPageFetcher: () => fetchBox.fetchPage,
}));

import { createCallerFactory, createTRPCRouter } from "@/server/trpc";
import { outreachDraftsRouter } from "@/server/routers/outreachDrafts";
import { outreachDocsRouter } from "@/server/routers/outreachDocs";
import { outreachProspectsRouter } from "@/server/routers/outreachProspects";
import { outreachSettingsRouter } from "@/server/routers/outreachSettings";
import { outreachTodayRouter } from "@/server/routers/outreachToday";
import { listAppActions } from "@/server/services/chat-actions";
import { DEFAULT_CADENCE, DEFAULT_WEIGHTS } from "@/server/services/outreach/types";
import { FakeLlm, makeDb, makeProspect, NOW, type MockDb } from "./helpers";

const router = createTRPCRouter({
  outreachSettings: outreachSettingsRouter,
  outreachProspects: outreachProspectsRouter,
  outreachDocs: outreachDocsRouter,
  outreachDrafts: outreachDraftsRouter,
  outreachToday: outreachTodayRouter,
});
const createCaller = createCallerFactory(router);
let db: MockDb;
const caller = () =>
  createCaller({
    session: { user: { id: "user-1" }, expires: "2099-01-01" },
    db: db as unknown as PrismaClient,
    ip: "test",
  } as Parameters<typeof createCaller>[0]);

const settingsRow = {
  sellerProfile: "I audit RAG systems.",
  signalWeights: DEFAULT_WEIGHTS,
  cadence: DEFAULT_CADENCE,
  dailyCap: 20,
  weeklyCap: 100,
  hiringKeywords: ["llm"],
};
const PASTE = "Jane Doe · CTO at Acme AI\n" + "We build RAG agents. ".repeat(20);
const prep = {
  likelySetup: "pgvector",
  failurePoints: ["a"],
  questions: ["b"],
  quickWins: ["c"],
  offer: "Made-up Offer",
  offerReason: "r",
};
const proposal = {
  title: "RAG Audit for Acme AI",
  problem: "p",
  scope: ["s"],
  deliverables: ["d"],
  timeline: "2 weeks",
  successCriteria: ["c"],
  nextStep: "n",
};
const offer = (o: object = {}) => ({
  id: "o1",
  organisationId: "org-1",
  name: "RAG Audit",
  description: "Audit retrieval",
  price: new Prisma.Decimal("4000"),
  fittingSignals: [],
  archived: false,
  ...o,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = makeDb();
  libDb.db.user.findUnique.mockResolvedValue({
    id: "user-1",
    organisationId: "org-1",
    organisation: { id: "org-1", currency: "USD" },
  });
  db.outreachSettings.findUnique.mockResolvedValue(settingsRow);
  db.outreachConversation.findFirst.mockResolvedValue(null);
  db.outreachDoc.findFirst.mockResolvedValue(null);
  db.outreachVoiceExample.findMany.mockResolvedValue([]);
  db.outreachEvent.count.mockResolvedValue(0);
  db.outreachProspect.updateMany.mockResolvedValue({ count: 1 });
});

describe("error mapping", () => {
  it("maps a missing prospect to NOT_FOUND and an OutreachError to BAD_REQUEST", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(null);
    await expect(
      caller().outreachProspects.logEvent({ id: "nope", event: "accepted" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect());
    await expect(
      caller().outreachProspects.logEvent({ id: "p1", event: "won" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("outreachProspects.extract", () => {
  it("returns extraction and enrichment without saving anything", async () => {
    db.outreachDnc.findUnique.mockResolvedValue(null);
    llmBox.llm = new FakeLlm([
      {
        name: "Jane Doe",
        title: "CTO",
        company: "Acme AI",
        companyWebsite: "acme.ai",
        companySize: null,
        location: null,
        stack: [],
        signals: [{ name: "pain_post", evidence: "Post: our agent loops forever" }],
      },
    ]);
    fetchBox.fetchPage.mockImplementation(async (url: string) => ({
      status: 200,
      url,
      body: new URL(url).pathname === "/careers" ? "<li>LLM Engineer</li>" : "<html/>",
    }));
    const out = await caller().outreachProspects.extract({
      profileUrl: "linkedin.com/in/Jane-Doe/",
      profileText: PASTE,
      companyWebsite: "real-acme.com",
    });
    expect(out.profileUrl).toBe("https://www.linkedin.com/in/jane-doe");
    expect(out.enrichment).toMatchObject({ status: "checked", website: "https://real-acme.com" });
    expect(out.enrichment.signals.map((s) => s.name)).toEqual(["hiring"]);
    expect(db.outreachProspect.create).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("never fetches a model-chosen website that isn't in the pasted text", async () => {
    db.outreachDnc.findUnique.mockResolvedValue(null);
    llmBox.llm = new FakeLlm([
      {
        name: "Jane Doe",
        title: "CTO",
        company: "Acme AI",
        companyWebsite: "https://collect.example/x?seller=our+offer",
        companySize: null,
        location: null,
        stack: [],
        signals: [],
      },
    ]);
    fetchBox.fetchPage.mockReset();
    const out = await caller().outreachProspects.extract({
      profileUrl: "linkedin.com/in/jane-doe",
      profileText: PASTE,
    });
    expect(fetchBox.fetchPage).not.toHaveBeenCalled();
    expect(out.enrichment.status).toBe("no_website");
  });

  it("fetches only the origin of a website named in the pasted text", async () => {
    db.outreachDnc.findUnique.mockResolvedValue(null);
    llmBox.llm = new FakeLlm([
      {
        name: "Jane Doe",
        title: "CTO",
        company: "Acme AI",
        companyWebsite: "https://www.Acme.ai/about?ref=profile",
        companySize: null,
        location: null,
        stack: [],
        signals: [],
      },
    ]);
    fetchBox.fetchPage.mockReset();
    fetchBox.fetchPage.mockImplementation(async (url: string) => ({ status: 200, url, body: "" }));
    const out = await caller().outreachProspects.extract({
      profileUrl: "linkedin.com/in/jane-doe",
      profileText: PASTE + "\nWebsite: acme.ai",
    });
    expect(out.enrichment.website).toBe("https://www.acme.ai");
    expect(fetchBox.fetchPage.mock.calls[0][0]).toBe("https://www.acme.ai");
  });

  it("fetches only the origin of a typed website, never its path or query (I-1)", async () => {
    db.outreachDnc.findUnique.mockResolvedValue(null);
    llmBox.llm = new FakeLlm([
      {
        name: "Jane Doe",
        title: "CTO",
        company: "Acme AI",
        companyWebsite: null,
        companySize: null,
        location: null,
        stack: [],
        signals: [],
      },
    ]);
    fetchBox.fetchPage.mockReset();
    fetchBox.fetchPage.mockImplementation(async (url: string) => ({ status: 200, url, body: "" }));
    const out = await caller().outreachProspects.extract({
      profileUrl: "linkedin.com/in/jane-doe",
      profileText: PASTE,
      companyWebsite: "https://collect.example/x?d=secret",
    });
    expect(out.enrichment.website).toBe("https://collect.example");
    for (const [url] of fetchBox.fetchPage.mock.calls) expect(url).not.toContain("secret");
  });

  it("refuses a DNC person before calling the model", async () => {
    db.outreachDnc.findUnique.mockResolvedValue({ id: "d1" });
    const llm = new FakeLlm([]);
    llmBox.llm = llm;
    await expect(
      caller().outreachProspects.extract({
        profileUrl: "https://www.linkedin.com/in/jane-doe",
        profileText: PASTE,
      })
    ).rejects.toThrow("do-not-contact");
    expect(llm.calls).toEqual([]);
  });

  it("rejects a non-LinkedIn URL with BAD_REQUEST", async () => {
    await expect(
      caller().outreachProspects.extract({ profileUrl: "https://example.com", profileText: PASTE })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("outreachDocs", () => {
  beforeEach(() => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect({ stage: "TEARDOWN" }));
    db.outreachOffer.findMany.mockResolvedValue([
      offer(),
      offer({ id: "o2", name: "Agent Sprint", price: null }),
    ]);
  });

  it("saves a teardown with offerId null when the model names an unknown offer (Review Focus #4)", async () => {
    llmBox.llm = new FakeLlm([prep]);
    const out = await caller().outreachDocs.teardown({ id: "p1" });
    expect(out.offerId).toBeNull();
    expect(db.outreachDoc.upsert.mock.calls[0][0].create).toMatchObject({
      kind: "TEARDOWN_PREP",
      body: { offer: "Made-up Offer", offerId: null },
    });
  });

  it("matches the model's offer name to the organisation's offer, ignoring case and spaces", async () => {
    llmBox.llm = new FakeLlm([{ ...prep, offer: " rag audit " }]);
    expect((await caller().outreachDocs.teardown({ id: "p1" })).offerId).toBe("o1");
  });

  it("falls back to the first active offer and inserts the price from code (Review Focus #4)", async () => {
    db.outreachDoc.findFirst.mockResolvedValue({ body: { ...prep, offerId: null } });
    llmBox.llm = new FakeLlm([proposal]);
    const out = await caller().outreachDocs.proposal({ id: "p1", callNotes: "" });
    expect(out).toMatchObject({ offerId: "o1", offerName: "RAG Audit" });
    expect(out.text).toContain("Price: $4,000.00");
    expect(db.outreachDoc.upsert.mock.calls[0][0].create).toMatchObject({
      kind: "PROPOSAL",
      body: { offerId: "o1", offerName: "RAG Audit" },
    });
  });

  it("uses the chosen offer, scoped to the organisation, with a [price] placeholder when it has no price", async () => {
    llmBox.llm = new FakeLlm([proposal]);
    db.outreachOffer.findFirst.mockResolvedValue(
      offer({ id: "o2", name: "Agent Sprint", price: null })
    );
    const out = await caller().outreachDocs.proposal({
      id: "p1",
      offerId: "o2",
      callNotes: "notes",
    });
    expect(out.text).toContain("Offer: Agent Sprint");
    expect(out.text).toContain("Price: [price]");
    expect(db.outreachOffer.findFirst).toHaveBeenCalledWith({
      where: { id: "o2", organisationId: "org-1" },
    });
  });

  it("asks for an offer when the organisation has none", async () => {
    db.outreachOffer.findMany.mockResolvedValue([]);
    llmBox.llm = new FakeLlm([proposal]);
    await expect(caller().outreachDocs.proposal({ id: "p1", callNotes: "" })).rejects.toThrow(
      "Add an offer in Outreach settings first."
    );
  });
});

describe("outreachProspects.rescoreAll", () => {
  it("rescores with the organisation's saved weights", async () => {
    db.outreachProspect.findMany.mockResolvedValue([
      {
        id: "p1",
        signals: [{ name: "funding", evidence: "Raised a seed round" }],
        score: 0,
        primarySignal: null,
        scoreReasons: [],
      },
    ]);
    expect(await caller().outreachProspects.rescoreAll()).toEqual({ total: 1, changed: 1 });
    expect(db.outreachProspect.findMany.mock.calls[0][0].where).toEqual({
      organisationId: "org-1",
    });
    expect(db.outreachProspect.updateMany.mock.calls[0][0].data.score).toBe(
      DEFAULT_WEIGHTS.funding
    );
  });
});

describe("do-not-contact prospects", () => {
  it("refuses every AI generation call, so the chat can't draft for them either", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(makeProspect({ stage: "DNC" }));
    llmBox.llm = new FakeLlm([]);
    const c = caller();
    for (const call of [
      () => c.outreachDrafts.generate({ id: "p1", kind: "CONNECTION_NOTE" }),
      () => c.outreachDocs.analyseConversation({ id: "p1", thread: "Hi" }),
      () => c.outreachDocs.teardown({ id: "p1" }),
      () => c.outreachDocs.proposal({ id: "p1", callNotes: "notes" }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This person is on your do-not-contact list.",
      });
    }
    expect((llmBox.llm as FakeLlm).calls).toHaveLength(0);
  });
});

describe("organisation scoping of prospect ids", () => {
  it("gives NOT_FOUND for a foreign-org prospect on every id-taking procedure, before any write", async () => {
    db.outreachProspect.findFirst.mockResolvedValue(null);
    llmBox.llm = new FakeLlm([]);
    const c = caller();
    const calls = [
      () => c.outreachDocs.teardown({ id: "foreign" }),
      () => c.outreachDocs.proposal({ id: "foreign", callNotes: "" }),
      () => c.outreachDocs.analyseConversation({ id: "foreign", thread: "x".repeat(40) }),
      () => c.outreachDrafts.generate({ id: "foreign", kind: "CONNECTION_NOTE" }),
      () => c.outreachDrafts.list({ id: "foreign" }),
      () => c.outreachProspects.get({ id: "foreign" }),
      () => c.outreachProspects.update({ id: "foreign", title: "x" }),
      () => c.outreachProspects.applySuggestions({ id: "foreign", events: ["accepted"] }),
      () => c.outreachProspects.markDnc({ id: "foreign" }),
      () => c.outreachProspects.delete({ id: "foreign" }),
      () => c.outreachProspects.retryCrmHandoff({ id: "foreign" }),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.outreachProspect.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", organisationId: "org-1" },
    });
    for (const m of ["outreachDoc", "outreachDraft", "outreachConversation"] as const) {
      for (const w of ["upsert", "create", "createMany", "deleteMany"])
        expect(db[m][w]).not.toHaveBeenCalled();
    }
    expect(db.outreachProspect.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.outreachDraft.findMany).not.toHaveBeenCalled();
  });
});

describe("outreachSettings and outreachToday", () => {
  it("returns prices as strings", async () => {
    db.outreachOffer.findMany.mockResolvedValue([offer()]);
    expect((await caller().outreachSettings.get()).offers[0].price).toBe("4000");
  });

  it("refuses a negative or exponent-style price", async () => {
    for (const price of ["-1", "1e3"]) {
      await expect(
        caller().outreachSettings.offerCreate({
          name: "X",
          description: "",
          price,
          fittingSignals: [],
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(db.outreachOffer.create).not.toHaveBeenCalled();
  });

  it("accepts a 15-digit price and refuses a 16-digit one (NUMERIC(19,4))", async () => {
    db.outreachOffer.create.mockResolvedValue({ id: "o9" });
    const make = (price: string) =>
      caller().outreachSettings.offerCreate({
        name: "X",
        description: "",
        price,
        fittingSignals: [],
      });
    await expect(make("1".repeat(16))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.outreachOffer.create).not.toHaveBeenCalled();
    await expect(make("1".repeat(15) + ".5")).resolves.toEqual({ id: "o9" });
  });

  it("reports Today as not configured without settings", async () => {
    db.outreachSettings.findUnique.mockResolvedValue(null);
    expect(await caller().outreachToday.get()).toEqual({ configured: false });
  });
});

describe("chat denylist", () => {
  it("keeps destructive Outreach actions out of the AI chat", () => {
    const names = listAppActions().map((a) => a.name);
    expect(names).not.toContain("outreachProspects.delete");
    expect(names).not.toContain("outreachProspects.markDnc");
    expect(names).not.toContain("outreachVoice.delete");
    // extract fetches a website: a model-written input would let a prompt injection pick the URL.
    expect(names).not.toContain("outreachProspects.extract");
    expect(names).toContain("outreachToday.get");
  });
});
