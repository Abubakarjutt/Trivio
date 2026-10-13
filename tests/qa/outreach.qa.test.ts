// QA: Outreach — settings and offers, extracting and saving a prospect, AI drafts and docs,
// the stage machine through to the CRM pilot handoff, voice examples, do-not-contact,
// delete, and tenant isolation. The model and the website fetcher are faked; Postgres is real.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { DEFAULT_CADENCE, DEFAULT_WEIGHTS } from "@/server/services/outreach/types";
import { listAppActions } from "@/server/services/chat-actions";
import { RESEARCH_MESSAGES } from "@/server/services/outreach/research";
import { scoreSignals } from "@/server/services/outreach/scoring";
import { SearchError } from "@/server/services/outreach/search";
import { FakeLlm } from "../unit/outreach/helpers";
import { db, newUser, type QaUser } from "./harness";

const llmBox = vi.hoisted(() => ({ llm: null as unknown }));
vi.mock("@/server/services/outreach/llm", async (orig) => ({
  ...(await orig<typeof import("@/server/services/outreach/llm")>()),
  createLlm: () => llmBox.llm,
}));
const webBox = vi.hoisted(() => ({
  search: null as
    | null
    | ((key: string) => { search: (q: string, o?: { count?: number }) => Promise<unknown[]> }),
  fetchPage: null as
    | null
    | ((url: string) => Promise<{ status: number; url: string; body: string }>),
}));
vi.mock("@/server/services/outreach/website", async (orig) => ({
  ...(await orig<typeof import("@/server/services/outreach/website")>()),
  createPageFetcher: () => async (url: string) => {
    if (webBox.fetchPage) return webBox.fetchPage(url);
    throw new Error("QA never fetches a website");
  },
}));
vi.mock("@/server/services/outreach/search", async (orig) => ({
  ...(await orig<typeof import("@/server/services/outreach/search")>()),
  createBraveSearch: (key: string) => {
    if (!webBox.search) throw new Error("QA never calls Brave");
    return webBox.search(key);
  },
}));

const PASTE =
  "Jane Doe · CTO at Acme AI\n" + "We build RAG agents and they loop forever. ".repeat(10);
const SETTINGS = {
  sellerProfile: "I audit RAG systems for AI startups.",
  signalWeights: DEFAULT_WEIGHTS,
  cadence: DEFAULT_CADENCE,
  dailyCap: 20,
  weeklyCap: 100,
  hiringKeywords: ["llm", "ml"],
};

let u: QaUser;
let other: QaUser;
let offerId: string;
let prospectId: string;

beforeAll(async () => {
  u = await newUser({ businessName: "Outreach QA" });
  other = await newUser({ businessName: "Someone else" });
});

describe("settings and offers", () => {
  it("starts unconfigured, then saves settings and manages offers", async () => {
    expect((await u.api.outreachToday.get()).configured).toBe(false);
    expect(typeof (await u.api.outreachSettings.aiStatus()).ready).toBe("boolean");

    await u.api.outreachSettings.upsert(SETTINGS);
    offerId = (
      await u.api.outreachSettings.offerCreate({
        name: "RAG Audit",
        description: "Two-week retrieval audit",
        price: "4000",
        fittingSignals: ["pain_post"],
      })
    ).id;
    await u.api.outreachSettings.offerUpdate({
      id: offerId,
      name: "RAG Audit",
      description: "Two-week retrieval audit",
      price: "4500.50",
      fittingSignals: ["pain_post", "hiring"],
    });
    await u.api.outreachSettings.offerArchive({ id: offerId, archived: true });
    await u.api.outreachSettings.offerArchive({ id: offerId, archived: false });

    const got = await u.api.outreachSettings.get();
    expect(got.settings?.sellerProfile).toBe(SETTINGS.sellerProfile);
    expect(got.offers).toEqual([
      expect.objectContaining({ name: "RAG Audit", price: "4500.5", archived: false }),
    ]);
    // Money stays NUMERIC(19,4) in the database.
    const row = await db.outreachOffer.findUniqueOrThrow({ where: { id: offerId } });
    expect(row.price?.toFixed(4)).toBe("4500.5000");

    await expect(
      other.api.outreachSettings.offerArchive({ id: offerId, archived: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("adding a prospect", () => {
  it("extracts without saving, then saves what the user confirmed", async () => {
    llmBox.llm = new FakeLlm([
      {
        name: "Jane Doe",
        title: "CTO",
        company: "Acme AI",
        companyWebsite: null,
        companySize: "11-50",
        location: "Berlin",
        stack: ["pgvector"],
        signals: [{ name: "pain_post", evidence: "Post: our agents loop forever" }],
      },
    ]);
    const out = await u.api.outreachProspects.extract({
      profileUrl: "linkedin.com/in/Jane-Doe/",
      profileText: PASTE,
    });
    expect(out.profileUrl).toBe("https://www.linkedin.com/in/jane-doe");
    expect(out.enrichment.status).toBe("no_website");
    expect(await db.outreachProspect.count({ where: { organisationId: u.orgId } })).toBe(0);

    const saved = await u.api.outreachProspects.create({
      profileUrl: out.profileUrl,
      name: "Jane Doe",
      title: "CTO",
      company: "Acme AI",
      companyWebsite: null,
      companySize: "11-50",
      location: "Berlin",
      profileText: PASTE,
      stack: ["pgvector"],
      signals: out.extracted.signals,
      enrichmentStatus: out.enrichment.status,
    });
    prospectId = saved.id;
    expect(saved.created).toBe(true);

    await u.api.outreachProspects.update({ id: prospectId, title: "CTO & co-founder" });
    const list = await u.api.outreachProspects.list();
    expect(list.map((p) => [p.name, p.title, p.stage])).toEqual([
      ["Jane Doe", "CTO & co-founder", "QUEUED"],
    ]);
    expect(list[0]!.score).toBe(SETTINGS.signalWeights.pain_post);

    // Changing weights leaves saved scores alone until the user rescores.
    await u.api.outreachSettings.upsert({
      ...SETTINGS,
      signalWeights: { ...SETTINGS.signalWeights, pain_post: 7 },
    });
    expect((await u.api.outreachProspects.list())[0]!.score).toBe(SETTINGS.signalWeights.pain_post);
    expect(await u.api.outreachProspects.rescoreAll()).toEqual({ total: 1, changed: 1 });
    expect((await u.api.outreachProspects.list())[0]!.score).toBe(7);
    // Back to the original weights, so the rest of the file sees the usual scores.
    await u.api.outreachSettings.upsert(SETTINGS);
    expect(await u.api.outreachProspects.rescoreAll()).toEqual({ total: 1, changed: 1 });

    expect(await other.api.outreachProspects.list()).toEqual([]);
    await expect(other.api.outreachProspects.get({ id: prospectId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("working a prospect to a pilot", () => {
  it("drafts, logs events, analyses the thread, and hands the pilot to CRM", async () => {
    llmBox.llm = new FakeLlm([
      { variantA: "Hi Jane, saw your post?", variantB: "Jane, quick one?" },
    ]);
    const drafts = await u.api.outreachDrafts.generate({ id: prospectId, kind: "CONNECTION_NOTE" });
    expect(drafts.length).toBeGreaterThan(0);
    expect((await u.api.outreachDrafts.list({ id: prospectId })).length).toBe(drafts.length);

    await u.api.outreachProspects.logEvent({
      id: prospectId,
      event: "request_sent",
      sentText: "Hi Jane, saw your post about looping agents.",
    });
    expect((await u.api.outreachToday.get()).configured).toBe(true);
    await u.api.outreachProspects.logEvent({ id: prospectId, event: "accepted" });
    await u.api.outreachProspects.logEvent({ id: prospectId, event: "message_sent" });

    llmBox.llm = new FakeLlm([
      {
        summary: "Jane wants help with retrieval.",
        lastMessageFrom: "them",
        optedOut: false,
        suggestedEvents: ["replied"],
        reason: "She replied asking for a call.",
        replyA: "Happy to, does Thursday work?",
        replyB: null,
      },
    ]);
    const analysis = await u.api.outreachDocs.analyseConversation({
      id: prospectId,
      thread: "Me: Hi Jane\nJane: Can we talk about our RAG setup?",
    });
    expect(analysis.events).toEqual(["replied"]);
    await u.api.outreachProspects.applySuggestions({ id: prospectId, events: ["replied"] });
    await u.api.outreachProspects.logEvent({ id: prospectId, event: "teardown_booked" });

    let got = await u.api.outreachProspects.get({ id: prospectId });
    expect(got.prospect.stage).toBe("TEARDOWN");
    expect(got.crm.lead?.status).toBe("CONTACTED");
    await u.api.outreachProspects.retryCrmHandoff({ id: prospectId });

    llmBox.llm = new FakeLlm([
      {
        likelySetup: "pgvector with naive chunking",
        failurePoints: ["chunk size"],
        questions: ["How do you evaluate?"],
        quickWins: ["Add reranking"],
        offer: "rag audit",
        offerReason: "They have a retrieval problem.",
      },
      {
        title: "RAG Audit for Acme AI",
        problem: "Agents loop on bad retrieval.",
        scope: ["Retrieval pipeline"],
        deliverables: ["Report"],
        timeline: "2 weeks",
        successCriteria: ["Fewer loops"],
        nextStep: "Kick-off call",
      },
    ]);
    expect((await u.api.outreachDocs.teardown({ id: prospectId })).offerId).toBe(offerId);
    const proposal = await u.api.outreachDocs.proposal({
      id: prospectId,
      offerId,
      callNotes: "Wants it done before their launch.",
    });
    expect(proposal.text).toContain("4,500.50");

    // Without a pipeline the handoff reports instead of failing the stage change.
    await u.api.outreachProspects.logEvent({ id: prospectId, event: "pilot_started" });
    got = await u.api.outreachProspects.get({ id: prospectId });
    expect(got.prospect.stage).toBe("PILOT");
    expect(got.crm.deal).toBeNull();

    await u.api.crmPipelines.create({ name: "Sales", isDefault: true });
    expect((await u.api.outreachProspects.retryCrmHandoff({ id: prospectId })).error).toBeNull();
    got = await u.api.outreachProspects.get({ id: prospectId });
    expect(got.crm.lead?.status).toBe("CONVERTED");
    expect(got.crm.deal?.name).toBe("RAG Audit — Acme AI");
    expect(got.events.map((e) => e.kind)).not.toContain("crm_convert_started");
    const deal = await db.crmDeal.findUniqueOrThrow({ where: { id: got.crm.deal!.id } });
    expect(deal.value.toFixed(4)).toBe("4500.5000");
  });
});

describe("voice, do-not-contact and delete", () => {
  it("keeps sent text as anonymised voice examples that can be deleted", async () => {
    const voice = await u.api.outreachVoice.list();
    expect(voice.length).toBeGreaterThan(0);
    const bodies = voice.map((v) => v.body).join(" ");
    expect(bodies).toContain("saw your post about looping agents");
    expect(bodies).not.toContain("Jane");
    await expect(other.api.outreachVoice.delete({ id: voice[0]!.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await u.api.outreachVoice.delete({ id: voice[0]!.id });
    expect((await u.api.outreachVoice.list()).length).toBe(voice.length - 1);
  });

  it("marks a prospect do-not-contact and refuses to add them again", async () => {
    const sam = await u.api.outreachProspects.create({
      profileUrl: "https://www.linkedin.com/in/sam-lee",
      name: "Sam Lee",
      title: "Founder",
      company: "Lexora",
      companyWebsite: null,
      companySize: null,
      location: null,
      profileText: "Sam Lee · Founder at Lexora",
      stack: [],
      signals: [],
      enrichmentStatus: "no_website",
    });
    await u.api.outreachProspects.markDnc({ id: sam.id });
    expect((await u.api.outreachProspects.get({ id: sam.id })).prospect.stage).toBe("DNC");
    llmBox.llm = new FakeLlm([]);
    await expect(
      u.api.outreachDrafts.generate({ id: sam.id, kind: "CONNECTION_NOTE" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      u.api.outreachProspects.extract({
        profileUrl: "https://www.linkedin.com/in/sam-lee",
        profileText: "Sam again",
      })
    ).rejects.toThrow("do-not-contact");
  });

  it("deletes a prospect, but only in its own organisation", async () => {
    await expect(other.api.outreachProspects.delete({ id: prospectId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await u.api.outreachProspects.delete({ id: prospectId });
    await expect(u.api.outreachProspects.get({ id: prospectId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // The CRM deal it created belongs to the CRM now and stays.
    expect(await db.crmDeal.count({ where: { organisationId: u.orgId } })).toBe(1);
  });
});

describe("web research", () => {
  const ARTICLE =
    "<html><body><h1>Acme AI raises a $4M seed</h1><p>" +
    "Acme AI, which builds RAG agents, raised a $4M seed led by Example Ventures. ".repeat(5) +
    "</p></body></html>";
  const keysUsed: string[] = [];
  const ASK = { profileUrl: "linkedin.com/in/jane-doe-2", name: "Jane Doe", company: "Acme AI" };

  beforeAll(() => {
    webBox.search = (key) => ({
      search: async () => {
        keysUsed.push(key);
        if (key === "bad-key") throw new SearchError("bad_key", "Brave rejected this key. Check it and try again.");
        return [
          { title: "Acme raises", url: "https://news.example.com/acme-seed", snippet: "" },
          { title: "Jane", url: "https://www.linkedin.com/in/jane-doe", snippet: "" },
        ];
      },
    });
    webBox.fetchPage = async (url) => {
      if (url.includes("linkedin.com")) throw new Error("LinkedIn must never be fetched");
      return { status: 200, url, body: url.includes("acme-seed") ? ARTICLE : "" };
    };
  });
  afterAll(() => {
    webBox.search = null;
    webBox.fetchPage = null;
  });

  it("skips without a key, and keeps the key private", async () => {
    expect(await u.api.outreachProspects.research(ASK)).toMatchObject({
      status: "skipped",
      message: RESEARCH_MESSAGES.noKey,
    });
    expect((await u.api.outreachSettings.get()).searchKey).toEqual({ set: false, last4: null });

    await u.api.outreachSettings.setSearchKey({ apiKey: "  brave-key-abcd  " });
    const got = await u.api.outreachSettings.get();
    expect(got.searchKey).toEqual({ set: true, last4: "abcd" });
    expect(JSON.stringify(got)).not.toContain("brave-key-abcd");

    // Another organisation can neither see nor set it.
    expect((await other.api.outreachSettings.get()).searchKey).toEqual({ set: false, last4: null });
    await expect(other.api.outreachSettings.setSearchKey({ apiKey: "x" })).rejects.toThrow(
      "Set up Outreach first"
    );
  });

  it("tests a key", async () => {
    expect(await u.api.outreachSettings.testSearchKey({})).toEqual({ ok: true, message: null });
    expect(keysUsed.at(-1)).toBe("brave-key-abcd");
    expect(await u.api.outreachSettings.testSearchKey({ apiKey: "bad-key" })).toEqual({
      ok: false,
      message: "Brave rejected this key. Check it and try again.",
    });
  });

  it("returns web signals with sources, and saves them with the note", async () => {
    llmBox.llm = new FakeLlm([
      {
        signals: [{ name: "funding", evidence: "Raised a $4M seed", pageId: 1 }],
        note: "Acme AI builds RAG agents; raised a $4M seed.",
      },
    ]);
    const out = await u.api.outreachProspects.research({ ...ASK, companyWebsite: "https://acme.ai" });
    expect(out).toEqual({
      status: "done",
      message: null,
      signals: [
        {
          name: "funding",
          evidence: "Raised a $4M seed",
          source: "https://news.example.com/acme-seed",
        },
      ],
      note: "Acme AI builds RAG agents; raised a $4M seed.",
      sources: ["https://news.example.com/acme-seed"],
    });

    const saved = await u.api.outreachProspects.create({
      profileUrl: ASK.profileUrl,
      name: "Jane Doe",
      title: "CTO",
      company: "Acme AI",
      companyWebsite: "https://acme.ai",
      companySize: null,
      location: null,
      profileText: PASTE,
      stack: [],
      signals: out.signals,
      enrichmentStatus: "checked",
      research: out.note,
    });
    const row = await db.outreachProspect.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.research).toBe(out.note);
    expect(row.signals).toEqual(out.signals);
    // A web signal scores like any other signal of that name.
    expect(row.score).toBe(scoreSignals(out.signals, SETTINGS.signalWeights).score);
    expect(row.score).toBeGreaterThan(0);

    // Editing other fields keeps the note.
    await u.api.outreachProspects.update({ id: saved.id, title: "CEO" });
    expect(
      (await db.outreachProspect.findUniqueOrThrow({ where: { id: saved.id } })).research
    ).toBe(out.note);
  });

  it("turns a rejected key into a skip, not an error", async () => {
    await u.api.outreachSettings.setSearchKey({ apiKey: "bad-key" });
    expect(await u.api.outreachProspects.research(ASK)).toMatchObject({
      status: "skipped",
      message: RESEARCH_MESSAGES.badKey,
    });
    await u.api.outreachSettings.setSearchKey({ apiKey: null });
    expect((await u.api.outreachSettings.get()).searchKey).toEqual({ set: false, last4: null });
  });

  it("refuses a do-not-contact profile", async () => {
    await expect(
      u.api.outreachProspects.research({
        profileUrl: "https://www.linkedin.com/in/sam-lee",
        name: "Sam Lee",
        company: "Lexora",
      })
    ).rejects.toThrow("do-not-contact");
  });

  it("is not offered to the chat", () => {
    const names = listAppActions().map((a) => a.name);
    for (const n of [
      "outreachProspects.research",
      "outreachSettings.setSearchKey",
      "outreachSettings.testSearchKey",
    ])
      expect(names).not.toContain(n);
  });
});
