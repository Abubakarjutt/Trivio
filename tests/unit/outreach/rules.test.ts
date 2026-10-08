import { describe, expect, it } from "vitest";
import { checkDraft } from "@/server/services/outreach/rules";

const CLEAN_NOTE = "Saw Acme is hiring an LLM engineer. I build retrieval evals for agent teams and would like to follow your work.";
const CLEAN_VALUE =
  "Thanks for connecting. Your careers page mentions agent reliability. I open-sourced the eval " +
  "harness I use for that: https://github.com/me/agent-evals. How are you testing tool-call failures today?";

describe("checkDraft", () => {
  it("passes clean drafts", () => {
    expect(checkDraft("CONNECTION_NOTE", CLEAN_NOTE)).toEqual([]);
    expect(checkDraft("VALUE_MESSAGE", CLEAN_VALUE)).toEqual([]);
  });

  it("flags a note over 300 characters", () => {
    expect(checkDraft("CONNECTION_NOTE", "a".repeat(301)).some((v) => v.includes("300"))).toBe(true);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(checkDraft("CONNECTION_NOTE", "é".repeat(300))).toEqual([]);
  });

  it("flags a note with a link", () => {
    expect(checkDraft("CONNECTION_NOTE", `${CLEAN_NOTE} https://x.io`).some((v) => v.includes("link"))).toBe(true);
  });

  it("applies value message rules", () => {
    expect(checkDraft("VALUE_MESSAGE", `${Array(81).fill("word").join(" ")}?`).some((v) => v.includes("80 words"))).toBe(true);
    expect(checkDraft("VALUE_MESSAGE", "No question here.").some((v) => v.includes("question"))).toBe(true);
    expect(checkDraft("VALUE_MESSAGE", "See https://a.io and https://b.io?").some((v) => v.includes("1 link"))).toBe(true);
  });

  it("matches banned phrases case-insensitively", () => {
    const v = checkDraft("CONNECTION_NOTE", "Hope this finds you well. Quick call?");
    expect(v.some((x) => x.includes("hope this finds you well"))).toBe(true);
    expect(v.some((x) => x.includes("quick call"))).toBe(true);
  });

  it("flags exclamation, emoji and price", () => {
    expect(checkDraft("CONNECTION_NOTE", "Love it! 🚀 Pilots from $2k")).toHaveLength(3);
  });

  it("applies reply rules", () => {
    expect(checkDraft("REPLY", "Happy to look. Tuesday works, want me to send a calendar link?")).toEqual([]);
    expect(checkDraft("REPLY", Array(101).fill("word").join(" ")).some((v) => v.includes("100 words"))).toBe(true);
    expect(checkDraft("REPLY", "See https://a.io and https://b.io").some((v) => v.includes("1 link"))).toBe(true);
    expect(checkDraft("REPLY", "Let's touch base.").some((v) => v.includes("Banned"))).toBe(true);
  });
});
