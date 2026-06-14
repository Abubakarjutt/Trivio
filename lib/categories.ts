export interface CategoryDefinition {
  name: string
  group: string
  icon: string
  mccRanges: [number, number][]
}

export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  // Food & Dining
  { name: "Groceries",              group: "Food & Dining",      icon: "🛒", mccRanges: [[5411,5499]] },
  { name: "Restaurants & Cafes",    group: "Food & Dining",      icon: "🍔", mccRanges: [[5812,5814]] },
  // Transport
  { name: "Fuel & Gas",             group: "Transport",          icon: "⛽", mccRanges: [[5541,5542],[5172,5172]] },
  { name: "Ride-sharing & Taxis",   group: "Transport",          icon: "🚕", mccRanges: [[4121,4121]] },
  { name: "Public Transit",         group: "Transport",          icon: "🚇", mccRanges: [[4111,4120],[4122,4131]] },
  { name: "Parking",                group: "Transport",          icon: "🅿️", mccRanges: [[7521,7523]] },
  { name: "Vehicle Maintenance",    group: "Transport",          icon: "🔧", mccRanges: [[7531,7538]] },
  // Shopping
  { name: "Clothing & Apparel",     group: "Shopping",           icon: "👕", mccRanges: [[5600,5699]] },
  { name: "Electronics & Tech",     group: "Shopping",           icon: "💻", mccRanges: [[5732,5734]] },
  { name: "Home & Garden",          group: "Shopping",           icon: "🏡", mccRanges: [[5712,5722]] },
  { name: "General Shopping",       group: "Shopping",           icon: "🛒", mccRanges: [[5300,5399]] },
  // Entertainment
  { name: "Movies & Streaming",     group: "Entertainment",      icon: "🎥", mccRanges: [[7832,7841]] },
  { name: "Sports & Recreation",    group: "Entertainment",      icon: "⚽", mccRanges: [[7941,7993],[7995,7996]] },
  { name: "Events & Concerts",      group: "Entertainment",      icon: "🎟", mccRanges: [[7922,7929]] },
  // Health & Fitness
  { name: "Pharmacy & Drugstore",   group: "Health & Fitness",   icon: "💊", mccRanges: [[5912,5912]] },
  { name: "Doctor & Medical",       group: "Health & Fitness",   icon: "🏥", mccRanges: [[8011,8099]] },
  { name: "Gym & Fitness",          group: "Health & Fitness",   icon: "🏋️", mccRanges: [[7997,7999]] },
  // Utilities
  { name: "Electricity & Gas",      group: "Utilities",          icon: "⚡", mccRanges: [[4911,4931]] },
  { name: "Internet & Phone",       group: "Utilities",          icon: "📡", mccRanges: [[4813,4813],[4899,4899]] },
  { name: "Mobile Top-Up",          group: "Utilities",          icon: "📱", mccRanges: [] },
  { name: "Water & Waste",          group: "Utilities",          icon: "💧", mccRanges: [[4941,4959]] },
  // Travel
  { name: "Flights",                group: "Travel",             icon: "✈️", mccRanges: [[3000,3299],[4511,4511]] },
  { name: "Hotels & Accommodation", group: "Travel",             icon: "🏨", mccRanges: [[3300,3499],[7011,7012]] },
  { name: "Car Rental",             group: "Travel",             icon: "🚗", mccRanges: [[3500,3999],[7512,7512]] },
  // Housing
  { name: "Rent & Mortgage",        group: "Housing",            icon: "🏠", mccRanges: [[6513,6513]] },
  { name: "Home Improvement",       group: "Housing",            icon: "🔨", mccRanges: [[1520,1520],[5200,5200],[5251,5251]] },
  // Education
  { name: "Tuition & Schools",      group: "Education",          icon: "🎓", mccRanges: [[8211,8220],[8299,8299]] },
  { name: "Books & Courses",        group: "Education",          icon: "📖", mccRanges: [[5942,5943]] },
  // Personal Care
  { name: "Hair & Beauty",          group: "Personal Care",      icon: "💈", mccRanges: [[7230,7231],[5977,5977]] },
  { name: "Spa & Wellness",         group: "Personal Care",      icon: "🧖", mccRanges: [[7298,7298]] },
  // Business Services
  { name: "Software & Subscriptions", group: "Business Services", icon: "💿", mccRanges: [[7372,7374]] },
  { name: "Office Supplies",        group: "Business Services",  icon: "🖨", mccRanges: [[5043,5044]] },
  { name: "Professional Services",  group: "Business Services",  icon: "👔", mccRanges: [[8742,8742],[8999,8999]] },
  { name: "Shipping & Postage",     group: "Business Services",  icon: "📦", mccRanges: [[4215,4215]] },
  // Financial
  { name: "Bank Fees & Charges",    group: "Financial",          icon: "🏦", mccRanges: [[6010,6012],[6051,6051]] },
  { name: "Insurance Premiums",     group: "Financial",          icon: "🛡", mccRanges: [[6300,6399]] },
  { name: "Investments & Trading",  group: "Financial",          icon: "📈", mccRanges: [[6211,6211]] },
  { name: "Transfers",              group: "Financial",          icon: "↔️", mccRanges: [] },
  // Income (no MCC — identified by CREDIT type + description)
  { name: "Salary & Employment",    group: "Income",             icon: "💵", mccRanges: [] },
  { name: "Freelance & Services",   group: "Income",             icon: "🧾", mccRanges: [] },
  { name: "Business Revenue",       group: "Income",             icon: "🏢", mccRanges: [] },
  { name: "Rental Income",          group: "Income",             icon: "🏘", mccRanges: [] },
  // Other
  { name: "Charity & Donations",    group: "Other",              icon: "❤️", mccRanges: [[8398,8398],[8661,8661]] },
  { name: "Government & Taxes",     group: "Other",              icon: "🏛", mccRanges: [[9311,9311],[9399,9399]] },
  { name: "Other",                  group: "Other",              icon: "📋", mccRanges: [] },
]

export const CATEGORY_NAMES = CATEGORY_DEFINITIONS.map(c => c.name) as [string, ...string[]]

export const CATEGORY_BY_NAME = Object.fromEntries(
  CATEGORY_DEFINITIONS.map(c => [c.name, c])
) as Record<string, CategoryDefinition>

export const CATEGORY_GROUPS = [...new Set(CATEGORY_DEFINITIONS.map(c => c.group))]

/** Fallback map: old 15-category names → closest new category name */
export const OLD_CATEGORY_FALLBACK: Record<string, string> = {
  "Food & Dining":     "Restaurants & Cafes",
  "Transport":         "Fuel & Gas",
  "Shopping":          "General Shopping",
  "Entertainment":     "Movies & Streaming",
  "Health & Fitness":  "Doctor & Medical",
  "Utilities":         "Electricity & Gas",
  "Travel":            "Flights",
  "Housing":           "Rent & Mortgage",
  "Education":         "Tuition & Schools",
  "Personal Care":     "Hair & Beauty",
  "Business Services": "Professional Services",
  "Financial":         "Bank Fees & Charges",
  "Income":            "Salary & Employment",
  "Transfer":          "Transfers",
  "Other":             "Other",
}

/**
 * Map an MCC code string to a new category name.
 * Returns "" if MCC is 0000, malformed, or no range matches — caller applies fallback.
 */
export function mapMccToCategory(mccCode: string): string {
  if (!/^\d{4}$/.test(mccCode)) return ""
  const code = parseInt(mccCode, 10)
  if (code === 0) return ""
  for (const cat of CATEGORY_DEFINITIONS) {
    for (const [start, end] of cat.mccRanges) {
      if (code >= start && code <= end) return cat.name
    }
  }
  return ""
}
