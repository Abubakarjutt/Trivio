// Shared types for the Outreach feature. Ported from linkedin-outreach/outreach/models.py + config.py.
import { z } from "zod";
import type { OutreachDraftKind, OutreachStage } from "@prisma/client";

export type Stage = OutreachStage;
export type DraftKind = OutreachDraftKind;
export const DRAFT_KINDS = ["CONNECTION_NOTE", "VALUE_MESSAGE", "REPLY"] as const satisfies readonly DraftKind[];

// Order matters: it breaks ties between equal weights (hiring first).
export const SIGNAL_NAMES = ["hiring", "pain_post", "funding", "demo_stage", "warm_path", "stack_match"] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];

export const SignalSchema = z.object({ name: z.enum(SIGNAL_NAMES), evidence: z.string().trim().min(1).max(500) });
export type Signal = z.infer<typeof SignalSchema>;
export const SignalsSchema = z.array(SignalSchema).max(20);

const weight = z.number().int().min(0).max(10);
export const WeightsSchema = z.object({
  hiring: weight, pain_post: weight, funding: weight, demo_stage: weight, warm_path: weight, stack_match: weight,
});
export type Weights = z.infer<typeof WeightsSchema>;
export const DEFAULT_WEIGHTS: Weights = {
  hiring: 3, pain_post: 3, funding: 2, demo_stage: 2, warm_path: 2, stack_match: 1,
};

const days = z.number().int().min(1).max(365);
export const CadenceSchema = z.object({
  withdrawAfter: days, lightTouch: days, secondValue: days,
  nurtureAfterSecond: days, nurtureEvery: days, teardownFollowUp: days,
});
export type Cadence = z.infer<typeof CadenceSchema>;
export const DEFAULT_CADENCE: Cadence = {
  withdrawAfter: 21, lightTouch: 5, secondValue: 7, nurtureAfterSecond: 7, nurtureEvery: 30, teardownFollowUp: 3,
};

export const DEFAULT_HIRING_KEYWORDS = ["ai", "ml", "llm", "genai", "machine learning", "applied ai", "agent"];

// The fields the stage machine reads and writes. A Prisma OutreachProspect satisfies it.
export type ProspectState = {
  stage: Stage;
  stageChangedAt: Date;
  unansweredCount: number;
  lightTouchDone: boolean;
  awaitingReply: boolean;
  lastMessageAt: Date | null;
  lastReplyAt: Date | null;
  lastTouchAt: Date | null;
};

export type Draft = { variant: "A" | "B"; body: string; violations: string[] };

/** A problem the person using Trivio can fix (shown to them as-is). */
export class OutreachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachError";
  }
}

export class NotFoundError extends OutreachError {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
