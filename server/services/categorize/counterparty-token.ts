// Replaces counterparty phone/account numbers with a stable private token
// ("[PHONE ••4567 #0a1b2c3d4e5f]") before import text is redacted or sent to
// the AI. The hash is keyed with a per-organisation secret, so the same number
// always gives the same token here and a meaningless one anywhere else — which
// lets category rules match a counterparty without storing the number.
import { createHmac } from "node:crypto";

export type RuleKind = "COUNTERPARTY" | "MERCHANT";
export interface RuleKey {
  kind: RuleKind;
  matchKey: string;
  label: string;
}

const TOKEN_RE = /\[(PHONE|ACCT) ••(\d{4}) #([0-9a-f]{12})\]/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4})*\s?[A-Z0-9]{1,4}(?=\s|$|\b)/g;
const LABELLED_ACCT_RE =
  /\b(a(?:cc(?:ount)?|\/c)\.?\s*(?:no\.?|number|#|:)?\s*:?\s*)(\d[\d -]{2,18}\d)/gi;
const LABELLED_PHONE_RE = /((?:phone|tel(?:ephone)?|mobile|mob)\s*:?\s*)(\+?\d[\d\s()-]{6,18}\d)/gi;
// Pakistani mobiles: 03XX-XXXXXXX, +92 3XX XXXXXXX, 923XXXXXXXXX. Not inside a
// longer number or word (e.g. an existing token's hex hash).
const PK_MOBILE_RE = /(?<![\w+#])(?:\+?92[\s-]?|0)3\d{2}[\s-]?\d{7}(?!\w)/g;
const INTL_PHONE_RE = /\+\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,6}/g;
// A masked number ("0123XXXX4567", "****1234") is the user's own account as the
// bank prints it; so is anything labelled "your A/C" / "your account".
const MASK_AFTER_RE = /^[\s-]*[Xx*•]/;
const MASK_BEFORE_RE = /[Xx*•][\s-]*$/;
const OWN_ACCT_LABEL_RE = /\byour\s+$/i;

function normaliseNumber(raw: string): string {
  let n = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (/^03\d{9}$/.test(n)) n = `92${n.slice(1)}`;
  return n;
}

function makeToken(kind: "PHONE" | "ACCT", raw: string, secret: string): string {
  const n = normaliseNumber(raw);
  const hash = createHmac("sha256", secret).update(n).digest("hex").slice(0, 12);
  return `[${kind} ••${n.slice(-4)} #${hash}]`;
}

export function tokenizeCounterparties(text: string, secret: string): string {
  return text
    .replace(IBAN_RE, (m) => {
      const n = normaliseNumber(m);
      // Validate IBAN: must have at least 8 digits and end with 4 digits
      const digitCount = (n.match(/\d/g) || []).length;
      if (digitCount >= 8 && /\d{4}$/.test(n)) {
        return makeToken("ACCT", m, secret);
      }
      return m;
    })
    .replace(
      LABELLED_ACCT_RE,
      (m: string, label: string, num: string, offset: number, whole: string) => {
        const before = whole.slice(0, offset);
        const after = whole.slice(offset + m.length);
        if (
          OWN_ACCT_LABEL_RE.test(before) ||
          MASK_AFTER_RE.test(after) ||
          MASK_BEFORE_RE.test(before + label)
        ) {
          return m;
        }
        return label + makeToken("ACCT", num, secret);
      }
    )
    .replace(
      LABELLED_PHONE_RE,
      (_, label: string, num: string) => label + makeToken("PHONE", num, secret)
    )
    .replace(PK_MOBILE_RE, (m) => makeToken("PHONE", m, secret))
    .replace(INTL_PHONE_RE, (m) => makeToken("PHONE", m, secret));
}

export function findTokens(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[0]);
}

/** The counterparty to key on: a phone (who the money went to) beats an account number. */
export function pickToken(tokens: string[]): string | undefined {
  return tokens.find((t) => t.startsWith("[PHONE ")) ?? tokens[0];
}

export function hasCounterpartyToken(text: string): boolean {
  return findTokens(text).length > 0;
}

export function normaliseMerchant(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenKey(token: string): RuleKey | null {
  const m = new RegExp(TOKEN_RE.source).exec(token);
  if (!m) return null;
  const label = m[1] === "PHONE" ? `Transfers to ••${m[2]}` : `Transfers to account ••${m[2]}`;
  return { kind: "COUNTERPARTY", matchKey: m[3]!, label };
}

export function candidateRuleKeys(
  description: string,
  merchantName: string,
  hint?: string | null
): RuleKey[] {
  const keys: RuleKey[] = [];
  const token = pickToken(findTokens(description)) ?? (hint ? pickToken(findTokens(hint)) : undefined);
  const cp = token ? tokenKey(token) : null;
  if (cp) keys.push(cp);
  const m = normaliseMerchant(merchantName);
  if (m)
    keys.push({ kind: "MERCHANT", matchKey: m, label: merchantName.trim().replace(/\s+/g, " ") });
  return keys;
}

export function extractRuleKey(
  description: string,
  merchantName: string,
  hint?: string | null
): RuleKey | null {
  return candidateRuleKeys(description, merchantName, hint)[0] ?? null;
}
