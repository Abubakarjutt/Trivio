// Imports the user's seller.md (from the retired Python app) into an organisation's Outreach setup.
import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_CADENCE,
  DEFAULT_HIRING_KEYWORDS,
  DEFAULT_WEIGHTS,
  OutreachError,
  type SignalName,
} from "./types";

const HEADING = /^#{1,6}\s+(.*)$/;
const TOP_LEVEL_BULLET = /^[-*]\s+(.*)$/;
const ANY_BULLET = /^\s*[-*]\s+(.*)$/;

export function parseSellerMarkdown(md: string): { profile: string; voiceExamples: string[] } {
  const kept: string[] = [];
  const voiceExamples: string[] = [];
  let inVoice = false;
  let currentExample = "";

  const lines = md.replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      // Flush current example if we're entering/leaving voice section
      if (inVoice && currentExample) {
        voiceExamples.push(currentExample.trim());
        currentExample = "";
      }
      inVoice = /^voice examples\b/i.test(heading[1].trim());
      if (!inVoice) {
        kept.push(line);
      }
      continue;
    }

    if (!inVoice) {
      kept.push(line);
      continue;
    }

    // We're in the voice section
    if (line.trim() === "") {
      // Blank line ends current example
      if (currentExample) {
        voiceExamples.push(currentExample.trim());
        currentExample = "";
      }
      continue;
    }

    const topBullet = TOP_LEVEL_BULLET.exec(line);
    if (topBullet) {
      // Top-level bullet starts a new example
      if (currentExample) {
        voiceExamples.push(currentExample.trim());
      }
      currentExample = topBullet[1].trim();
      continue;
    }

    // Check if this line is indented (continuation or nested bullet)
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (currentExample) {
        // Append indented line to current example
        const anyBullet = ANY_BULLET.exec(line);
        const content = anyBullet ? anyBullet[1].trim() : line.trim();
        currentExample += "\n" + content;
      }
      continue;
    }

    // Unindented non-bullet line: flush current example and drop the line
    // (don't add to profile, section continues until next heading)
    if (currentExample) {
      voiceExamples.push(currentExample.trim());
      currentExample = "";
    }
    // Drop the line, don't add it to kept
    continue;
  }

  // Flush any remaining example at EOF
  if (currentExample) {
    voiceExamples.push(currentExample.trim());
  }

  return {
    profile: kept
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    voiceExamples,
  };
}

export const SEED_OFFERS: { name: string; description: string; fittingSignals: SignalName[] }[] = [
  {
    name: "RAG Audit + Eval Harness",
    description:
      "Audit the retrieval pipeline, build an eval harness that grades answers, and fix the worst failure modes first.",
    fittingSignals: ["pain_post", "stack_match", "hiring"],
  },
  {
    name: "Agent Reliability Sprint",
    description:
      "Harden an agent loop: tool-call failures, retries, timeouts, cost limits and evals, from demo to production.",
    fittingSignals: ["demo_stage", "pain_post", "hiring"],
  },
];

export async function seedOutreach(
  db: PrismaClient,
  orgId: string,
  md: string,
  now: Date
): Promise<{ settings: "created" | "updated"; offersCreated: number; examplesCreated: number }> {
  const { profile, voiceExamples } = parseSellerMarkdown(md);
  if (!profile)
    throw new OutreachError("seller.md has no profile text outside the Voice examples section.");

  const existing = await db.outreachSettings.findUnique({ where: { organisationId: orgId } });
  await db.outreachSettings.upsert({
    where: { organisationId: orgId },
    create: {
      organisationId: orgId,
      sellerProfile: profile,
      signalWeights: DEFAULT_WEIGHTS,
      cadence: DEFAULT_CADENCE,
      dailyCap: 20,
      weeklyCap: 100,
      hiringKeywords: DEFAULT_HIRING_KEYWORDS,
    },
    // Only the profile is refreshed, so weights and limits tuned in the app survive a re-run.
    update: { sellerProfile: profile },
  });

  let offersCreated = 0;
  for (const offer of SEED_OFFERS) {
    if (await db.outreachOffer.findFirst({ where: { organisationId: orgId, name: offer.name } }))
      continue;
    await db.outreachOffer.create({ data: { organisationId: orgId, ...offer, price: null } });
    offersCreated++;
  }

  let examplesCreated = 0;
  for (const body of voiceExamples) {
    if (await db.outreachVoiceExample.findFirst({ where: { organisationId: orgId, body } }))
      continue;
    await db.outreachVoiceExample.create({
      data: { organisationId: orgId, prospectId: null, kind: "seed", body, createdAt: now },
    });
    examplesCreated++;
  }

  return { settings: existing ? "updated" : "created", offersCreated, examplesCreated };
}
