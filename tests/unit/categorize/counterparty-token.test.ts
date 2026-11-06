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

  it("never tokenizes the user's own (masked or 'your') account number", () => {
    const masked = "PKR 2,450.00 debited from your A/C 0123XXXX4567 at IMTIAZ";
    expect(tok(masked)).toBe(masked);
    expect(tok("A/C 0123XXXX4567 debited at IMTIAZ")).toBe("A/C 0123XXXX4567 debited at IMTIAZ");
    expect(tok("A/C 0123-****-4567 debited")).toBe("A/C 0123-****-4567 debited");
    const own = "Dear customer, your account 01234567890123 has been credited with PKR 500";
    expect(tok(own)).toBe(own);
    expect(tok("Your A/C No. 1234-5678-9012 was debited")).toBe("Your A/C No. 1234-5678-9012 was debited");
    for (const t of [masked, own]) {
      expect(findTokens(tok(t))).toEqual([]);
      expect(candidateRuleKeys(tok(t), "", null, "DEBIT").filter((k) => k.kind === "COUNTERPARTY")).toEqual([]);
    }
  });

  it("keys a transfer from the user's own account on the recipient's phone", () => {
    const t = tok("Rs 5,000 sent from your A/C 0123XXXX4567 to 0300-1234567 via Raast");
    expect(findTokens(t)).toHaveLength(1);
    expect(extractRuleKey(t, "Raast", null, "DEBIT")).toMatchObject({
      kind: "COUNTERPARTY",
      label: "Transfers to ••4567",
    });
  });

  it("prefers a PHONE token over an ACCT token for the rule key", () => {
    const t = tok("IBFT from A/C 11112222333344 to 03001234567");
    const tokens = findTokens(t);
    expect(tokens.map((x) => x.slice(1, 6))).toEqual(["ACCT ", "PHONE"]);
    const phoneHash = tokens[1]!.match(/#([0-9a-f]{12})/)![1];
    expect(extractRuleKey(t, "IBFT", null, "DEBIT")?.matchKey).toBe(`${phoneHash}:D`);
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

  it("keeps a token whose hash looks like 'acc'+digits intact through redactPiiText", () => {
    const t = "Raast to [PHONE ••4567 #3acc12345670] A/C 12345678";
    expect(redactPiiText(t)).toBe("Raast to [PHONE ••4567 #3acc12345670] A/C [ACCT REDACTED]");
  });
});

describe("rule keys", () => {
  const t = findTokens(tok("to 03001234567"))[0]!;
  const hash = t.match(/#([0-9a-f]{12})/)![1];

  it("prefers the counterparty token over the merchant", () => {
    expect(extractRuleKey(`Raast ${t}`, "Raast", null, "DEBIT")).toEqual({
      kind: "COUNTERPARTY",
      matchKey: `${hash}:D`,
      label: "Transfers to ••4567",
    });
    expect(candidateRuleKeys(`Raast ${t}`, "Raast", null, "DEBIT").map((k) => k.kind)).toEqual([
      "COUNTERPARTY",
      "MERCHANT",
    ]);
  });

  it("keys counterparties per direction, and labels money in as 'Money from'", () => {
    expect(extractRuleKey(`Raast ${t}`, "Raast", null, "CREDIT")).toEqual({
      kind: "COUNTERPARTY",
      matchKey: `${hash}:C`,
      label: "Money from ••4567",
    });
  });

  it("keys merchants the same whatever the direction", () => {
    expect(extractRuleKey("POS DARAZ", "Daraz", null, "CREDIT")).toEqual(
      extractRuleKey("POS DARAZ", "Daraz", null, "DEBIT")
    );
  });

  it("uses the hint when the description has no token", () => {
    expect(extractRuleKey("Raast transfer", "Raast", t, "DEBIT")).toMatchObject({
      kind: "COUNTERPARTY",
      matchKey: `${hash}:D`,
    });
  });

  it("labels ACCT tokens as account transfers", () => {
    const a = findTokens(tok("to PK36SCBL0000001123456702"))[0]!;
    expect(extractRuleKey(a, "", null, "DEBIT")?.label).toBe("Transfers to account ••6702");
    expect(extractRuleKey(a, "", null, "CREDIT")?.label).toBe("Money from account ••6702");
  });

  it("falls back to the normalised merchant name", () => {
    expect(extractRuleKey("POS DARAZ PK", "  Daraz   Online ", null, "DEBIT")).toEqual({
      kind: "MERCHANT",
      matchKey: "daraz online",
      label: "Daraz Online",
    });
    expect(normaliseMerchant("  KFC   DHA ")).toBe("kfc dha");
  });

  it("returns null with neither token nor merchant", () => {
    expect(extractRuleKey("x", "  ", null, "DEBIT")).toBeNull();
    expect(hasCounterpartyToken("plain text")).toBe(false);
    expect(hasCounterpartyToken(t)).toBe(true);
  });
});
