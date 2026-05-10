import { type PrismaClient, type AuditAction } from "@prisma/client";

export async function writeAuditLog(
  db: PrismaClient,
  params: {
    organisationId: string;
    userId: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  }
) {
  await db.auditLog.create({
    data: {
      organisationId: params.organisationId,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before ? (params.before as object) : undefined,
      after: params.after ? (params.after as object) : undefined,
    },
  });
}
