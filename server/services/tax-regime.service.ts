import { type PrismaClient } from "@prisma/client";

export const TAX_REGIMES = [
  {
    code: "NONE",
    name: "No Tax",
    country: "Global",
    rates: [{ code: "NONE", name: "No Tax (0%)", rate: 0.0 }],
  },
  {
    code: "UK_VAT",
    name: "UK VAT",
    country: "GB",
    rates: [
      { code: "STANDARD", name: "Standard Rate (20%)", rate: 0.2 },
      { code: "REDUCED", name: "Reduced Rate (5%)", rate: 0.05 },
      { code: "ZERO", name: "Zero Rate (0%)", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "EU_VAT",
    name: "EU VAT",
    country: "EU",
    rates: [
      { code: "STANDARD", name: "Standard Rate (20%)", rate: 0.2 },
      { code: "REDUCED", name: "Reduced Rate (10%)", rate: 0.1 },
      { code: "SUPER_REDUCED", name: "Super Reduced (5%)", rate: 0.05 },
      { code: "ZERO", name: "Zero Rate (0%)", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "US_SALES_TAX",
    name: "US Sales Tax",
    country: "US",
    rates: [
      { code: "STANDARD", name: "Sales Tax", rate: 0.0875 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "AU_GST",
    name: "Australian GST",
    country: "AU",
    rates: [
      { code: "STANDARD", name: "GST (10%)", rate: 0.1 },
      { code: "ZERO", name: "GST-Free", rate: 0.0 },
      { code: "EXEMPT", name: "Input Taxed", rate: 0.0 },
    ],
  },
  {
    code: "IN_GST",
    name: "Indian GST",
    country: "IN",
    rates: [
      { code: "STANDARD_28", name: "GST 28%", rate: 0.28 },
      { code: "STANDARD_18", name: "GST 18%", rate: 0.18 },
      { code: "STANDARD_12", name: "GST 12%", rate: 0.12 },
      { code: "STANDARD_5", name: "GST 5%", rate: 0.05 },
      { code: "ZERO", name: "GST 0%", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "CA_GST_HST",
    name: "Canadian GST/HST",
    country: "CA",
    rates: [
      { code: "HST", name: "HST (15%)", rate: 0.15 },
      { code: "GST", name: "GST (5%)", rate: 0.05 },
      { code: "ZERO", name: "Zero-Rated", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "PK_GST",
    name: "Pakistan GST/Sales Tax",
    country: "PK",
    rates: [
      { code: "STANDARD", name: "Standard (17%)", rate: 0.17 },
      { code: "REDUCED", name: "Reduced (5%)", rate: 0.05 },
      { code: "ZERO", name: "Zero Rate", rate: 0.0 },
      { code: "EXEMPT", name: "Exempt", rate: 0.0 },
    ],
  },
  {
    code: "UK_INCOME_TAX",
    name: "UK Income Tax (PAYE)",
    country: "GB",
    rates: [
      { code: "BASIC", name: "Basic Rate (20%)", rate: 0.2 },
      { code: "HIGHER", name: "Higher Rate (40%)", rate: 0.4 },
      { code: "ADDITIONAL", name: "Additional Rate (45%)", rate: 0.45 },
    ],
  },
  {
    code: "US_INCOME_TAX",
    name: "US Federal Income Tax",
    country: "US",
    rates: [
      { code: "RATE_10", name: "10% Bracket", rate: 0.1 },
      { code: "RATE_12", name: "12% Bracket", rate: 0.12 },
      { code: "RATE_22", name: "22% Bracket", rate: 0.22 },
      { code: "RATE_24", name: "24% Bracket", rate: 0.24 },
      { code: "RATE_32", name: "32% Bracket", rate: 0.32 },
      { code: "RATE_35", name: "35% Bracket", rate: 0.35 },
      { code: "RATE_37", name: "37% Bracket", rate: 0.37 },
    ],
  },
  {
    code: "AU_INCOME_TAX",
    name: "Australian Income Tax",
    country: "AU",
    rates: [
      { code: "RATE_19", name: "19% (A$18,201–45,000)", rate: 0.19 },
      { code: "RATE_325", name: "32.5% (A$45,001–135,000)", rate: 0.325 },
      { code: "RATE_37", name: "37% (A$135,001–190,000)", rate: 0.37 },
      { code: "RATE_45", name: "45% (over A$190,000)", rate: 0.45 },
    ],
  },
  {
    code: "IN_INCOME_TAX",
    name: "Indian Income Tax (TDS)",
    country: "IN",
    rates: [
      { code: "TDS_1", name: "TDS 1%", rate: 0.01 },
      { code: "TDS_2", name: "TDS 2%", rate: 0.02 },
      { code: "TDS_5", name: "TDS 5%", rate: 0.05 },
      { code: "TDS_10", name: "TDS 10%", rate: 0.1 },
      { code: "TDS_30", name: "TDS 30%", rate: 0.3 },
    ],
  },
  {
    code: "CA_INCOME_TAX",
    name: "Canadian Income Tax",
    country: "CA",
    rates: [
      { code: "RATE_15", name: "Federal 15% (up to C$55,867)", rate: 0.15 },
      { code: "RATE_205", name: "Federal 20.5% (C$55,867–111,733)", rate: 0.205 },
      { code: "RATE_26", name: "Federal 26% (C$111,733–154,906)", rate: 0.26 },
      { code: "RATE_29", name: "Federal 29% (C$154,906–220,000)", rate: 0.29 },
      { code: "RATE_33", name: "Federal 33% (over C$220,000)", rate: 0.33 },
    ],
  },
  {
    code: "PK_INCOME_TAX",
    name: "Pakistan Income Tax",
    country: "PK",
    rates: [
      { code: "SLAB_1", name: "Up to PKR 600K (0%)", rate: 0.0 },
      { code: "SLAB_2", name: "PKR 600K–1.2M (5%)", rate: 0.05 },
      { code: "SLAB_3", name: "PKR 1.2M–2.4M (15%)", rate: 0.15 },
      { code: "SLAB_4", name: "PKR 2.4M–3.6M (25%)", rate: 0.25 },
      { code: "SLAB_5", name: "PKR 3.6M–6M (30%)", rate: 0.3 },
      { code: "SLAB_6", name: "Over PKR 6M (35%)", rate: 0.35 },
    ],
  },
];

// Idempotent: safe to call on every server boot (upsert with an empty
// `update`, keyed on the regime's unique code).
export async function seedTaxRegimes(db: PrismaClient): Promise<void> {
  for (const regime of TAX_REGIMES) {
    await db.taxRegime.upsert({
      where: { code: regime.code },
      update: {},
      create: {
        code: regime.code,
        name: regime.name,
        country: regime.country,
        rates: { create: regime.rates },
      },
    });
  }
}
