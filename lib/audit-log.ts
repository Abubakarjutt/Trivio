import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

export async function writeAuditLog(params: {
  db: PrismaClient;
  organisationId: string;
  userId: string;
  action: "CREATE" | "UPDATE" | "VOID" | "DELETE" | "EXPORT" | "LOGIN" | "LOGOUT";
  entityType: string;
  entityId?: string;
  after?: Prisma.InputJsonValue;
}) {
  try {
    await params.db.auditLog.create({
      data: {
        organisationId: params.organisationId,
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? "",
        after: params.after,
      },
    });
  } catch {
    // Audit log write failure must never break the main flow
  }
}
