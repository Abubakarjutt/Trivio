import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cat = vi.hoisted(() => ({ categorizeBatch: vi.fn() }));
vi.mock("@/server/services/statement-categorization.service", () => cat);

import {
  categorizeWithRules,
  createImportCategorizer,
  getCounterpartySecret,
} from "@/server/services/categorize/category-rules.service";
import { findTokens, tokenizeCounterparties } from "@/server/services/categorize/counterparty-token";
import { makeDb, type MockDb } from "../outreach/helpers";

const SECRET = "c".repeat(64);
const token = findTokens(tokenizeCounterparties("to 03001234567", SECRET))[0]!;
const hash = token.match(/#([0-9a-f]{12})/)![1]!;
let db: MockDb;
const asDb = () => db as unknown as PrismaClient;
const ai = (category: string, merchantName = "Shop", fallback = false) => ({
  description: "d",
  merchantName,
  mccCode: "0000",
  mccLabel: category,
  category,
  fallback,
});

beforeEach(() => {
  db = makeDb();
  cat.categorizeBatch.mockReset();
  db.categoryRule.findMany.mockResolvedValue([]);
  db.categoryRule.update.mockResolvedValue({});
});

describe("categorizeWithRules", () => {
  it("applies a counterparty rule without calling the AI", async () => {
    db.categoryRule.findMany.mockResolvedValueOnce([
      { id: "r1", kind: "COUNTERPARTY", matchKey: `${hash}:D`, label: "Transfers to ••4567", category: "Rent" },
    ]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: `Raast ${token}`, type: "DEBIT" }]);
    expect(r).toMatchObject({
      category: "Rent",
      needsCategory: false,
      ruleApplied: true,
      ruleKey: { kind: "COUNTERPARTY", matchKey: `${hash}:D` },
    });
    expect(cat.categorizeBatch).not.toHaveBeenCalled();
    expect(db.categoryRule.findMany.mock.calls[0]![0].where.organisationId).toBe("org-1");
    expect(db.categoryRule.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { timesApplied: { increment: 1 }, lastAppliedAt: expect.any(Date) },
    });
  });

  it("does not apply a money-out counterparty rule to money in from the same number", async () => {
    // The DB returns only rules matching the requested keys; a DEBIT rule's key is <hash>:D.
    db.categoryRule.findMany.mockImplementation(async ({ where }: { where: { OR: { matchKey: string }[] } }) =>
      where.OR.some((k) => k.matchKey === `${hash}:D`)
        ? [{ id: "r1", kind: "COUNTERPARTY", matchKey: `${hash}:D`, label: "x", category: "Rent" }]
        : []
    );
    cat.categorizeBatch.mockResolvedValue([ai("Income", "Raast")]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: `Raast ${token}`, type: "CREDIT" }]);
    expect(r).toMatchObject({
      ruleApplied: false,
      needsCategory: true,
      ruleKey: { kind: "COUNTERPARTY", matchKey: `${hash}:C`, label: "Money from ••4567" },
    });
    expect(db.categoryRule.update).not.toHaveBeenCalled();
  });

  it("applies a merchant rule whatever the direction", async () => {
    db.categoryRule.findMany.mockResolvedValueOnce([
      { id: "r2", kind: "MERCHANT", matchKey: "daraz", label: "Daraz", category: "Shopping" },
    ]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [
      { description: "DARAZ REFUND", merchantName: "Daraz", type: "CREDIT" },
    ]);
    expect(r).toMatchObject({ category: "Shopping", ruleApplied: true });
  });

  it("uses the counterparty hint when the parsed description lost the token", async () => {
    db.categoryRule.findMany.mockResolvedValueOnce([
      { id: "r1", kind: "COUNTERPARTY", matchKey: `${hash}:D`, label: "x", category: "Rent" },
    ]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [
      { description: "Raast transfer", type: "DEBIT", counterpartyHint: token },
    ]);
    expect(r).toMatchObject({ category: "Rent", ruleApplied: true });
  });

  it("applies a merchant rule using the AI's cleaned merchant name", async () => {
    cat.categorizeBatch.mockResolvedValue([ai("Shopping", "Daraz")]);
    // No pre-AI keys (no token, no merchant name), so the only query is the post-AI one.
    db.categoryRule.findMany.mockResolvedValueOnce([
      { id: "r2", kind: "MERCHANT", matchKey: "daraz", label: "Daraz", category: "Household" },
    ]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: "POS DARAZ PK 123", type: "DEBIT" }]);
    expect(r).toMatchObject({
      category: "Household",
      needsCategory: false,
      ruleApplied: true,
      merchantName: "Daraz",
    });
    expect(db.categoryRule.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Transfers", "Raast", false],
    ["Other", "ATM", false],
    ["Groceries", "Imtiaz", true],
  ])("flags %s (fallback=%s) as needing a category", async (category, merchant, fb) => {
    cat.categorizeBatch.mockResolvedValue([ai(category, merchant, fb)]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: merchant, type: "DEBIT" }]);
    expect(r).toMatchObject({ needsCategory: true, ruleApplied: false, category });
  });

  it("flags a row with a counterparty token even when the AI is confident", async () => {
    cat.categorizeBatch.mockResolvedValue([ai("Bills & Utilities", "Raast")]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: `Raast ${token}`, type: "DEBIT" }]);
    expect(r).toMatchObject({ needsCategory: true, ruleKey: { kind: "COUNTERPARTY", matchKey: `${hash}:D` } });
  });

  it("does not flag a confident merchant row", async () => {
    cat.categorizeBatch.mockResolvedValue([ai("Groceries", "Imtiaz")]);
    const [r] = await categorizeWithRules(asDb(), "org-1", [{ description: "POS IMTIAZ", type: "DEBIT" }]);
    expect(r).toMatchObject({ needsCategory: false, ruleKey: { kind: "MERCHANT", matchKey: "imtiaz" } });
  });

  it("returns [] for no rows", async () => {
    expect(await categorizeWithRules(asDb(), "org-1", [])).toEqual([]);
  });
});

describe("getCounterpartySecret / createImportCategorizer", () => {
  it("reuses an existing secret", async () => {
    db.organisation.findUnique.mockResolvedValue({ counterpartySecret: SECRET });
    expect(await getCounterpartySecret(asDb(), "org-1")).toBe(SECRET);
    expect(db.organisation.updateMany).not.toHaveBeenCalled();
  });

  it("creates one only when empty, and re-reads to agree with a racing writer", async () => {
    db.organisation.findUnique
      .mockResolvedValueOnce({ counterpartySecret: null })
      .mockResolvedValueOnce({ counterpartySecret: "winner" });
    db.organisation.updateMany.mockResolvedValue({ count: 0 });
    expect(await getCounterpartySecret(asDb(), "org-1")).toBe("winner");
    expect(db.organisation.updateMany.mock.calls[0]![0].where).toEqual({
      id: "org-1",
      counterpartySecret: null,
    });
  });

  it("binds tokenize to the org secret", async () => {
    db.organisation.findUnique.mockResolvedValue({ counterpartySecret: SECRET });
    const c = await createImportCategorizer(asDb(), "org-1");
    expect(c.tokenize("to 03001234567")).toBe(`to ${token}`);
  });
});
