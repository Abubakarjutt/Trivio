import { describe, expect, it } from "vitest";
import { SignalSchema, SignalsSchema } from "@/server/services/outreach/types";

describe("SignalSchema.source", () => {
  it("keeps an http(s) source", () => {
    const s = SignalSchema.parse({
      name: "funding",
      evidence: "Raised a $4M seed",
      source: "https://techcrunch.com/acme",
    });
    expect(s.source).toBe("https://techcrunch.com/acme");
  });

  it("still accepts signals saved before sources existed", () => {
    expect(SignalsSchema.parse([{ name: "hiring", evidence: "Hiring ML engineers" }])).toEqual([
      { name: "hiring", evidence: "Hiring ML engineers" },
    ]);
  });

  it("refuses a source that isn't a web link", () => {
    for (const source of ["javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
      expect(SignalSchema.safeParse({ name: "funding", evidence: "x", source }).success).toBe(
        false
      );
    }
  });
});
