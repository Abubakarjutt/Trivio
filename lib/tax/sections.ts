export interface TaxSection {
  id: string
  label: string
  type: "income" | "deduction"
  reference: string
  categories: string[]
}

export interface JurisdictionConfig {
  code: string
  name: string
  currency: string
  fiscalYearStart: (year: number) => Date
  fiscalYearEnd: (year: number) => Date
  sections: TaxSection[]
}

// ─── Pakistan (FBR) ───────────────────────────────────────────────────────────
// Fiscal year: 1 Jul → 30 Jun (e.g. FY2025 = 1 Jul 2024 – 30 Jun 2025)
const pakistanConfig: JurisdictionConfig = {
  code: "PAK",
  name: "Pakistan (FBR)",
  currency: "PKR",
  fiscalYearStart: (year) => new Date(year - 1, 6, 1),
  fiscalYearEnd:   (year) => new Date(year, 5, 30, 23, 59, 59),
  sections: [
    {
      id: "pak_s149",
      label: "Section 149 — Salary Income",
      type: "income",
      reference: "ITO 2001 s.149",
      categories: ["Salary & Employment"],
    },
    {
      id: "pak_s153",
      label: "Section 153 — Services / Contracts",
      type: "income",
      reference: "ITO 2001 s.153",
      // Removed: "Bank Fees & Charges" (expense, not services income)
      // Removed: "Investments & Trading" (taxed separately under s.37/s.151 — see pak_s37 below)
      categories: [
        "Freelance & Services",
        "Business Revenue",
        "Software & Subscriptions",
        "Professional Services",
      ],
    },
    {
      id: "pak_s37",
      label: "Section 37 / 151 — Capital Gains & Investment Income",
      type: "income",
      reference: "ITO 2001 s.37, s.151",
      categories: ["Investments & Trading"],
    },
    {
      id: "pak_7e",
      label: "Section 7E — Property Income",
      type: "income",
      reference: "ITO 2001 s.7E",
      categories: ["Rent & Mortgage", "Rental Income"],
      // Removed: "Home Improvement" — a cost category, not income
    },
    {
      id: "pak_biz_exp",
      label: "Business Expenses (deductible)",
      type: "deduction",
      reference: "ITO 2001 s.20-21",
      categories: [
        "Software & Subscriptions",
        "Office Supplies",
        "Professional Services",
        "Shipping & Postage",
        "Bank Fees & Charges",   // moved from income — DEBIT transactions are business costs
        "Electricity & Gas",
        "Internet & Phone",
        "Water & Waste",
        "Fuel & Gas",
        "Ride-sharing & Taxis",
        "Public Transit",
        "Parking",
        "Vehicle Maintenance",
      ],
    },
    {
      id: "pak_medical",
      label: "Medical Expenses (tax credit)",
      type: "deduction",
      reference: "ITO 2001 s.62",
      // Removed: "Gym & Fitness" — not deductible under Pakistan tax law
      categories: ["Pharmacy & Drugstore", "Doctor & Medical"],
    },
    {
      id: "pak_education",
      label: "Education Deductions",
      type: "deduction",
      reference: "ITO 2001 s.60B",
      categories: ["Tuition & Schools", "Books & Courses"],
    },
  ],
}

// ─── United States (IRS) ──────────────────────────────────────────────────────
// Fiscal year: 1 Jan → 31 Dec
const usaConfig: JurisdictionConfig = {
  code: "USA",
  name: "United States (IRS)",
  currency: "USD",
  fiscalYearStart: (year) => new Date(year, 0, 1),
  fiscalYearEnd:   (year) => new Date(year, 11, 31, 23, 59, 59),
  sections: [
    {
      id: "usa_w2",
      label: "W-2 / Salary Income",
      type: "income",
      reference: "IRS Form W-2",
      categories: ["Salary & Employment"],
    },
    {
      id: "usa_sched_c",
      label: "Schedule C — Business Income",
      type: "income",
      reference: "IRS Schedule C",
      // Removed: "Bank Fees & Charges" (expense, not business revenue)
      // Removed: "Investments & Trading" (Schedule D capital gains — see usa_sched_d below)
      categories: [
        "Freelance & Services",
        "Business Revenue",
        "Software & Subscriptions",
        "Professional Services",
      ],
    },
    {
      id: "usa_sched_d",
      label: "Schedule D — Capital Gains",
      type: "income",
      reference: "IRS Schedule D",
      categories: ["Investments & Trading"],
    },
    {
      id: "usa_sched_e",
      label: "Schedule E — Rental / Passive",
      type: "income",
      reference: "IRS Schedule E",
      categories: ["Rental Income"],
      // Removed: "Rent & Mortgage" (expense paid, not rental income received)
      // Removed: "Home Improvement" (expense category)
    },
    {
      id: "usa_biz_exp",
      label: "Business Expenses (Schedule C)",
      type: "deduction",
      reference: "IRS Schedule C",
      categories: [
        "Software & Subscriptions",
        "Office Supplies",
        "Professional Services",
        "Shipping & Postage",
        "Bank Fees & Charges",   // moved from income — deductible as ordinary business expense
        "Electricity & Gas",
        "Internet & Phone",
        "Water & Waste",
        "Fuel & Gas",
        "Ride-sharing & Taxis",
        "Public Transit",
        "Parking",
        "Vehicle Maintenance",
      ],
    },
    {
      id: "usa_medical",
      label: "Medical Deductions (Schedule A)",
      type: "deduction",
      reference: "IRS Schedule A §213",
      // Gym & Fitness only deductible if medically prescribed; kept as an indicator
      // but user should verify against the 7.5% AGI threshold
      categories: ["Pharmacy & Drugstore", "Doctor & Medical", "Gym & Fitness"],
    },
    {
      id: "usa_charitable",
      label: "Charitable / Education (Schedule A)",
      type: "deduction",
      reference: "IRS Schedule A",
      categories: ["Charity & Donations", "Tuition & Schools", "Books & Courses"],
    },
  ],
}

// ─── United Kingdom (HMRC) ────────────────────────────────────────────────────
// Fiscal year: 6 Apr → 5 Apr next year
const ukConfig: JurisdictionConfig = {
  code: "UK",
  name: "United Kingdom (HMRC)",
  currency: "GBP",
  fiscalYearStart: (year) => new Date(year, 3, 6),
  fiscalYearEnd:   (year) => new Date(year + 1, 3, 5, 23, 59, 59),
  sections: [
    {
      id: "uk_employment",
      label: "Employment Income",
      type: "income",
      reference: "ITEPA 2003 s.6",
      categories: ["Salary & Employment"],
    },
    {
      id: "uk_self_emp",
      label: "Self-Employment Income",
      type: "income",
      reference: "ITTOIA 2005 s.3",
      // Removed: "Bank Fees & Charges" (expense, not self-employment revenue)
      // Removed: "Investments & Trading" (CGT — see uk_cgt below)
      categories: [
        "Freelance & Services",
        "Business Revenue",
        "Software & Subscriptions",
        "Professional Services",
      ],
    },
    {
      id: "uk_cgt",
      label: "Capital Gains",
      type: "income",
      reference: "TCGA 1992",
      categories: ["Investments & Trading"],
    },
    {
      id: "uk_property",
      label: "Property Income",
      type: "income",
      reference: "ITTOIA 2005 s.261",
      categories: ["Rental Income"],
      // Removed: "Rent & Mortgage" and "Home Improvement" (expenses, not income)
    },
    {
      id: "uk_biz_exp",
      label: "Allowable Business Expenses",
      type: "deduction",
      reference: "ITTOIA 2005 s.34",
      categories: [
        "Software & Subscriptions",
        "Office Supplies",
        "Professional Services",
        "Shipping & Postage",
        "Bank Fees & Charges",   // moved from income — allowable as business cost
        "Electricity & Gas",
        "Internet & Phone",
        "Water & Waste",
        "Fuel & Gas",
        "Ride-sharing & Taxis",
        "Public Transit",
        "Parking",
        "Vehicle Maintenance",
      ],
    },
    {
      id: "uk_medical",
      label: "Medical / Professional Expenses",
      type: "deduction",
      reference: "ITTOIA 2005 s.34",
      // Gym & Fitness only deductible if wholly and exclusively for business (e.g. personal trainer)
      categories: ["Pharmacy & Drugstore", "Doctor & Medical", "Gym & Fitness"],
    },
    {
      id: "uk_education",
      label: "Education & Training",
      type: "deduction",
      reference: "ITTOIA 2005 s.34",
      categories: ["Tuition & Schools", "Books & Courses"],
    },
  ],
}

export const JURISDICTIONS: Record<string, JurisdictionConfig> = {
  PAK: pakistanConfig,
  USA: usaConfig,
  UK:  ukConfig,
}

export const VALID_JURISDICTION_CODES = ["PAK", "USA", "UK"] as const
export type JurisdictionCode = typeof VALID_JURISDICTION_CODES[number]

export function dateToFiscalYear(date: Date, config: JurisdictionConfig): number {
  const yr = date.getFullYear()
  for (const candidate of [yr - 1, yr, yr + 1]) {
    const start = config.fiscalYearStart(candidate)
    const end   = config.fiscalYearEnd(candidate)
    if (date >= start && date <= end) return candidate
  }
  return yr
}

export function getSection(jurisdictionCode: string, sectionId: string): TaxSection | undefined {
  return JURISDICTIONS[jurisdictionCode]?.sections.find(s => s.id === sectionId)
}
