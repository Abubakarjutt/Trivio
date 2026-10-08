// Port of linkedin-outreach/outreach/rules.py. Messages are kept word for word.
import type { DraftKind } from "./types";

export const BANNED = [
  "hope this finds you well", "hope this message finds you", "came across your profile",
  "synergy", "quick call", "pick your brain", "touch base",
] as const;
const URL_RE = /https?:\/\/\S+|\bwww\.\S+/gi;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function checkDraft(kind: DraftKind, text: string): string[] {
  const problems: string[] = [];
  const lowered = text.toLowerCase();
  for (const phrase of BANNED) if (lowered.includes(phrase)) problems.push(`Banned phrase: "${phrase}"`);
  if (text.includes("!")) problems.push("Contains an exclamation mark");
  if (EMOJI.test(text)) problems.push("Contains an emoji");
  if (text.includes("$")) problems.push("Mentions a price");

  const links = text.match(URL_RE)?.length ?? 0;
  if (kind === "CONNECTION_NOTE") {
    const chars = [...text].length;
    if (chars > 300) problems.push(`${chars} characters (LinkedIn's limit is 300)`);
    if (links) problems.push("Connection notes shouldn't include a link");
  } else if (kind === "REPLY") {
    const words = wordCount(text);
    if (words > 100) problems.push(`${words} words (limit is 100 words)`);
    if (links > 1) problems.push(`${links} links (limit is 1 link)`);
  } else {
    const words = wordCount(text);
    if (words > 80) problems.push(`${words} words (limit is 80 words)`);
    if (links > 1) problems.push(`${links} links (limit is 1 link)`);
    if (!text.trimEnd().endsWith("?")) problems.push("Should end with a question");
  }
  return problems;
}
