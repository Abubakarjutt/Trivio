// The AI operations, ported from linkedin-outreach/outreach/{extract,drafts,conversation,teardown,proposal}.py.
// Nothing here saves anything: callers show the result to the person first.
import type { OutreachProspect } from "@prisma/client";
import type { Llm } from "./llm";
import { validSequence, type OutreachEventKind } from "./pipeline";
import {
  conversationPrompt,
  draftPrompt,
  extractPrompt,
  proposalPrompt,
  stripNumbering,
  teardownPrompt,
  type BriefProspect,
  type OfferBrief,
} from "./prompts";
import { checkDraft } from "./rules";
import {
  ConversationAnalysisSchema,
  DraftPairSchema,
  ExtractedProfileSchema,
  PilotProposalSchema,
  TeardownPrepSchema,
  type ConversationAnalysis,
  type ExtractedProfile,
  type PilotProposal,
  type TeardownPrep,
} from "./schemas";
import {
  OutreachError,
  SignalsSchema,
  type Draft,
  type DraftKind,
  type ProspectState,
  type Stage,
} from "./types";

export const MIN_PASTE_CHARS = 200;
export const MIN_THREAD_CHARS = 20;

export function toBrief(p: OutreachProspect): BriefProspect {
  const signals = SignalsSchema.safeParse(p.signals);
  return {
    name: p.name,
    title: p.title,
    company: p.company,
    primarySignal: p.primarySignal,
    stack: p.stack,
    profileText: p.profileText,
    signals: signals.success ? signals.data : [],
  };
}

export async function extractProfile(
  llm: Llm,
  profileText: string,
  seller: string
): Promise<ExtractedProfile> {
  const text = profileText.trim();
  if (text.length < MIN_PASTE_CHARS) {
    throw new OutreachError(
      "That paste is too short. Copy the full profile page (About, Experience, Activity)."
    );
  }
  return llm.generateJson(ExtractedProfileSchema, extractPrompt(text, seller));
}

function checked(kind: DraftKind, pairs: [Draft["variant"], string | null][]): Draft[] {
  return pairs
    .filter(([, body]) => body && body.trim())
    .map(([variant, body]) => ({
      variant,
      body: body!.trim(),
      violations: checkDraft(kind, body!.trim()),
    }));
}

export async function generateDrafts(
  llm: Llm,
  p: BriefProspect,
  kind: DraftKind,
  seller: string,
  voice: string[]
): Promise<Draft[]> {
  const pair = await llm.generateJson(DraftPairSchema, draftPrompt(p, kind, seller, voice), {
    creative: true,
  });
  return checked(kind, [
    ["A", pair.variantA],
    ["B", pair.variantB],
  ]);
}

export function fixSuggestions(stage: Stage, a: ConversationAnalysis): string[] {
  let events: string[] = [...a.suggestedEvents];
  // You can't message on LinkedIn before they accept, so any messages imply acceptance.
  if (
    stage === "REQUEST_SENT" &&
    !events.includes("accepted") &&
    events.some((e) => e === "message_sent" || e === "replied")
  ) {
    events = ["accepted", ...events];
  }
  // They spoke last and are still talking: never park or close the prospect.
  if (a.lastMessageFrom === "them" && !a.optedOut)
    events = events.filter((e) => e !== "to_nurture" && e !== "lost");
  return events;
}

export async function analyzeConversation(
  llm: Llm,
  p: BriefProspect & ProspectState,
  thread: string,
  seller: string,
  voice: string[],
  now: Date
): Promise<{ analysis: ConversationAnalysis; events: OutreachEventKind[]; replies: Draft[] }> {
  const text = thread.trim();
  if (text.length < MIN_THREAD_CHARS)
    throw new OutreachError("Paste the LinkedIn conversation thread first.");
  const analysis = await llm.generateJson(
    ConversationAnalysisSchema,
    conversationPrompt(p, text, seller, voice),
    { creative: true }
  );
  const replies =
    analysis.lastMessageFrom === "them" && !analysis.optedOut
      ? checked("REPLY", [
          ["A", analysis.replyA],
          ["B", analysis.replyB],
        ])
      : [];
  return { analysis, events: validSequence(p, fixSuggestions(p.stage, analysis), now), replies };
}

export async function prepTeardown(
  llm: Llm,
  p: BriefProspect,
  conversation: string | null,
  seller: string,
  offers: OfferBrief[]
): Promise<TeardownPrep> {
  const prep = await llm.generateJson(
    TeardownPrepSchema,
    teardownPrompt(p, conversation, seller, offers)
  );
  // The page numbers the lists itself; drop numbering the model added.
  return {
    ...prep,
    failurePoints: stripNumbering(prep.failurePoints),
    questions: stripNumbering(prep.questions),
    quickWins: stripNumbering(prep.quickWins),
  };
}

export async function draftProposal(
  llm: Llm,
  p: BriefProspect,
  offerName: string,
  callNotes: string,
  conversation: string | null,
  seller: string
): Promise<PilotProposal> {
  return llm.generateJson(
    PilotProposalSchema,
    proposalPrompt(p, offerName, callNotes, conversation, seller)
  );
}
