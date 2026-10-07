import { describe, expect, it } from "vitest";
import { cleanCompanySize, clampExtracted } from "@/app/(app)/outreach/_components/extract-limits";

describe("cleanCompanySize", () => {
  it("normalises fullwidth characters and leading punctuation", () => {
    expect(cleanCompanySize("：１１～５０ employees")).toBe("11~50 employees");
    expect(cleanCompanySize("  - 51-200")).toBe("51-200");
    expect(cleanCompanySize("200")).toBe("200");
  });
});

describe("clampExtracted", () => {
  const base = { name: "A", title: "T", company: "C", stack: [], signals: [] };
  it("cuts values to the create limits", () => {
    const out = clampExtracted({
      ...base,
      name: "n".repeat(250),
      title: "t".repeat(400),
      company: "c".repeat(400),
      stack: ["s".repeat(100), "ok"],
      signals: [{ name: "hiring", evidence: "e".repeat(600) } as never],
    });
    expect(out.name).toHaveLength(200);
    expect(out.title).toHaveLength(300);
    expect(out.company).toHaveLength(300);
    expect(out.stack[0]).toHaveLength(80);
    expect(out.stack[1]).toBe("ok");
    expect(out.signals[0].evidence).toHaveLength(500);
  });
  it("leaves short values alone and defaults the optional ones", () => {
    expect(clampExtracted(base)).toMatchObject({ companySize: "", location: "", stack: [] });
  });
  it("caps the lists", () => {
    const out = clampExtracted({ ...base, stack: Array.from({ length: 50 }, (_, i) => `s${i}`) });
    expect(out.stack).toHaveLength(40);
  });
});
