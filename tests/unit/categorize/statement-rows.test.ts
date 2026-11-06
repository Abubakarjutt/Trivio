import { describe, expect, it } from "vitest";
import { toStatementRow, tokenizeExisting } from "@/server/services/categorize/statement-rows";
import { detectDuplicates } from "@/server/services/statement-parser.service";
import { tokenizeCounterparties } from "@/server/services/categorize/counterparty-token";

const raw = { date: "2026-10-30", description: "IBFT [PHONE ••4567 #0123456789ab]", amount: 5000, type: "DEBIT" as const };

describe("toStatementRow", () => {
  it("copies the categorisation, flag and rule key", () => {
    expect(toStatementRow(raw, {
      merchantName: "IBFT", category: "Transfers", mccCode: "0000", mccLabel: "Transfers", needsCategory: true,
      ruleKey: { kind: "COUNTERPARTY", matchKey: "0123456789ab", label: "Transfers to ••4567" }, ruleApplied: false,
    })).toEqual({
      date: new Date("2026-10-30"), description: raw.description, merchantName: "IBFT", amount: 5000, type: "DEBIT",
      category: "Transfers", mccCode: "0000", mccLabel: "Transfers", needsCategory: true,
      ruleKind: "COUNTERPARTY", ruleMatchKey: "0123456789ab", ruleLabel: "Transfers to ••4567",
    });
  });

  it("flags a row the categoriser returned nothing for", () => {
    expect(toStatementRow(raw, undefined)).toMatchObject({ category: "Other", merchantName: raw.description, needsCategory: true, ruleKind: null });
  });
});

describe("tokenizeExisting", () => {
  it("lets a re-imported row match one saved before tokens existed", () => {
    const tokenize = (t: string) => tokenizeCounterparties(t, "d".repeat(64));
    const incoming = [{ ...raw, description: tokenize("IBFT to 03001234567 ref 99812") }];
    const existing = [{ id: "old", date: new Date("2026-10-30"), description: "IBFT to 03001234567 ref 99812", amount: 5000 }];
    expect(detectDuplicates(incoming, tokenizeExisting(existing, tokenize)).duplicates).toHaveLength(1);
  });
});
