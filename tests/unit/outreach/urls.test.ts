import { describe, expect, it } from "vitest";
import { normalizeProfileUrl } from "@/server/services/outreach/urls";
import { OutreachError } from "@/server/services/outreach/types";

describe("normalizeProfileUrl", () => {
  it.each([
    "https://www.linkedin.com/in/Jane-Doe/",
    "linkedin.com/in/jane-doe",
    "https://pk.linkedin.com/in/jane-doe?miniProfileUrn=abc#x",
    "  http://www.LinkedIn.com/in/jane-doe/details/experience/  ",
  ])("normalizes %s to one key", (raw) => {
    expect(normalizeProfileUrl(raw)).toBe("https://www.linkedin.com/in/jane-doe");
  });

  it("keeps only the lead id of a Sales Navigator URL", () => {
    expect(
      normalizeProfileUrl(
        "https://www.linkedin.com/sales/lead/ACwAAAB12cd,NAME_SEARCH,xYz1?_ntb=abc"
      )
    ).toBe("https://www.linkedin.com/sales/lead/ACwAAAB12cd");
  });

  it.each([
    "",
    "https://example.com/in/jane",
    "https://www.linkedin.com/company/acme",
    "https://evil.com/?x=linkedin.com/in/a",
  ])("rejects %j", (raw) => {
    expect(() => normalizeProfileUrl(raw)).toThrow(OutreachError);
  });

  it("does not throw on a malformed percent escape", () => {
    expect(normalizeProfileUrl("https://www.linkedin.com/in/jane%E0")).toBe(
      "https://www.linkedin.com/in/jane%e0"
    );
  });
});
