// 20 realistic PKR transactions spread across 3 months.
// Used by org.loadSampleData — all rows get isSampleData=true.

export interface SampleTransaction {
  description: string;
  merchantName: string;
  amount: number;
  type: "DEBIT" | "CREDIT";
  category: string;
  daysAgo: number;
}

export const SAMPLE_TRANSACTIONS: SampleTransaction[] = [
  // ── Current month ──────────────────────────────────────────────────────
  { description: "Salary credit - Jun 2026",        merchantName: "Employer",     amount: 85000, type: "CREDIT", category: "Salary & Employment",   daysAgo: 2  },
  { description: "Careem ride to office",            merchantName: "Careem",       amount: 450,   type: "DEBIT",  category: "Ride-sharing & Taxis",   daysAgo: 4  },
  { description: "Imtiaz Superstore grocery run",    merchantName: "Imtiaz",       amount: 4200,  type: "DEBIT",  category: "Groceries",              daysAgo: 6  },
  { description: "Jazz mobile top-up (prepaid)",     merchantName: "Jazz",         amount: 500,   type: "DEBIT",  category: "Mobile Top-Up",          daysAgo: 8  },
  { description: "StormFiber internet bill",         merchantName: "StormFiber",   amount: 3499,  type: "DEBIT",  category: "Internet & Phone",        daysAgo: 10 },
  { description: "LESCO electricity bill",           merchantName: "LESCO",        amount: 5800,  type: "DEBIT",  category: "Electricity & Gas",       daysAgo: 12 },
  { description: "IBFT to Kinza Gilani Meezan",     merchantName: "Meezan Bank",  amount: 10000, type: "DEBIT",  category: "Transfers",              daysAgo: 15 },
  // ── Last month ─────────────────────────────────────────────────────────
  { description: "Salary credit - May 2026",        merchantName: "Employer",     amount: 85000, type: "CREDIT", category: "Salary & Employment",   daysAgo: 32 },
  { description: "McDonald's F-10",                 merchantName: "McDonald's",   amount: 1850,  type: "DEBIT",  category: "Restaurants & Cafes",    daysAgo: 34 },
  { description: "Daraz online order",              merchantName: "Daraz",        amount: 2340,  type: "DEBIT",  category: "General Shopping",        daysAgo: 36 },
  { description: "Uber Eats delivery",              merchantName: "Uber Eats",    amount: 920,   type: "DEBIT",  category: "Restaurants & Cafes",    daysAgo: 38 },
  { description: "Petrol pump F-7",                 merchantName: "PSO",          amount: 6000,  type: "DEBIT",  category: "Fuel & Gas",              daysAgo: 41 },
  { description: "Shaukat Khanum donation",         merchantName: "Shaukat Khanum", amount: 2000, type: "DEBIT", category: "Charity & Donations",    daysAgo: 44 },
  { description: "Zong data bundle",                merchantName: "Zong",         amount: 350,   type: "DEBIT",  category: "Mobile Top-Up",          daysAgo: 48 },
  { description: "Chase Up grocery",                merchantName: "Chase Up",     amount: 3100,  type: "DEBIT",  category: "Groceries",              daysAgo: 52 },
  // ── Two months ago ─────────────────────────────────────────────────────
  { description: "Salary credit - Apr 2026",        merchantName: "Employer",     amount: 85000, type: "CREDIT", category: "Salary & Employment",   daysAgo: 62 },
  { description: "IBFT from Abubakar Raast",        merchantName: "Raast",        amount: 15000, type: "CREDIT", category: "Transfers",             daysAgo: 65 },
  { description: "Telenor top-up",                  merchantName: "Telenor",      amount: 200,   type: "DEBIT",  category: "Mobile Top-Up",          daysAgo: 67 },
  { description: "Alkaram Studio clothing purchase", merchantName: "Alkaram",     amount: 4500,  type: "DEBIT",  category: "Clothing & Apparel",      daysAgo: 70 },
  { description: "Netflix subscription",            merchantName: "Netflix",      amount: 1100,  type: "DEBIT",  category: "Movies & Streaming",      daysAgo: 73 },
];
