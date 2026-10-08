// Port of linkedin-outreach/outreach/urls.py: one key per person, whatever URL form was pasted.
import { OutreachError } from "./types";

const PROFILE_PATH = /^\/(in|sales\/lead|sales\/people)\/([^/]+)/i;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function normalizeProfileUrl(raw: string): string {
  const pasted = raw.trim();
  if (!pasted) throw new OutreachError("Paste the prospect's LinkedIn or Sales Navigator profile URL.");
  const withScheme = /^https?:\/\//i.test(pasted) ? pasted : `https://${pasted}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new OutreachError(`Not a LinkedIn URL: ${pasted}`);
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) {
    throw new OutreachError(`Not a LinkedIn URL: ${pasted}`);
  }
  const match = PROFILE_PATH.exec(url.pathname);
  if (!match) throw new OutreachError(`Not a profile URL (expected /in/… or /sales/lead/…): ${pasted}`);
  const kind = match[1].toLowerCase();
  let ident = match[2].split(",")[0];
  if (kind === "in") ident = safeDecode(ident).toLowerCase();
  return `https://www.linkedin.com/${kind}/${ident}`;
}
