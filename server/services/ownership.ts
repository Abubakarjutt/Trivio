// Ids that arrive from the client must point at this organisation's own rows —
// otherwise one tenant could attach another tenant's contact to its invoice and
// then read it back through getById.
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

type Db = Pick<PrismaClient, "contact">;
type CrmDb = Pick<PrismaClient, "contact" | "crmCompany" | "crmDeal" | "crmPipelineStage" | "user">;

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

/**
 * Every CRM reference an input carries must be this organisation's own, and a
 * stage must belong to the pipeline it's used with. Omitted/null refs pass.
 */
export async function assertOwnCrmRefs(
  db: CrmDb,
  organisationId: string,
  refs: {
    contactId?: string | null;
    crmCompanyId?: string | null;
    dealId?: string | null;
    stageId?: string | null;
    pipelineId?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  await assertOwnContact(db, organisationId, refs.contactId);
  if (refs.crmCompanyId) {
    const c = await db.crmCompany.findFirst({
      where: { id: refs.crmCompanyId, organisationId },
      select: { id: true },
    });
    if (!c) throw bad("Company not found");
  }
  if (refs.dealId) {
    const d = await db.crmDeal.findFirst({
      where: { id: refs.dealId, organisationId },
      select: { id: true },
    });
    if (!d) throw bad("Deal not found");
  }
  if (refs.stageId || refs.pipelineId) {
    const stage = refs.stageId
      ? await db.crmPipelineStage.findFirst({
          where: { id: refs.stageId, pipeline: { organisationId } },
          select: { pipelineId: true },
        })
      : null;
    if (refs.stageId && !stage) throw bad("Stage not found");
    if (refs.pipelineId && stage && stage.pipelineId !== refs.pipelineId) {
      throw bad("That stage belongs to a different pipeline");
    }
  }
  if (refs.userId) {
    const u = await db.user.findFirst({
      where: { id: refs.userId, organisationId },
      select: { id: true },
    });
    if (!u) throw bad("User not found");
  }
}

export async function assertOwnContact(
  db: Db,
  organisationId: string,
  contactId: string | null | undefined
): Promise<void> {
  if (!contactId) return;
  const found = await db.contact.findFirst({
    where: { id: contactId, organisationId },
    select: { id: true },
  });
  if (!found) throw new TRPCError({ code: "BAD_REQUEST", message: "Contact not found" });
}
