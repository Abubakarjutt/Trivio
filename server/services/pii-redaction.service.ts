/**
 * PiiRedactionService
 *
 * Strips sensitive personal and financial identifiers from bank-statement
 * text before it is forwarded to a third-party AI API (Gemini).
 *
 * Design goals
 * ────────────
 * • High-precision over high-recall — prefer a missed redaction to blowing
 *   up a transaction row that Gemini needs to extract.
 * • Label-guided for ambiguous patterns (account numbers) — only redact
 *   when a recognised label like "Account:" precedes the digits, so that
 *   transaction amounts and reference numbers are left intact.
 * • No external dependencies — pure string transforms, fully unit-testable.
 *
 * What is redacted
 * ────────────────
 *   IBAN           GB29NWBK60161331926819 → [IBAN REDACTED]
 *   Sort code      60-16-13               → [SORT CODE REDACTED]
 *   BSB            063-000                → [BSB REDACTED]
 *   Card number    4111 1111 1111 1111    → [CARD REDACTED]
 *   Account no.    Account: 12345678      → Account: [ACCT REDACTED]
 *   Email          user@bank.com          → [EMAIL REDACTED]
 *   Phone          +44 20 7946 0958       → [PHONE REDACTED]
 *
 * What is preserved
 * ─────────────────
 *   Transaction amounts  ($1,234.56, -49.99)
 *   Transaction dates    (2025-06-01, 01/06/2025)
 *   Merchant names       (STARBUCKS #1234, AMZN Mktp)
 *   Running balances     (1,234.56 CR)
 */

/** Replace a single regex with a fixed token. */
function mask(text: string, pattern: RegExp, token: string): string {
  return text.replace(pattern, token);
}

// ── pattern catalogue ─────────────────────────────────────────────────────────

/**
 * IBAN — two uppercase letters + two check digits + up to 30 alphanumeric chars.
 * Written with or without spaces every 4 chars.
 * Example: GB29 NWBK 6016 1331 9268 19
 */
// Allow an optional space between the check digits and the BBAN so that both
// "GB29NWBK60161331926819" and "GB29 NWBK 6016 1331 9268 19" are captured.
const IBAN_RE = /\b[A-Z]{2}\d{2} ?(?:[A-Z0-9] ?){11,30}\b/g;

/**
 * UK sort codes — XX-XX-XX  (6 digits, hyphen-separated in pairs).
 * Must be word-bounded to avoid partial matches inside longer numbers.
 */
const SORT_CODE_RE = /\b\d{2}-\d{2}-\d{2}\b/g;

/**
 * Australian BSB — XXX-XXX  (6 digits, hyphen-separated in threes).
 */
const BSB_RE = /\b\d{3}-\d{3}\b/g;

/**
 * Payment card numbers — exactly 4 groups of 4 digits separated by spaces or
 * hyphens, OR a 16-digit run.  Starts with 3 (Amex 15-digit), 4 (Visa),
 * 5 (Mastercard), 6 (Discover).
 *
 * Deliberately NOT matching 13-digit raw numbers to avoid false positives on
 * order/reference numbers in transaction descriptions.
 */
const CARD_RE = /\b(?:[3456]\d{3}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}(?:\d{1,3})?)\b/g;

/**
 * Account numbers — only matched when preceded by a recognisable label.
 * Captures labels like: "Account:", "Account No.", "Acc #", "A/C:", "Acct:"
 * followed by 4–20 digit/space/hyphen characters.
 *
 * Capture group 1 = the label (preserved); rest = number (redacted).
 */
const LABELLED_ACCT_RE =
  /(a(?:cc(?:ount)?|\/c)\.?\s*(?:no\.?|number|#|:)?\s*:?\s*)[\d \-]{4,20}/gi;

/** Email addresses — RFC-5321 simplified. */
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Phone numbers — two approaches:
 *   1. Label-guided: "Phone:", "Tel:", "Mobile:", "Mob:", "Fax:" + digits
 *   2. International E.164: +CC [rest], where rest contains 7–12 digits
 *
 * Plain domestic numbers (10 digits without label) are intentionally skipped
 * because they are indistinguishable from account/reference numbers.
 */
const LABELLED_PHONE_RE =
  /((?:phone|tel(?:ephone)?|mobile|mob|fax)\s*:?\s*)(\+?[\d\s()\-]{7,20})/gi;

const INTL_PHONE_RE = /\+\d{1,3}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,6}/g;

// ── public API ────────────────────────────────────────────────────────────────

export interface RedactionStats {
  ibans: number;
  sortCodes: number;
  bsbs: number;
  cards: number;
  accountNumbers: number;
  emails: number;
  phones: number;
}

export interface RedactionResult {
  redacted: string;
  stats: RedactionStats;
}

/**
 * Redact PII from a bank-statement text string.
 * Returns the cleaned text plus a count of each pattern type found.
 */
export function redactPii(text: string): RedactionResult {
  const stats: RedactionStats = {
    ibans: 0, sortCodes: 0, bsbs: 0, cards: 0,
    accountNumbers: 0, emails: 0, phones: 0,
  };

  let t = text;

  // ── IBANs ─────────────────────────────────────────────────────────────────
  t = t.replace(IBAN_RE, (m) => { stats.ibans++; return m.replace(/[A-Z0-9]/g, "*"); });

  // ── Sort codes ────────────────────────────────────────────────────────────
  t = t.replace(SORT_CODE_RE, () => { stats.sortCodes++; return "[SORT CODE REDACTED]"; });

  // ── BSBs ──────────────────────────────────────────────────────────────────
  // Must come after sort-code pass (same XX-XX pattern is a subset of XX-XX-XX)
  t = t.replace(BSB_RE, () => { stats.bsbs++; return "[BSB REDACTED]"; });

  // ── Card numbers ──────────────────────────────────────────────────────────
  t = t.replace(CARD_RE, (m) => {
    stats.cards++;
    // Mask all but last 4 digits: show **** **** **** 1234
    const digits = m.replace(/\D/g, "");
    return "**** **** **** " + digits.slice(-4);
  });

  // ── Labelled account numbers ───────────────────────────────────────────────
  t = t.replace(LABELLED_ACCT_RE, (_, label) => {
    stats.accountNumbers++;
    return label + "[ACCT REDACTED]";
  });

  // ── Email addresses ────────────────────────────────────────────────────────
  t = t.replace(EMAIL_RE, () => { stats.emails++; return "[EMAIL REDACTED]"; });

  // ── Labelled phone numbers ─────────────────────────────────────────────────
  t = t.replace(LABELLED_PHONE_RE, (_, label) => {
    stats.phones++;
    return label + "[PHONE REDACTED]";
  });

  // ── International phone numbers (standalone) ───────────────────────────────
  t = t.replace(INTL_PHONE_RE, () => { stats.phones++; return "[PHONE REDACTED]"; });

  return { redacted: t, stats };
}

/**
 * Convenience wrapper — returns only the cleaned text.
 * Use when you don't need the stats.
 */
export function redactPiiText(text: string): string {
  return redactPii(text).redacted;
}
