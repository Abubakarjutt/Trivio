import { describe, expect, it, vi } from "vitest";
import { enrichCompany, hiringPattern, websiteNamedIn } from "@/server/services/outreach/enrich";
import { DEFAULT_HIRING_KEYWORDS } from "@/server/services/outreach/types";
import { RefusedError, type FetchPage } from "@/server/services/outreach/website";

const HOME = '<html><a href="/careers">Careers</a> <a href="/docs">Docs</a> Book a demo</html>';
const CAREERS = "<html><h2>Open roles</h2><li>Senior LLM Engineer (Remote)</li></html>";
const KW = DEFAULT_HIRING_KEYWORDS;

function site(routes: Record<string, string | Error>): FetchPage {
  return vi.fn(async (url: string) => {
    const r = routes[new URL(url).pathname];
    if (r instanceof Error) throw r;
    return r === undefined ? { status: 404, url, body: "" } : { status: 200, url, body: r };
  });
}

describe("enrichCompany", () => {
  it("finds hiring and demo signals", async () => {
    const result = await enrichCompany("acme.ai", site({ "/": HOME, "/careers": CAREERS }), KW);
    expect(result.status).toBe("checked");
    expect(result.website).toBe("https://acme.ai");
    expect(new Set(result.signals.map((s) => s.name))).toEqual(new Set(["hiring", "demo_stage"]));
    expect(result.signals.find((s) => s.name === "hiring")!.evidence).toContain("LLM Engineer");
    expect(result.signals.find((s) => s.name === "demo_stage")!.evidence).toBe(
      "Website mentions “Docs”"
    );
  });

  it("is fine without a careers page", async () => {
    expect(await enrichCompany("https://acme.ai", site({ "/": "<html>Hello</html>" }), KW)).toEqual(
      { signals: [], status: "checked", website: "https://acme.ai" }
    );
  });

  it("reports an unreachable site", async () => {
    expect((await enrichCompany("acme.ai", site({ "/": new Error("timed out") }), KW)).status).toBe(
      "unreachable"
    );
  });

  it("treats a missing website as no_website", async () => {
    expect((await enrichCompany(null, site({}), KW)).status).toBe("no_website");
    expect((await enrichCompany("  ", site({}), KW)).status).toBe("no_website");
  });

  it("reports refused when the fetcher refuses", async () => {
    expect(
      (
        await enrichCompany(
          "https://www.linkedin.com/company/acme",
          site({ "/company/acme": new RefusedError("LinkedIn") }),
          KW
        )
      ).status
    ).toBe("refused");
  });

  it("checks at most 3 careers pages and skips LinkedIn links", async () => {
    const home =
      '<a href="https://www.linkedin.com/jobs/x">x</a><a href="/jobs/a">a</a><a href="/careers/b">b</a><a href="/careers/c">c</a>';
    const fetchPage = site({ "/": home });
    await enrichCompany("acme.ai", fetchPage, KW);
    const paths = (fetchPage as ReturnType<typeof vi.fn>).mock.calls.map(([u]) => u as string);
    expect(paths.some((u) => u.includes("linkedin"))).toBe(false);
    expect(paths.length).toBeLessThanOrEqual(1 + 3);
  });

  it("uses the organisation's own hiring keywords", async () => {
    const result = await enrichCompany(
      "acme.ai",
      site({ "/": "<html/>", "/careers": "<li>Data Platform Engineer</li>" }),
      ["data platform"]
    );
    expect(result.signals).toEqual([
      { name: "hiring", evidence: "Careers page lists “Data Platform Engineer”" },
    ]);
  });
});

describe("enrichCompany hardening", () => {
  it("strips a long run of '<' in linear time", async () => {
    const t0 = Date.now();
    const result = await enrichCompany("acme.ai", site({ "/": "<".repeat(200_000) }), KW);
    expect(result.status).toBe("checked");
    expect(Date.now() - t0).toBeLessThan(500);
  }, 20_000);

  it("ignores a malformed careers href instead of throwing", async () => {
    const result = await enrichCompany(
      "acme.ai",
      site({ "/": '<a href="http://[jobs">x</a>' }),
      KW
    );
    expect(result.status).toBe("checked");
  });
});

describe("hiringPattern", () => {
  it("escapes keywords and ignores blanks", () => {
    expect(hiringPattern(["c++", " "]).test("Senior C++ Developer")).toBe(true);
    expect(hiringPattern([]).test("AI Engineer")).toBe(false);
  });
});

describe("websiteNamedIn", () => {
  const paste = "Jane Doe, CTO. Reach me at jane@acme.ai or see Acme.ai.";

  it("returns the origin when the paste names the host", () => {
    expect(websiteNamedIn(paste, "https://acme.ai/pricing?x=1")).toBe("https://acme.ai");
    expect(websiteNamedIn(paste, "www.acme.ai")).toBe("https://www.acme.ai");
  });

  it("refuses hosts the paste never names", () => {
    expect(websiteNamedIn(paste, "notacme.ai")).toBeNull();
    expect(websiteNamedIn(paste, "acme.ai.collect.example")).toBeNull();
    expect(websiteNamedIn(paste, "collect.example")).toBeNull();
  });

  it("refuses non-web schemes, bare words and empty values", () => {
    expect(websiteNamedIn(paste + " ftp://acme.ai", "ftp://acme.ai")).toBeNull();
    expect(websiteNamedIn("acme", "acme")).toBeNull();
    expect(websiteNamedIn(paste, null)).toBeNull();
    expect(websiteNamedIn(paste, "  ")).toBeNull();
  });
});
