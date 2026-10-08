import type { Signal } from "@/server/services/outreach/types";

// These mirror the limits on outreachProspects.create, so a long model value is cut here instead
// of failing Save with a raw zod message.
const NAME = 200;
const SHORT = 300;
const EVIDENCE = 500;
const STACK_ITEM = 80;
const STACK_MAX = 40;
const SIGNALS_MAX = 20;

const cut = (s: string, n: number) => [...s].slice(0, n).join("");

/** Fullwidth forms to ASCII ("１１～５０" to "11~50"), then drop leading punctuation and spaces. */
export function cleanCompanySize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/^[\s\p{P}]+/u, "")
    .trim();
}

export function clampExtracted(e: {
  name: string;
  title: string;
  company: string;
  companySize?: string | null;
  location?: string | null;
  stack: string[];
  signals: Signal[];
}) {
  return {
    name: cut(e.name, NAME),
    title: cut(e.title, SHORT),
    company: cut(e.company, SHORT),
    companySize: cut(cleanCompanySize(e.companySize ?? ""), SHORT),
    location: cut(e.location ?? "", SHORT),
    stack: e.stack.slice(0, STACK_MAX).map((s) => cut(s, STACK_ITEM)),
    signals: e.signals
      .slice(0, SIGNALS_MAX)
      .map((s) => ({ ...s, evidence: cut(s.evidence, EVIDENCE) })),
  };
}
