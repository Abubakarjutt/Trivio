import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const TAX_REGIMES = [
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
];

async function main() {
  console.log("🌱 Seeding tax regimes...");
  for (const regime of TAX_REGIMES) {
    await db.taxRegime.upsert({
      where: { code: regime.code },
      update: {},
      create: {
        code: regime.code,
        name: regime.name,
        country: regime.country,
        rates: {
          create: regime.rates,
        },
      },
    });
  }
  console.log("✅ Tax regimes seeded");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
