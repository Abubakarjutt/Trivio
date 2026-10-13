// An organisation's Outreach settings, parsed. No row means Outreach isn't set up yet.
import type { PrismaClient } from "@prisma/client";
import { SEARCH_ENGINES, type SearchEngine } from "./search";
import {
  CadenceSchema,
  DEFAULT_CADENCE,
  DEFAULT_WEIGHTS,
  OutreachError,
  WeightsSchema,
  type Cadence,
  type Weights,
} from "./types";

export type OutreachConfig = {
  sellerProfile: string;
  weights: Weights;
  cadence: Cadence;
  dailyCap: number;
  weeklyCap: number;
  hiringKeywords: string[];
};

export async function loadConfig(db: PrismaClient, orgId: string): Promise<OutreachConfig | null> {
  const s = await db.outreachSettings.findUnique({ where: { organisationId: orgId } });
  if (!s) return null;
  return {
    sellerProfile: s.sellerProfile,
    weights: WeightsSchema.catch(DEFAULT_WEIGHTS).parse(s.signalWeights),
    cadence: CadenceSchema.catch(DEFAULT_CADENCE).parse(s.cadence),
    dailyCap: s.dailyCap,
    weeklyCap: s.weeklyCap,
    hiringKeywords: s.hiringKeywords,
  };
}

export async function requireConfig(db: PrismaClient, orgId: string): Promise<OutreachConfig> {
  const config = await loadConfig(db, orgId);
  if (!config)
    throw new OutreachError("Set up Outreach first: describe what you sell in Outreach settings.");
  return config;
}

export type SearchKeys = Record<SearchEngine, string | null>;

/** The saved search keys (null when unset). Never send them to the client. */
export async function loadSearchKeys(db: PrismaClient, orgId: string): Promise<SearchKeys> {
  const s = await db.outreachSettings.findUnique({
    where: { organisationId: orgId },
    select: { searchApiKey: true, tavilyApiKey: true },
  });
  return { tavily: s?.tavilyApiKey || null, brave: s?.searchApiKey || null };
}

/** The searches research may use, in order: Tavily first, then Brave as the fallback. */
export function searchOrder(keys: SearchKeys): { engine: SearchEngine; apiKey: string }[] {
  return SEARCH_ENGINES.flatMap((engine) => {
    const apiKey = keys[engine];
    return apiKey ? [{ engine, apiKey }] : [];
  });
}
