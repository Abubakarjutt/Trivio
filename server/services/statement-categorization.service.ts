/**
 * StatementCategorizationService
 *
 * Uses the Gemini API to categorise transactions by category name rather than
 * by MCC code — much more reliable than asking a model to recall ISO 18245
 * MCC codes.
 */

import { z } from "zod";
import {
  CATEGORY_DEFINITIONS,
  CATEGORY_NAMES,
  CATEGORY_GROUPS,
} from "@/lib/categories"

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent`;

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

function buildCategoryList(): string {
  return CATEGORY_GROUPS.map(group => {
    const cats = CATEGORY_DEFINITIONS
      .filter(c => c.group === group)
      .map(c => c.name)
    return `${group}: ${cats.join(", ")}`
  }).join("\n")
}

const CATEGORY_LIST = buildCategoryList();

const resultSchema = z.object({
  description: z.string(),
  merchantName: z.string(),
  category: z.enum(CATEGORY_NAMES as readonly [string, ...string[]]),
});

type ParsedResult = z.infer<typeof resultSchema>;

export function buildCategorizationPrompt(descriptions: string[]): string {
  return `You are a bank transaction categorizer. For each transaction description, return the clean merchant name and the best matching category.

Valid categories (pick EXACTLY one per item, copy the name exactly):
${CATEGORY_LIST}

Return ONLY a valid JSON array with exactly ${descriptions.length} objects. No markdown, no commentary.

Shape: [{ "description": "original", "merchantName": "Clean Name", "category": "Category Name" }]

Rules for merchantName:
- Remove transaction IDs, dates, location codes
- Expand abbreviations: AMZN→Amazon, SQ*→Square, WLW→Woolworths, etc.
- Keep the name short and human-readable

Category rules (follow strictly):
- Mobile top-up, mobile credit, airtime recharge, Jazz/Telenor/Zong/Ufone/Warid top-up → "Mobile Top-Up"
- IBFT, online transfer, fund transfer, TT, wire transfer, sent to, received from, Raast → "Transfers"
- Electricity bill, WAPDA, LESCO, MEPCO, FESCO, IESCO, HESCO, GEPCO, QESCO, PESCO, TESCO, SEPCO, gas bill, SSGC, SNGPL, OGDCL → "Electricity & Gas"
- Internet bill, broadband, PTCL, Jazz internet, Zong internet, Nayatel, StormFiber → "Internet & Phone"
- Salary, payroll, monthly pay → "Salary & Employment"
- ATM withdrawal, cash withdrawal → "Other"
- Upwork, Fiverr, Freelancer.com, Toptal, PeoplePerHour, 99designs, freelance platform → "Professional Services"
- Netflix, Spotify, YouTube Premium, Disney+, Apple TV, Hulu, Amazon Prime Video, HBO → "Movies & Streaming"
- ChatGPT, OpenAI, GitHub Copilot, Adobe, Microsoft 365, Google Workspace, Slack, Zoom, Dropbox, Notion, Figma → "Software & Subscriptions"

Input:
${JSON.stringify(descriptions)}`;
}


export async function categorizeBatch(descriptions: string[]): Promise<CategorizationResult[]> {
  if (descriptions.length === 0) return [];

  if (!GEMINI_API_KEY) {
    console.warn("[statement-categorization.service] GEMINI_API_KEY not set — using fallback categories.");
    return descriptions.map(fallback);
  }

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildCategorizationPrompt(descriptions) }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      console.warn(`[statement-categorization.service] Gemini failed (${response.status}) — using fallback.`);
      return descriptions.map(fallback);
    }

    const data = await response.json();
    const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> })?.candidates ?? [];
    const parts = candidates[0]?.content?.parts ?? [];
    const content = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    const raw = content.replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return descriptions.map(fallback);

    let parsed: unknown;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return descriptions.map(fallback); }
    if (!Array.isArray(parsed)) return descriptions.map(fallback);

    return descriptions.map((desc, i) => {
      const item = (parsed as Array<Record<string, unknown>>)[i];
      if (!item) return fallback(desc);

      const validation = resultSchema.safeParse(item);
      if (!validation.success) return fallback(desc);

      const { category, merchantName } = validation.data;
      return {
        description: desc,
        merchantName,
        mccCode: "0000",
        mccLabel: category,
        category,
      };
    });
  } catch (err) {
    console.warn("[statement-categorization.service] Gemini request failed — using fallback.", err);
    return descriptions.map(fallback);
  }
}

// Re-export CATEGORY_DEFINITIONS for backwards compat with existing imports
export { CATEGORY_DEFINITIONS } from "@/lib/categories";
export type { CategoryDefinition } from "@/lib/categories";
export { mapMccToCategory } from "@/lib/categories";
