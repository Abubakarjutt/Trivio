// Port of linkedin-outreach/outreach/voice.py (anonymising). Storage lives in prospects.ts.
// Mark-done events whose "what you actually sent" text becomes a voice example.
export const VOICE_EVENTS = ["request_sent", "message_sent", "light_touch"] as const;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace the prospect's name (and each part of it) with "X". Unicode-aware, unlike \b. */
export function anonymize(text: string, name: string): string {
  const trimmed = name.trim();
  const parts = [trimmed, ...trimmed.split(/\s+/)].filter((p) => [...p].length > 1);
  const unique = [...new Set(parts)].sort((a, b) => b.length - a.length);
  let out = text;
  for (const part of unique) {
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(part)}(?![\\p{L}\\p{N}_])`, "giu"),
      "X"
    );
  }
  return out;
}
