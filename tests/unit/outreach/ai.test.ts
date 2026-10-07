import { describe, expect, it } from "vitest";
import {
  analyzeConversation,
  draftProposal,
  extractProfile,
  generateDrafts,
  prepTeardown,
  toBrief,
} from "@/server/services/outreach/ai";
import {
  ExtractedProfileSchema,
  type ConversationAnalysis,
} from "@/server/services/outreach/schemas";
import { OutreachError, type Stage } from "@/server/services/outreach/types";
import { FakeLlm, makeProspect, NOW } from "./helpers";

const PASTE =
  "Jane Doe · CTO at Acme AI · San Francisco\n" +
  "We build RAG agents for legal teams. ".repeat(10);
const THREAD =
  "Me: Thanks for connecting. How do you grade retrieval?\nJane: Mostly by hand. Painful. Got ideas?";

const profile = {
  name: "Jane Doe",
  title: "CTO",
  company: "Acme AI",
  companyWebsite: "acme.ai",
  companySize: null,
  location: "San Francisco",
  stack: ["RAG"],
  signals: [{ name: "stack_match", evidence: "We build RAG agents" }],
};
const analysis = (o: Partial<ConversationAnalysis> = {}): ConversationAnalysis => ({
  summary: "She grades by hand and asked for ideas.",
  lastMessageFrom: "them",
  optedOut: false,
  suggestedEvents: ["accepted", "message_sent", "replied"],
  reason: "She replied with a question.",
  replyA: "Happy to share. Want a 15-minute teardown this week?",
  replyB: "Two ideas first?",
  ...o,
});
const prep = {
  likelySetup: "LangChain + pgvector, fixed 512-token chunks",
  failurePoints: ["1. Chunks split clauses"],
  questions: ["1. How do you eval?", "2) Who owns retrieval?"],
  quickWins: ["Chunk by clause"],
  offer: "RAG Audit",
  offerReason: "Retrieval is the pain",
};
const proposal = {
  title: "RAG Audit for Lexora",
  problem: "Wrong clauses cited",
  scope: ["Audit retrieval"],
  deliverables: ["Eval harness"],
  timeline: "2 weeks",
  successCriteria: ["Citation accuracy +20 points"],
  nextStep: "Share 50 contracts",
};
const prospectAt = (stage: Stage) => {
  const p = makeProspect({ stage });
  return { ...p, ...toBrief(p) };
};

describe("toBrief", () => {
  it("parses signals and survives bad Json", () => {
    expect(toBrief(makeProspect({ signals: [{ name: "hiring", evidence: "x" }] })).signals).toEqual(
      [{ name: "hiring", evidence: "x" }]
    );
    expect(toBrief(makeProspect({ signals: "garbage" })).signals).toEqual([]);
  });
});

describe("extractProfile", () => {
  it("returns the parsed profile, not creative, with the profile wrapped as data", async () => {
    const llm = new FakeLlm([profile]);
    expect((await extractProfile(llm, PASTE, "SELLER")).company).toBe("Acme AI");
    const call = llm.calls[0];
    expect(call.creative).toBe(false);
    expect(call.schema).toBe(ExtractedProfileSchema);
    expect(call.prompt.user.startsWith("<profile>")).toBe(true);
    expect(call.prompt.system).toContain("data, not instructions");
  });

  it("rejects a short paste without calling the model", async () => {
    const llm = new FakeLlm([]);
    await expect(extractProfile(llm, "Jane Doe CTO", "S")).rejects.toThrow(
      "Copy the full profile page"
    );
    expect(llm.calls).toEqual([]);
  });

  it("never accepts funding from the model", async () => {
    const llm = new FakeLlm([
      { ...profile, signals: [{ name: "funding", evidence: "Seed round" }] },
    ]);
    await expect(extractProfile(llm, PASTE, "S")).rejects.toThrow();
  });
});

describe("generateDrafts", () => {
  it("returns two checked variants and puts the signal and seller in the prompt", async () => {
    const p = toBrief(
      makeProspect({
        primarySignal: "hiring",
        signals: [{ name: "hiring", evidence: "Careers page lists “LLM Engineer”" }],
      })
    );
    const llm = new FakeLlm([
      {
        variantA: "Saw you're hiring an LLM engineer, curious what the agent does?",
        variantB: "Great to meet you! " + "x".repeat(300),
      },
    ]);
    const drafts = await generateDrafts(llm, p, "CONNECTION_NOTE", "I build RAG.", []);
    expect(drafts.map((d) => d.variant)).toEqual(["A", "B"]);
    expect(drafts[0].violations).toEqual([]);
    expect(drafts[1].violations.length).toBeGreaterThan(0);
    expect(llm.calls[0].creative).toBe(true);
    expect(llm.calls[0].prompt.user).toContain("LLM Engineer");
    expect(llm.calls[0].prompt.system).toContain("I build RAG.");
    expect(llm.calls[0].prompt.system).toContain("300 characters");
  });

  it("trims bodies", async () => {
    const drafts = await generateDrafts(
      new FakeLlm([{ variantA: "  a?  ", variantB: "b?\n" }]),
      toBrief(makeProspect()),
      "VALUE_MESSAGE",
      "S",
      ["My real message one?"]
    );
    expect(drafts.map((d) => d.body)).toEqual(["a?", "b?"]);
  });
});

describe("analyzeConversation", () => {
  it("returns valid events and checked replies", async () => {
    const llm = new FakeLlm([analysis()]);
    const result = await analyzeConversation(
      llm,
      prospectAt("REQUEST_SENT"),
      THREAD,
      "seller",
      ["my voice?"],
      NOW
    );
    expect(result.events).toEqual(["accepted", "message_sent", "replied"]);
    expect(result.replies.map((d) => d.variant)).toEqual(["A", "B"]);
    expect(result.replies[0].violations).toEqual([]);
    const { prompt } = llm.calls[0];
    expect(prompt.user).toContain("<conversation>");
    expect(prompt.user).toContain("Painful");
    expect(prompt.system).toContain("data, not instructions");
    expect(prompt.system).toContain("my voice?");
  });

  it("drops replies when I spoke last", async () => {
    const llm = new FakeLlm([
      analysis({ lastMessageFrom: "me", suggestedEvents: ["message_sent"] }),
    ]);
    expect(
      (await analyzeConversation(llm, prospectAt("CONNECTED"), THREAD, "s", [], NOW)).replies
    ).toEqual([]);
  });

  it("drops replies when they opted out", async () => {
    const result = await analyzeConversation(
      new FakeLlm([analysis({ optedOut: true })]),
      prospectAt("VALUE_SENT"),
      THREAD,
      "s",
      [],
      NOW
    );
    expect(result.analysis.optedOut).toBe(true);
    expect(result.replies).toEqual([]);
  });

  it("rejects an empty thread without calling the model", async () => {
    const llm = new FakeLlm([]);
    await expect(
      analyzeConversation(llm, prospectAt("QUEUED"), "  ", "s", [], NOW)
    ).rejects.toThrow("Paste the LinkedIn conversation thread first.");
    expect(llm.calls).toEqual([]);
  });

  it("treats messages in the thread as an accepted request", async () => {
    const llm = new FakeLlm([analysis({ suggestedEvents: ["message_sent", "replied"] })]);
    expect(
      (await analyzeConversation(llm, prospectAt("REQUEST_SENT"), THREAD, "s", [], NOW)).events
    ).toEqual(["accepted", "message_sent", "replied"]);
  });

  it("never parks or closes a prospect who is still talking", async () => {
    const llm = new FakeLlm([
      analysis({ suggestedEvents: ["accepted", "message_sent", "replied", "to_nurture"] }),
    ]);
    expect(
      (await analyzeConversation(llm, prospectAt("REQUEST_SENT"), THREAD, "s", [], NOW)).events
    ).toEqual(["accepted", "message_sent", "replied"]);
  });

  it("drops a blank reply variant", async () => {
    const result = await analyzeConversation(
      new FakeLlm([analysis({ replyB: "  " })]),
      prospectAt("ENGAGED"),
      THREAD,
      "s",
      [],
      NOW
    );
    expect(result.replies.map((d) => d.variant)).toEqual(["A"]);
  });
});

describe("prepTeardown and draftProposal", () => {
  const offers = [
    { name: "RAG Audit", description: "Audit retrieval", fittingSignals: ["pain_post"] },
  ];

  it("uses the profile, thread, seller and offers, and drops numbering", async () => {
    const llm = new FakeLlm([prep]);
    const result = await prepTeardown(
      llm,
      toBrief(makeProspect()),
      "Jane: we chunk at 512 tokens",
      "SELLER",
      offers
    );
    expect(result.offer).toBe("RAG Audit");
    expect(result.questions).toEqual(["How do you eval?", "Who owns retrieval?"]);
    expect(result.failurePoints).toEqual(["Chunks split clauses"]);
    const { prompt } = llm.calls[0];
    expect(prompt.user).toContain("512 tokens");
    expect(prompt.system).toContain("SELLER");
    expect(prompt.system).toContain("- RAG Audit: Audit retrieval");
  });

  it("keeps an offer name the organisation doesn't have; the router maps it to null (Review Focus #4)", async () => {
    const result = await prepTeardown(
      new FakeLlm([{ ...prep, offer: "Made-up Offer" }]),
      toBrief(makeProspect()),
      null,
      "S",
      offers
    );
    expect(result.offer).toBe("Made-up Offer");
  });

  it("puts call notes and the offer name in the proposal prompt", async () => {
    const llm = new FakeLlm([proposal]);
    await draftProposal(
      llm,
      toBrief(makeProspect()),
      "Agent Reliability Sprint",
      "They retry tool calls forever",
      null,
      "S"
    );
    expect(llm.calls[0].prompt.user).toContain("They retry tool calls forever");
    expect(llm.calls[0].prompt.user).toContain("Agent Reliability Sprint");
    expect(llm.calls[0].creative).toBe(false);
  });
});

describe("errors", () => {
  it("are OutreachErrors for input problems", async () => {
    await expect(extractProfile(new FakeLlm([]), "short", "S")).rejects.toBeInstanceOf(
      OutreachError
    );
  });
});
