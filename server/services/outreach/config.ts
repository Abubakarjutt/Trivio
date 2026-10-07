// An organisation's Outreach settings, parsed. No row means Outreach isn't set up yet.
import type { PrismaClient } from "@prisma/client";
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
