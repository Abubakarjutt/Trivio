import type { PrismaClient } from "@prisma/client";
import { CATEGORY_NAMES } from "@/lib/categories";

/**
 * Personal Finance categories are the built-in list plus the user's own: every
 * category they budget for ("Petrol", "Stocks/Savings Fund") is a category a
 * transaction can be filed under, so the budget counts it.
 */

const norm = (s: string) => s.trim().toLowerCase();

/** The org's own categories (active budgets' categories not in the built-in list), A→Z. */
export async function ownPfCategories(
  db: Pick<PrismaClient, "budget">,
  organisationId: string
): Promise<string[]> {
  const rows = await db.budget.findMany({
    where: { organisationId, isArchived: false },
    select: { category: true },
  });
  const builtIn = new Set(CATEGORY_NAMES.map(norm));
  const seen = new Set<string>();
  const own: string[] = [];
  for (const { category } of rows) {
    const name = category.trim();
    const key = norm(name);
    if (!name || builtIn.has(key) || seen.has(key)) continue;
    seen.add(key);
    own.push(name);
  }
  return own.sort((a, b) => a.localeCompare(b));
}

/**
 * Snap a category the model (or a paraphrasing user) wrote to a real one:
 * exact match first (the user's own categories, then built-in), then a
 * partial match the same way, else "Other" so the row still saves.
 */
export function resolvePfCategory(raw: unknown, own: string[] = []): string {
  const wanted = norm(String(raw ?? ""));
  if (!wanted) return "Other";
  const exact = (list: readonly string[]) => list.find((c) => norm(c) === wanted);
  const partial = (list: readonly string[]) =>
    wanted.length >= 3 ? list.find((c) => norm(c).includes(wanted)) : undefined;
  return exact(own) ?? exact(CATEGORY_NAMES) ?? partial(own) ?? partial(CATEGORY_NAMES) ?? "Other";
}
