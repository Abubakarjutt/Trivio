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
      categories: [
        "Freelance & Services", "Business Revenue",
        "Software & Subscriptions", "Professional Services",
        "Bank Fees & Charges", "Investments & Trading",
      ],
    },
    {
      id: "pak_7e",
      label: "Section 7E — Property Income",
      type: "income",
      reference: "ITO 2001 s.7E",
      categories: ["Rent & Mortgage", "Home Improvement", "Rental Income"],
    },
    {
      id: "pak_biz_exp",
      label: "Business Expenses (deductible)",
      type: "deduction",
      reference: "ITO 2001 s.20-21",
      categories: [
        "Software & Subscriptions", "Office Supplies", "Professional Services", "Shipping & Postage",
        "Electricity & Gas", "Internet & Phone", "Water & Waste",
        "Fuel & Gas", "Ride-sharing & Taxis", "Public Transit", "Parking", "Vehicle Maintenance",
      ],
    },
    {
      id: "pak_medical",
      label: "Medical Deductions",
      type: "deduction",
      reference: "ITO 2001 s.61",
      categories: ["Pharmacy & Drugstore", "Doctor & Medical", "Gym & Fitness"],
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
      categories: [
        "Freelance & Services", "Business Revenue",
        "Software & Subscriptions", "Professional Services",
        "Bank Fees & Charges", "Investments & Trading",
      ],
    },
    {
      id: "usa_sched_e",
      label: "Schedule E — Rental / Passive",
      type: "income",
      reference: "IRS Schedule E",
      categories: ["Rent & Mortgage", "Home Improvement", "Rental Income"],
    },
    {
      id: "usa_biz_exp",
      label: "Business Expenses (Schedule C)",
      type: "deduction",
      reference: "IRS Schedule C",
      categories: [
        "Software & Subscriptions", "Office Supplies", "Professional Services", "Shipping & Postage",
        "Electricity & Gas", "Internet & Phone", "Water & Waste",
        "Fuel & Gas", "Ride-sharing & Taxis", "Public Transit", "Parking", "Vehicle Maintenance",
      ],
    },
    {
      id: "usa_medical",
      label: "Medical Deductions (Schedule A)",
      type: "deduction",
      reference: "IRS Schedule A",
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
      categories: [
        "Freelance & Services", "Business Revenue",
        "Software & Subscriptions", "Professional Services",
        "Bank Fees & Charges", "Investments & Trading",
      ],
    },
    {
      id: "uk_property",
      label: "Property Income",
      type: "income",
      reference: "ITTOIA 2005 s.261",
      categories: ["Rent & Mortgage", "Home Improvement", "Rental Income"],
    },
    {
      id: "uk_biz_exp",
      label: "Allowable Business Expenses",
      type: "deduction",
      reference: "ITTOIA 2005 s.34",
      categories: [
        "Software & Subscriptions", "Office Supplies", "Professional Services", "Shipping & Postage",
        "Electricity & Gas", "Internet & Phone", "Water & Waste",
        "Fuel & Gas", "Ride-sharing & Taxis", "Public Transit", "Parking", "Vehicle Maintenance",
      ],
    },
    {
      id: "uk_medical",
      label: "Medical / Professional Expenses",
      type: "deduction",
      reference: "ITTOIA 2005 s.34",
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
