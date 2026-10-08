// Port of linkedin-outreach/outreach/enrich.py. The hiring keywords come from the organisation.
import type { Signal } from "./types";
import { isLinkedInHost, RefusedError, type FetchPage } from "./website";

export type EnrichmentStatus = "checked" | "unreachable" | "no_website" | "refused";

const DEMO =
  /\b(book a demo|request a demo|try it free|join the waitlist|waitlist|api reference|documentation|docs)\b/i;
const CAREERS_LINK = /href="([^"]*(?:careers|jobs|greenhouse\.io|lever\.co|ashbyhq\.com)[^"]*)"/gi;
const TAGS = /<[^<>]*>/g;
const MAX_CAREER_PAGES = 3;
const NEVER = /(?!)/;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function hiringPattern(keywords: string[]): RegExp {
  const kws = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .map(escapeRegExp);
  if (kws.length === 0) return NEVER;
  // \b before the keyword fails for keywords that start with a symbol, so use a lookbehind instead.
  return new RegExp(
    `(?<![\\w])(?:senior |staff |lead )?(?:${kws.join("|")})s?[\\w /-]{0,30}?\\b(?:engineer|developer|scientist)s?\\b`,
    "i"
  );
}

const text = (html: string) => html.replace(TAGS, " ").replace(/\s+/g, " ");

async function get(fetchPage: FetchPage, url: string): Promise<string | null> {
  try {
    const page = await fetchPage(url);
    return page.status === 200 ? page.body : null;
  } catch (e) {
    if (e instanceof RefusedError) throw e;
    return null;
  }
}

export async function enrichCompany(
  website: string | null,
  fetchPage: FetchPage,
  hiringKeywords: string[]
): Promise<{ signals: Signal[]; status: EnrichmentStatus; website: string | null }> {
  if (!website || !website.trim()) return { signals: [], status: "no_website", website: null };
  let url = website.trim();
  if (!url.includes("://")) url = `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { signals: [], status: "refused", website: url };
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    isLinkedInHost(parsed.hostname)
  ) {
    return { signals: [], status: "refused", website: url };
  }

  let home: string | null;
  try {
    home = await get(fetchPage, url);
  } catch {
    return { signals: [], status: "refused", website: url };
  }
  if (home === null) return { signals: [], status: "unreachable", website: url };

  const signals: Signal[] = [];
  const demo = DEMO.exec(text(home));
  if (demo) signals.push({ name: "demo_stage", evidence: `Website mentions “${demo[0]}”` });

  const links = [...home.matchAll(CAREERS_LINK)].flatMap((m) => {
    try {
      return [new URL(m[1], url).toString()];
    } catch {
      return []; // a malformed href is skipped, as Python's urljoin never raises
    }
  });
  const candidates = [
    ...new Set([...links, new URL("/careers", url).toString(), new URL("/jobs", url).toString()]),
  ].filter((u) => !isLinkedInHost(new URL(u).hostname));
  const hiring = hiringPattern(hiringKeywords);
  for (const pageUrl of candidates.slice(0, MAX_CAREER_PAGES)) {
    let page: string | null = null;
    try {
      page = await get(fetchPage, pageUrl);
    } catch {
      continue; // a refused careers link doesn't spoil the home page result
    }
    const m = page ? hiring.exec(text(page)) : null;
    if (m) {
      signals.push({ name: "hiring", evidence: `Careers page lists “${m[0].trim()}”` });
      break;
    }
  }
  return { signals, status: "checked", website: url };
}
