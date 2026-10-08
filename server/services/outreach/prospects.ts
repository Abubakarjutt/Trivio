// Prospect storage and the stage machine's side effects. Port of linkedin-outreach/outreach/leads.py,
// voice.py, caps.cap_status and pipeline.apply_event(s). Every query is scoped by organisation.
import type { OutreachProspect, Prisma, PrismaClient } from "@prisma/client";
import { capStatusFrom, capWindows, type CapStatus } from "./caps";
import type { OutreachConfig } from "./config";
import { linkCrmLead, tryStartPilot, type Actor } from "./crm-handoff";
import { transition } from "./pipeline";
import { scoreSignals } from "./scoring";
import {
  NotFoundError,
  OutreachError,
  type Draft,
  type DraftKind,
  type Signal,
  type Stage,
  type Weights,
} from "./types";
import { anonymize, VOICE_EVENTS } from "./voice";

type Tx = Prisma.TransactionClient;

export type ProspectInput = {
  profileUrl: string;
  name: string;
  title: string;
  company: string;
  companyWebsite: string | null;
  companySize: string | null;
  location: string | null;
  profileText: string;
  stack: string[];
  signals: Signal[];
  enrichmentStatus: string;
};

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// meta must never contain personal data: events survive prospect deletion.
export async function recordEvent(
  tx: Tx,
  orgId: string,
  prospectId: string | null,
  kind: string,
  now: Date,
  meta: Record<string, unknown> = {}
): Promise<void> {
  await tx.outreachEvent.create({
    data: {
      organisationId: orgId,
      prospectId,
      kind,
      at: now,
      meta: meta as Prisma.InputJsonObject,
    },
  });
}

export async function isDnc(
  db: PrismaClient | Tx,
  orgId: string,
  profileUrl: string
): Promise<boolean> {
  const row = await db.outreachDnc.findUnique({
    where: { organisationId_profileUrl: { organisationId: orgId, profileUrl } },
  });
  return row !== null;
}

export async function saveProspect(
  db: PrismaClient,
  orgId: string,
  input: ProspectInput,
  weights: Weights,
  now: Date
): Promise<{ id: string; created: boolean }> {
  if (await isDnc(db, orgId, input.profileUrl))
    throw new OutreachError("This person is on your do-not-contact list.");
  const score = scoreSignals(input.signals, weights);
  const fields = {
    name: input.name,
    title: input.title,
    company: input.company,
    companyWebsite: input.companyWebsite,
    companySize: input.companySize,
    location: input.location,
    profileText: input.profileText,
    stack: input.stack,
    signals: input.signals as Prisma.InputJsonArray,
    score: score.score,
    primarySignal: score.primary?.name ?? null,
    scoreReasons: score.reasons,
    enrichmentStatus: input.enrichmentStatus,
  };
  return db.$transaction(async (tx) => {
    const existing = await tx.outreachProspect.findUnique({
      where: { organisationId_profileUrl: { organisationId: orgId, profileUrl: input.profileUrl } },
      select: { id: true },
    });
    if (existing) {
      await tx.outreachProspect.update({ where: { id: existing.id }, data: fields });
      await recordEvent(tx, orgId, existing.id, "refreshed", now, { score: score.score });
      return { id: existing.id, created: false };
    }
    const created = await tx.outreachProspect.create({
      data: {
        ...fields,
        organisationId: orgId,
        profileUrl: input.profileUrl,
        stage: "QUEUED",
        stageChangedAt: now,
        source: `Sales Navigator, manual capture, ${localDate(now)}`,
      },
      select: { id: true },
    });
    await recordEvent(tx, orgId, created.id, "created", now, {
      score: score.score,
      primarySignal: fields.primarySignal,
    });
    return { id: created.id, created: true };
  });
}

export async function capStatus(
  db: PrismaClient,
  orgId: string,
  now: Date,
  config: OutreachConfig
): Promise<CapStatus> {
  const { dayStart, weekStart } = capWindows(now);
  const count = (since: Date) =>
    db.outreachEvent.count({
      where: { organisationId: orgId, kind: "request_sent", at: { gte: since } },
    });
  const today = await count(dayStart);
  const week = await count(weekStart);
  return capStatusFrom(today, week, config.dailyCap, config.weeklyCap);
}

export async function getProspect(
  db: PrismaClient | Tx,
  orgId: string,
  id: string
): Promise<OutreachProspect> {
  const p = await db.outreachProspect.findFirst({ where: { id, organisationId: orgId } });
  if (!p) throw new NotFoundError("Prospect not found.");
  return p;
}

/** getProspect for AI work: nothing is drafted or analysed for a do-not-contact person. */
export async function getContactableProspect(
  db: PrismaClient | Tx,
  orgId: string,
  id: string
): Promise<OutreachProspect> {
  const p = await getProspect(db, orgId, id);
  if (p.stage === "DNC") throw new OutreachError("This person is on your do-not-contact list.");
  return p;
}

export async function saveVoiceExample(
  tx: PrismaClient | Tx,
  orgId: string,
  prospectId: string | null,
  name: string | null,
  kind: string,
  text: string,
  now: Date
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const body = name ? anonymize(trimmed, name) : trimmed;
  await tx.outreachVoiceExample.create({
    data: { organisationId: orgId, prospectId, kind, body, createdAt: now },
  });
}

export async function applyEvent(
  db: PrismaClient,
  actor: Actor,
  id: string,
  event: string,
  now: Date,
  config: OutreachConfig,
  opts: { sentText?: string | null } = {}
): Promise<{ stage: Stage; handoffError: string | null }> {
  const { orgId } = actor;
  const p = await getProspect(db, orgId, id);
  if (event === "request_sent" && (await capStatus(db, orgId, now, config)).remaining <= 0) {
    throw new OutreachError("Connection request cap reached. Try again tomorrow (or next week).");
  }
  const updates = transition(p, event, now);
  const stage = updates.stage ?? p.stage;
  await db.$transaction(async (tx) => {
    const res = await tx.outreachProspect.updateMany({
      where: { id, organisationId: orgId, stage: p.stage, updatedAt: p.updatedAt },
      data: updates,
    });
    if (res.count === 0)
      throw new OutreachError("This prospect changed in another window. Reload and try again.");
    await recordEvent(tx, orgId, id, event, now, { from: p.stage, to: stage });
    if (event === "teardown_booked") await linkCrmLead(tx, orgId, { ...p, ...updates });
    if (opts.sentText && (VOICE_EVENTS as readonly string[]).includes(event)) {
      await saveVoiceExample(tx, orgId, id, p.name, event, opts.sentText, now);
    }
  });
  // After the commit: a CRM failure must never undo the stage change.
  const handoffError = event === "pilot_started" ? await tryStartPilot(db, actor, id) : null;
  return { stage, handoffError };
}

export async function applyEvents(
  db: PrismaClient,
  actor: Actor,
  id: string,
  events: string[],
  now: Date,
  config: OutreachConfig
): Promise<{
  stage: Stage | null;
  applied: string[];
  error: string | null;
  handoffError: string | null;
}> {
  const applied: string[] = [];
  let stage: Stage | null = null;
  let handoffError: string | null = null;
  for (const event of events) {
    try {
      const result = await applyEvent(db, actor, id, event, now, config);
      stage = result.stage;
      handoffError = result.handoffError ?? handoffError;
      applied.push(event);
    } catch (e) {
      if (!(e instanceof OutreachError)) throw e;
      return { stage, applied, error: `Stopped at “${event}”: ${e.message}`, handoffError };
    }
  }
  return { stage, applied, error: null, handoffError };
}

async function addDnc(tx: Tx, orgId: string, profileUrl: string, reason: string, now: Date) {
  await tx.outreachDnc.upsert({
    where: { organisationId_profileUrl: { organisationId: orgId, profileUrl } },
    create: { organisationId: orgId, profileUrl, reason, addedAt: now },
    update: {},
  });
}

export async function markDnc(db: PrismaClient, orgId: string, id: string, now: Date) {
  const p = await getProspect(db, orgId, id);
  await db.$transaction(async (tx) => {
    await addDnc(tx, orgId, p.profileUrl, "asked not to be contacted", now);
    await tx.outreachProspect.updateMany({
      where: { id, organisationId: orgId },
      data: { stage: "DNC", stageChangedAt: now, awaitingReply: false },
    });
    await tx.outreachDraft.deleteMany({ where: { organisationId: orgId, prospectId: id } });
    await recordEvent(tx, orgId, id, "dnc", now, { from: p.stage });
  });
  return { crmLeadId: p.crmLeadId, crmDealId: p.crmDealId };
}

export async function deleteProspect(db: PrismaClient, orgId: string, id: string, now: Date) {
  const p = await getProspect(db, orgId, id);
  await db.$transaction(async (tx) => {
    await addDnc(tx, orgId, p.profileUrl, "deleted on request", now);
    await tx.outreachProspect.deleteMany({ where: { id, organisationId: orgId } });
    await recordEvent(tx, orgId, null, "deleted", now);
  });
  return { crmLeadId: p.crmLeadId, crmDealId: p.crmDealId };
}

export async function recentVoice(db: PrismaClient, orgId: string, limit = 8): Promise<string[]> {
  const rows = await db.outreachVoiceExample.findMany({
    where: { organisationId: orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { body: true },
  });
  return rows.map((r) => r.body);
}

export async function saveDrafts(
  db: PrismaClient,
  orgId: string,
  prospectId: string,
  kind: DraftKind,
  drafts: Draft[]
) {
  await db.$transaction(async (tx) => {
    await tx.outreachDraft.deleteMany({ where: { organisationId: orgId, prospectId, kind } });
    await tx.outreachDraft.createMany({
      data: drafts.map((d) => ({
        organisationId: orgId,
        prospectId,
        kind,
        variant: d.variant,
        body: d.body,
        violations: d.violations,
      })),
    });
  });
}

export async function saveConversation(
  db: PrismaClient,
  orgId: string,
  prospectId: string,
  thread: string,
  analysis: unknown
) {
  await db.$transaction(async (tx) => {
    await tx.outreachConversation.deleteMany({ where: { organisationId: orgId, prospectId } });
    await tx.outreachConversation.create({
      data: {
        organisationId: orgId,
        prospectId,
        thread,
        analysis: analysis as Prisma.InputJsonValue,
      },
    });
  });
}

export async function saveDoc(
  db: PrismaClient,
  orgId: string,
  prospectId: string,
  kind: "TEARDOWN_PREP" | "PROPOSAL",
  body: Prisma.InputJsonValue
) {
  await db.outreachDoc.upsert({
    where: { prospectId_kind: { prospectId, kind } },
    create: { organisationId: orgId, prospectId, kind, body },
    update: { body },
  });
}
