/**
 * StatementCategorizationService
 * MCC lookup table + Ollama-powered batch categorization.
 * Mirrors the fallback pattern from extraction.service.ts.
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

export interface CategoryDefinition {
  name: string;
  icon: string;
  /** [startMcc, endMcc] inclusive ranges */
  mccRanges: [number, number][];
}

export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  { name: "Food & Dining",      icon: "☕", mccRanges: [[5411,5411],[5441,5441],[5812,5814]] },
  { name: "Transport",          icon: "🚗", mccRanges: [[4111,4131],[5541,5542],[7513,7513],[7521,7521]] },
  { name: "Shopping",           icon: "🛍", mccRanges: [[5300,5399],[5600,5699],[5940,5999]] },
  { name: "Entertainment",      icon: "🎬", mccRanges: [[5735,5735],[7832,7832],[7922,7922],[7941,7941],[7991,7993]] },
  { name: "Health & Fitness",   icon: "💊", mccRanges: [[5912,5912],[8011,8011],[8021,8021],[8049,8049],[8099,8099]] },
  { name: "Utilities",          icon: "💡", mccRanges: [[4900,4900],[4911,4911],[4941,4941],[4952,4952]] },
  { name: "Travel",             icon: "✈️", mccRanges: [[3000,3999],[4411,4411],[4722,4722],[7011,7012]] },
  { name: "Housing",            icon: "🏠", mccRanges: [[1520,1520],[5251,5251],[6513,6513]] },
  { name: "Education",          icon: "📚", mccRanges: [[8211,8211],[8220,8220],[8299,8299]] },
  { name: "Personal Care",      icon: "💅", mccRanges: [[5977,5977],[7230,7230],[7298,7298]] },
  { name: "Business Services",  icon: "💼", mccRanges: [[7372,7374],[8742,8742]] },
  { name: "Financial",          icon: "🏦", mccRanges: [[6010,6012],[6051,6051]] },
  { name: "Income",             icon: "💰", mccRanges: [] },
  { name: "Transfer",           icon: "🔄", mccRanges: [] },
  { name: "Other",              icon: "📋", mccRanges: [] },
];

export function mapMccToCategory(mccCode: string): string {
  const code = parseInt(mccCode, 10);
  if (isNaN(code) || code === 0) return "Other";
  for (const cat of CATEGORY_DEFINITIONS) {
    for (const [start, end] of cat.mccRanges) {
      if (code >= start && code <= end) return cat.name;
    }
  }
  return "Other";
}

export interface CategorizationResult {
  description: string;
  merchantName: string;
  mccCode: string;
  mccLabel: string;
  category: string;
}

const fallback = (description: string): CategorizationResult => ({
  description,
  merchantName: description,
  mccCode: "0000",
  mccLabel: "Uncategorized",
  category: "Other",
});

export function buildCategorizationPrompt(descriptions: string[]): string {
  return `You are a financial transaction categorizer. For each merchant description below, infer the most likely ISO 18245 Merchant Category Code (MCC) and clean merchant name.

Return ONLY a valid JSON array with exactly ${descriptions.length} objects in the same order as input. No markdown, no commentary.

Required shape:
[{ "description": "original", "merchantName": "Clean Name", "mccCode": "4-digit string", "mccLabel": "MCC label" }]

Rules:
- merchantName: clean abbreviations (SQ* → Square, AMZN → Amazon, PAYPAL → PayPal), strip transaction IDs
- mccCode: 4-digit string (use "0000" if unknown)
- mccLabel: human-readable label for the MCC

Input descriptions:
${JSON.stringify(descriptions)}`;
}

export async function categorizeBatch(descriptions: string[]): Promise<CategorizationResult[]> {
  if (descriptions.length === 0) return [];

  try {
    const health = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("not reachable");
  } catch {
    console.warn("[statement-categorization.service] Ollama not reachable — using fallback categories.");
    return descriptions.map(fallback);
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: buildCategorizationPrompt(descriptions) }],
      stream: false,
      options: { temperature: 0.1, num_predict: 8192 },
    }),
  });

  if (!response.ok) {
    console.warn(`[statement-categorization.service] Ollama failed (${response.status}) — using fallback.`);
    return descriptions.map(fallback);
  }

  const data = await response.json() as { message?: { content?: string } };
  const content = data.message?.content ?? "";
  const raw = content.replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return descriptions.map(fallback);

  let parsed: unknown;
  try { parsed = JSON.parse(jsonMatch[0]); } catch { return descriptions.map(fallback); }
  if (!Array.isArray(parsed)) return descriptions.map(fallback);

  return descriptions.map((desc, i) => {
    const item = (parsed as Array<Partial<CategorizationResult>>)[i];
    if (!item?.mccCode) return fallback(desc);
    return {
      description: desc,
      merchantName: item.merchantName ?? desc,
      mccCode: item.mccCode,
      mccLabel: item.mccLabel ?? "Unknown",
      category: mapMccToCategory(item.mccCode),
    };
  });
}
