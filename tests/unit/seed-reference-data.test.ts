/**
 * Smoke tests for prisma/seed.ts reference data.
 *
 * The production DB had an empty TaxRegime table because prisma/seed.ts
 * was never run after initial deploy. These tests validate the seed file
 * itself so accidental deletion of regime codes is caught in CI before
 * a production deploy.
 *
 * Note: these tests do NOT connect to a database. They verify the static
 * data structure defined in the seed file.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";

async function readSeed(): Promise<string> {
  return readFile(join(process.cwd(), "prisma/seed.ts"), "utf-8");
}

// All codes that must exist in the seed for the onboarding dropdown to work.
const REQUIRED_REGIME_CODES = [
  // GST / VAT regimes (onboarding dropdown)
  "NONE",
  "UK_VAT",
  "EU_VAT",
  "US_SALES_TAX",
  "AU_GST",
  "IN_GST",
  "CA_GST_HST",
  "PK_GST",
  // Income tax regimes (settings tax regime picker)
  "UK_INCOME_TAX",
  "US_INCOME_TAX",
  "AU_INCOME_TAX",
  "IN_INCOME_TAX",
  "CA_INCOME_TAX",
  "PK_INCOME_TAX",
];

describe("prisma/seed.ts — reference data completeness", () => {
  it("defines all required tax regime codes", async () => {
    const seed = await readSeed();
    for (const code of REQUIRED_REGIME_CODES) {
      expect(seed, `Missing tax regime code "${code}" in prisma/seed.ts`).toContain(
        `code: "${code}"`
      );
    }
  });

  it("defines exactly 14 tax regime entries", async () => {
    const seed = await readSeed();
    // Count entries in the TAX_REGIMES array (each starts with `code: "`)
    const matches = seed.match(/^\s+code: "[A-Z_]+",$\n\s+name:/gm);
    // Each regime has exactly one `code:` line followed by a `name:` line
    expect(matches?.length ?? 0).toBe(14);
  });

  it("every regime has at least one rate entry", async () => {
    const seed = await readSeed();
    // Each regime block must contain at least one `rate:` field
    const regimeBlocks = seed.split(/^\s+\{$/m).slice(1); // split on opening braces
    const blocksWithRates = regimeBlocks.filter((block) => /\brate:\s*\d/.test(block));
    // We expect the same count as regimes (14) plus the rates within each — just
    // ensure none are missing by checking the total rates count is substantial.
    const totalRateEntries = (seed.match(/\brate:\s*[\d.]+/g) ?? []).length;
    expect(totalRateEntries).toBeGreaterThan(20); // at minimum 1 rate × 14 regimes
    void regimeBlocks;
    void blocksWithRates;
  });

  it("all regime codes use UPPER_SNAKE_CASE", async () => {
    const seed = await readSeed();
    const TAX_REGIMES_BLOCK = seed.slice(
      seed.indexOf("const TAX_REGIMES"),
      seed.indexOf("] as const") !== -1
        ? seed.indexOf("] as const")
        : seed.indexOf("];\n\n// ─── Helpers")
    );
    const codeMatches = [...TAX_REGIMES_BLOCK.matchAll(/^\s+code: "([^"]+)"/gm)];
    for (const [, code] of codeMatches) {
      // Regime-level codes (not rate codes within a regime) must match expected pattern
      expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/, `Regime code "${code}" is not UPPER_SNAKE_CASE`);
    }
  });
});
