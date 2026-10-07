import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { parseSellerMarkdown, SEED_OFFERS, seedOutreach } from "@/server/services/outreach/seed";
import {
  DEFAULT_CADENCE,
  DEFAULT_HIRING_KEYWORDS,
  DEFAULT_WEIGHTS,
} from "@/server/services/outreach/types";
import { makeDb, NOW, type MockDb } from "./helpers";

const MD = `# Who I am
Freelance AI engineer. I build agents and RAG systems.

# Offer
Free 15-minute teardown. Never mention prices in a message.

# Voice examples (tone and length only — don't reuse their facts or claims)
- Saw your post on retrieval drift. What chunk size are you running?
- Your demo handles the happy path well. What happens when a tool call times out?

# Voice
Peer engineer, not consultant.
`;

describe("parseSellerMarkdown", () => {
  it("pulls the voice example bullets out of the profile", () => {
    const { profile, voiceExamples } = parseSellerMarkdown(MD);
    expect(voiceExamples).toEqual([
      "Saw your post on retrieval drift. What chunk size are you running?",
      "Your demo handles the happy path well. What happens when a tool call times out?",
    ]);
    expect(profile).not.toContain("Voice examples");
    expect(profile).not.toContain("retrieval drift");
    expect(profile).toContain("# Who I am");
    expect(profile).toContain("# Voice\nPeer engineer, not consultant.");
  });

  it("leaves a profile without a voice section unchanged", () => {
    expect(parseSellerMarkdown("# Who I am\nHi\n")).toEqual({
      profile: "# Who I am\nHi",
      voiceExamples: [],
    });
  });

  it("accepts any heading level and case, and * bullets", () => {
    const { voiceExamples, profile } = parseSellerMarkdown(
      "## voice EXAMPLES\n* one\n* two\n## Next\nkept"
    );
    expect(voiceExamples).toEqual(["one", "two"]);
    expect(profile).toBe("## Next\nkept");
  });

  it("handles nested bullets and indented continuation lines", () => {
    const { voiceExamples } = parseSellerMarkdown(
      "# Voice examples\n- a\n  - nested\n- multi\n  continued"
    );
    expect(voiceExamples).toEqual(["a\nnested", "multi\ncontinued"]);
  });

  it("strips the voice section at end-of-file from the profile", () => {
    const { profile, voiceExamples } = parseSellerMarkdown(
      "# Who I am\nText\n# Voice examples\n- example"
    );
    expect(profile).toBe("# Who I am\nText");
    expect(voiceExamples).toEqual(["example"]);
  });

  it("ends the voice section when encountering a higher-level heading", () => {
    const { profile, voiceExamples } = parseSellerMarkdown(
      "# A\nx\n## Voice examples\n- a\n- b\n# Next\nkept"
    );
    expect(voiceExamples).toEqual(["a", "b"]);
    expect(profile).toContain("# Next\nkept");
    expect(profile).not.toContain("Voice examples");
  });

  it("ends the voice section when encountering a lower-level heading", () => {
    const { profile, voiceExamples } = parseSellerMarkdown(
      "# A\nx\n## Voice examples\n- a\n- b\n### Sub\nkept"
    );
    expect(voiceExamples).toEqual(["a", "b"]);
    expect(profile).toContain("### Sub\nkept");
    expect(profile).not.toContain("Voice examples");
  });

  it("parses CRLF the same as LF", () => {
    const lfResult = parseSellerMarkdown("# Voice examples\n- a\n- b\n# Next");
    const crlfResult = parseSellerMarkdown("# Voice examples\r\n- a\r\n- b\r\n# Next");
    expect(crlfResult).toEqual(lfResult);
  });

  it("drops unindented non-bullet lines inside the voice section", () => {
    const { voiceExamples, profile } = parseSellerMarkdown(
      "## Voice examples\nHere are messages I actually sent:\n- one\n- two\n## Next"
    );
    expect(voiceExamples).toEqual(["one", "two"]);
    expect(profile).not.toContain("Here are messages");
    expect(profile).not.toContain("- one");
    expect(profile).not.toContain("- two");
    expect(profile).toContain("## Next");
  });
});

describe("seedOutreach", () => {
  let db: MockDb;
  beforeEach(() => {
    db = makeDb();
  });

  it("creates settings with defaults, both offers without a price, and seed voice examples", async () => {
    db.outreachSettings.findUnique.mockResolvedValue(null);
    const out = await seedOutreach(db as unknown as PrismaClient, "org-1", MD, NOW);
    expect(out).toEqual({ settings: "created", offersCreated: 2, examplesCreated: 2 });
    const upsert = db.outreachSettings.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ organisationId: "org-1" });
    expect(upsert.create).toMatchObject({
      organisationId: "org-1",
      signalWeights: DEFAULT_WEIGHTS,
      cadence: DEFAULT_CADENCE,
      dailyCap: 20,
      weeklyCap: 100,
      hiringKeywords: DEFAULT_HIRING_KEYWORDS,
    });
    expect(upsert.update).toEqual({ sellerProfile: upsert.create.sellerProfile });
    expect(db.outreachOffer.create.mock.calls.map((c) => c[0].data)).toEqual(
      SEED_OFFERS.map((o) => ({ organisationId: "org-1", ...o, price: null }))
    );
    expect(db.outreachVoiceExample.create.mock.calls[0][0].data).toEqual({
      organisationId: "org-1",
      prospectId: null,
      kind: "seed",
      body: "Saw your post on retrieval drift. What chunk size are you running?",
      createdAt: NOW,
    });
  });

  it("can run again without duplicating offers or examples", async () => {
    db.outreachSettings.findUnique.mockResolvedValue({ id: "s1" });
    db.outreachOffer.findFirst.mockResolvedValue({ id: "o1" });
    db.outreachVoiceExample.findFirst.mockResolvedValue({ id: "v1" });
    const out = await seedOutreach(db as unknown as PrismaClient, "org-1", MD, NOW);
    expect(out).toEqual({ settings: "updated", offersCreated: 0, examplesCreated: 0 });
    expect(db.outreachOffer.create).not.toHaveBeenCalled();
    expect(db.outreachVoiceExample.create).not.toHaveBeenCalled();
    expect(db.outreachOffer.findFirst).toHaveBeenCalledWith({
      where: { organisationId: "org-1", name: SEED_OFFERS[0].name },
    });
  });

  it("refuses a file with no profile text", async () => {
    await expect(
      seedOutreach(db as unknown as PrismaClient, "org-1", "# Voice examples\n- a\n", NOW)
    ).rejects.toThrow("seller.md has no profile text");
  });

  it("dedupes examples by organisationId and body", async () => {
    db.outreachSettings.findUnique.mockResolvedValue(null);
    db.outreachVoiceExample.findFirst.mockResolvedValue(null);
    await seedOutreach(db as unknown as PrismaClient, "org-1", MD, NOW);
    expect(db.outreachVoiceExample.findFirst).toHaveBeenCalledWith({
      where: {
        organisationId: "org-1",
        body: "Saw your post on retrieval drift. What chunk size are you running?",
      },
    });
  });
});
