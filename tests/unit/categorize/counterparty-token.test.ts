import { describe, expect, it } from "vitest";
import {
  candidateRuleKeys,
  extractRuleKey,
  findTokens,
  hasCounterpartyToken,
  normaliseMerchant,
  tokenizeCounterparties,
} from "@/server/services/categorize/counterparty-token";
import { redactPiiText } from "@/server/services/pii-redaction.service";

const S = "a".repeat(64);
const tok = (t: string) => tokenizeCounterparties(t, S);

describe("tokenizeCounterparties", () => {
  it("gives one token for the same PK mobile in every format", () => {
    const forms = [
      "0300-1234567",
      "03001234567",
      "+92 300 1234567",
      "923001234567",
      "+923001234567",
    ];
    const tokens = forms.map((f) => findTokens(tok(`Raast to ${f} done`))[0]);
    expect(tokens[0]).toMatch(/^\[PHONE ••4567 #[0-9a-f]{12}\]$/);
    expect(new Set(tokens).size).toBe(1);
  });

  it("gives different numbers different tokens and never keeps the digits", () => {
    const a = tok("IBFT to 03001234567");
    const b = tok("IBFT to 03217654321");
    expect(findTokens(a)[0]).not.toBe(findTokens(b)[0]);
    expect(a).not.toContain("1234567");
    expect(a).not.toContain("0300");
  });

  it("depends on the secret", () => {
    expect(findTokens(tokenizeCounterparties("to 03001234567", "b".repeat(64)))[0]).not.toBe(
      findTokens(tok("to 03001234567"))[0]
    );
  });

  it("tokenizes IBANs and labelled account numbers as ACCT, keeping the label", () => {
    expect(tok("sent to PK36SCBL0000001123456702")).toMatch(
      /sent to \[ACCT ••6702 #[0-9a-f]{12}\]/
    );
    expect(tok("Transfer to A/C No. 1234-5678-9012")).toMatch(
      /A\/C No\. \[ACCT ••9012 #[0-9a-f]{12}\]/
    );
  });

  it("leaves card numbers and masked accounts alone", () => {
    expect(tok("Card 4111 1111 1111 1111 used")).toBe("Card 4111 1111 1111 1111 used");
    expect(tok("A/C ****1234 debited")).toBe("A/C ****1234 debited");
  });

  it("rejects bogus IBAN-like patterns and non-label words before account numbers", () => {
    expect(tok("TX12 DEBIT CARD PURCHASE at DARAZ")).toBe("TX12 DEBIT CARD PURCHASE at DARAZ");
    expect(tok("Ref AB12 PAYMENT RECEIVED FROM ALI")).toBe("Ref AB12 PAYMENT RECEIVED FROM ALI");
    expect(tok("success12345678910111213")).toBe("success12345678910111213");
  });

  it("is idempotent, even when a hash is all digits, and tokens survive redactPiiText", () => {
    const once = tok("Raast to 03001234567");
    expect(tok(once)).toBe(once);
    expect(tok("[PHONE ••4567 #a03001234567]")).toBe("[PHONE ••4567 #a03001234567]");
    expect(redactPiiText(once)).toBe(once);
  });
});

describe("rule keys", () => {
  const t = findTokens(tok("to 03001234567"))[0]!;
  const hash = t.match(/#([0-9a-f]{12})/)![1];

  it("prefers the counterparty token over the merchant", () => {
    expect(extractRuleKey(`Raast ${t}`, "Raast")).toEqual({
      kind: "COUNTERPARTY",
      matchKey: hash,
      label: "Transfers to ••4567",
    });
    expect(candidateRuleKeys(`Raast ${t}`, "Raast").map((k) => k.kind)).toEqual([
      "COUNTERPARTY",
      "MERCHANT",
    ]);
  });

  it("uses the hint when the description has no token", () => {
    expect(extractRuleKey("Raast transfer", "Raast", t)).toMatchObject({
      kind: "COUNTERPARTY",
      matchKey: hash,
    });
  });

  it("labels ACCT tokens as account transfers", () => {
    const a = findTokens(tok("to PK36SCBL0000001123456702"))[0]!;
    expect(extractRuleKey(a, "")?.label).toBe("Transfers to account ••6702");
  });

  it("falls back to the normalised merchant name", () => {
    expect(extractRuleKey("POS DARAZ PK", "  Daraz   Online ")).toEqual({
      kind: "MERCHANT",
      matchKey: "daraz online",
      label: "Daraz Online",
    });
    expect(normaliseMerchant("  KFC   DHA ")).toBe("kfc dha");
  });

  it("returns null with neither token nor merchant", () => {
    expect(extractRuleKey("x", "  ")).toBeNull();
    expect(hasCounterpartyToken("plain text")).toBe(false);
    expect(hasCounterpartyToken(t)).toBe(true);
  });
});
