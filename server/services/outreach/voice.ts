// Port of linkedin-outreach/outreach/voice.py (anonymising). Storage lives in prospects.ts.
// Mark-done events whose "what you actually sent" text becomes a voice example.
export const VOICE_EVENTS = ["request_sent", "message_sent", "light_touch"] as const;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace the prospect's name (and each part of it) with "X". Unicode-aware, unlike \b. */
export function anonymize(text: string, name: string): string {
  const trimmed = name.normalize("NFC").trim();
  const words = trimmed.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
  const pieces = trimmed.split(/[\s\-\u2010,.()]+/u);
  // Whole name, each word (so "Mary-Jane" goes as one), and each piece (so a bare "Mary" does too).
  const parts = [trimmed, ...words, ...pieces].filter(
    (p) => (p.match(/\p{L}/gu) ?? []).length >= 2
  );
  const unique = [...new Set(parts)].sort((a, b) => b.length - a.length);
  let out = text.normalize("NFC");
  for (const part of unique) {
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(part)}(?![\\p{L}\\p{N}_])`, "giu"),
      "X"
    );
  }
  return out;
}
