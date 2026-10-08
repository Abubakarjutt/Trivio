// What the model must return for each task. llm.ts turns these into JSON Schema for
// structured output and checks every reply against them.
import { z } from "zod";

// funding is ticked by hand; the model never returns it.
export const EXTRACTABLE_SIGNALS = [
  "hiring",
  "pain_post",
  "demo_stage",
  "stack_match",
  "warm_path",
] as const;

export const ExtractedProfileSchema = z.object({
  name: z.string(),
  title: z.string(),
  company: z.string(),
  companyWebsite: z.string().nullable(),
  companySize: z.string().nullable(),
  location: z.string().nullable(),
  stack: z.array(z.string()),
  signals: z.array(z.object({ name: z.enum(EXTRACTABLE_SIGNALS), evidence: z.string() })),
});
export type ExtractedProfile = z.infer<typeof ExtractedProfileSchema>;

export const DraftPairSchema = z.object({ variantA: z.string(), variantB: z.string() });

export const SUGGESTABLE_EVENTS = [
  "accepted",
  "message_sent",
  "replied",
  "teardown_booked",
  "pilot_started",
  "won",
  "lost",
  "to_nurture",
] as const;

export const ConversationAnalysisSchema = z.object({
  summary: z.string(),
  lastMessageFrom: z.enum(["me", "them"]),
  optedOut: z.boolean(),
  suggestedEvents: z.array(z.enum(SUGGESTABLE_EVENTS)),
  reason: z.string(),
  replyA: z.string().nullable(),
  replyB: z.string().nullable(),
});
export type ConversationAnalysis = z.infer<typeof ConversationAnalysisSchema>;

export const TeardownPrepSchema = z.object({
  likelySetup: z.string(),
  failurePoints: z.array(z.string()),
  questions: z.array(z.string()),
  quickWins: z.array(z.string()),
  offer: z.string(),
  offerReason: z.string(),
});
export type TeardownPrep = z.infer<typeof TeardownPrepSchema>;

export const PilotProposalSchema = z.object({
  title: z.string(),
  problem: z.string(),
  scope: z.array(z.string()),
  deliverables: z.array(z.string()),
  timeline: z.string(),
  successCriteria: z.array(z.string()),
  nextStep: z.string(),
});
export type PilotProposal = z.infer<typeof PilotProposalSchema>;
