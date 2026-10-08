// One-way handoff from Outreach into Trivio's CRM (spec §4). Outreach creates and links CRM
// records; after the handoff the CRM owns the deal and Outreach never moves or closes it.
import type { OutreachProspect, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { convertLeadToContact } from "@/server/services/crm.service";
import { NotFoundError, OutreachError } from "./types";

export type Actor = { orgId: string; userId: string };
type LinkableProspect = Pick<
  OutreachProspect,
  "id" | "name" | "title" | "company" | "primarySignal" | "score" | "crmLeadId"
>;

export const ProposalDocSchema = z.object({
  offerId: z.string().nullable(),
  offerName: z.string(),
  text: z.string(),
});
export type ProposalDoc = z.infer<typeof ProposalDocSchema>;

export function splitName(name: string): { firstName: string; lastName: string } {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

export async function linkCrmLead(
  tx: Prisma.TransactionClient,
  orgId: string,
  p: LinkableProspect
): Promise<string> {
  if (p.crmLeadId) return p.crmLeadId;
  const { firstName, lastName } = splitName(p.name);
  const companyName = p.company.trim() || null;
  const existing = await tx.crmLead.findFirst({
    where: {
      organisationId: orgId,
      firstName,
      lastName,
      companyName,
      outreachProspect: { is: null },
    },
    select: { id: true },
  });
  const lead =
    existing ??
    (await tx.crmLead.create({
      data: {
        organisationId: orgId,
        firstName,
        lastName,
        companyName,
        jobTitle: p.title.trim() || null,
        source: "COLD_OUTREACH",
        status: "CONTACTED",
        notes: `Added from Outreach. Primary signal: ${p.primarySignal ?? "none"}, score ${p.score}.`,
      },
      select: { id: true },
    }));
  await tx.outreachProspect.update({ where: { id: p.id }, data: { crmLeadId: lead.id } });
  return lead.id;
}

export async function latestProposalOffer(
  db: PrismaClient,
  orgId: string,
  prospectId: string
): Promise<{ name: string; price: Prisma.Decimal | null } | null> {
  const doc = await db.outreachDoc.findFirst({
    where: { organisationId: orgId, prospectId, kind: "PROPOSAL" },
  });
  const body = doc ? ProposalDocSchema.safeParse(doc.body) : null;
  if (!body?.success) return null;
  if (body.data.offerId) {
    const offer = await db.outreachOffer.findFirst({
      where: { id: body.data.offerId, organisationId: orgId },
    });
    if (offer) return { name: offer.name, price: offer.price };
  }
  return { name: body.data.offerName, price: null };
}

export async function startPilotHandoff(
  db: PrismaClient,
  actor: Actor,
  prospectId: string
): Promise<{ dealId: string }> {
  const { orgId } = actor;
  const p = await db.outreachProspect.findFirst({
    where: { id: prospectId, organisationId: orgId },
  });
  if (!p) throw new NotFoundError("Prospect not found.");
  if (p.crmDealId) return { dealId: p.crmDealId };

  const leadId = p.crmLeadId ?? (await db.$transaction((tx) => linkCrmLead(tx, orgId, p)));
  const lead = await db.crmLead.findFirst({ where: { id: leadId, organisationId: orgId } });
  if (!lead) throw new OutreachError("The linked CRM lead is missing. Retry to create a new one.");
  const offer = await latestProposalOffer(db, orgId, p.id);

  if (lead.status === "CONVERTED") {
    // A previous attempt converted the lead but failed before storing the deal: resume it.
    const deal = lead.convertedContactId
      ? await db.crmDeal.findFirst({
          where: { organisationId: orgId, contactId: lead.convertedContactId },
          orderBy: { createdAt: "desc" },
        })
      : null;
    if (!deal || !lead.convertedContactId) {
      throw new OutreachError(
        "This lead is already converted in CRM. Open it there to find the deal."
      );
    }
    await storePilotDeal(db, actor, p, offer, deal.id, lead.convertedContactId, false);
    return { dealId: deal.id };
  }

  await db.crmLead.update({
    where: { id: leadId },
    // Don't clear an estimate the user may have set on a lead that was matched by name.
    data: { status: "QUALIFIED", ...(offer?.price ? { estimatedValue: offer.price } : {}) },
  });
  const { contactId, dealId } = await convertLeadToContact(db, leadId, orgId);
  await storePilotDeal(db, actor, p, offer, dealId, contactId, true);
  return { dealId };
}

async function storePilotDeal(
  db: PrismaClient,
  { orgId, userId }: Actor,
  p: Pick<OutreachProspect, "id" | "name" | "company">,
  offer: { name: string; price: Prisma.Decimal | null } | null,
  dealId: string,
  contactId: string,
  updateDeal: boolean
): Promise<void> {
  await db.$transaction(async (tx) => {
    // Only the deal this handoff just created is renamed and priced; a resumed deal may be the user's.
    if (updateDeal) {
      await tx.crmDeal.update({
        where: { id: dealId },
        data: {
          name: `${offer?.name ?? "Pilot"} — ${p.company.trim() || p.name}`,
          value: offer?.price ?? 0,
          source: "Outreach",
        },
      });
    }
    await tx.crmActivity.create({
      data: {
        organisationId: orgId,
        type: "NOTE",
        subject: "Pilot started via Outreach",
        dealId,
        contactId,
        createdById: userId,
      },
    });
    await tx.outreachProspect.update({ where: { id: p.id }, data: { crmDealId: dealId } });
  });
}

/** Runs the pilot handoff and turns any failure into the message the CRM card shows. */
export async function tryStartPilot(
  db: PrismaClient,
  actor: Actor,
  prospectId: string
): Promise<string | null> {
  try {
    await startPilotHandoff(db, actor, prospectId);
    return null;
  } catch (e) {
    if (e instanceof OutreachError) return e.message;
    if (e instanceof Error && e.message.startsWith("No pipeline with stages"))
      return "Not in CRM yet: create a pipeline first.";
    console.error("[outreach] CRM handoff failed", e);
    return "Not in CRM yet: something went wrong. Retry from the prospect page.";
  }
}
