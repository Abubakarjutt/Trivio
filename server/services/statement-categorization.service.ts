/**
 * StatementCategorizationService
 *
 * Uses the Gemini API to categorise transactions by category name rather than
 * by MCC code — much more reliable than asking a model to recall ISO 18245
 * MCC codes.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  CATEGORY_DEFINITIONS,
  CATEGORY_NAMES,
  CATEGORY_GROUPS,
} from "@/lib/categories"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      temperature: 1,
      messages: [{ role: "user", content: buildCategorizationPrompt(descriptions) }],
    });

    const content = message.content.find((b) => b.type === "text")?.text ?? "";
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
    console.warn("[statement-categorization.service] Claude request failed — using fallback.", err);
    return descriptions.map(fallback);
  }
}

// Re-export CATEGORY_DEFINITIONS for backwards compat with existing imports
export { CATEGORY_DEFINITIONS } from "@/lib/categories";
export type { CategoryDefinition } from "@/lib/categories";
export { mapMccToCategory } from "@/lib/categories";
