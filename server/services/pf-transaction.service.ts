import type { PrismaClient } from "@prisma/client";

export interface ManualPfTransactionInput {
  date: Date;
  description: string;
  merchantName: string;
  amount: number;
  type: "DEBIT" | "CREDIT";
  category: string;
  mccCode?: string;
  mccLabel?: string;
}

/**
 * Record a manually-entered personal-finance transaction. Shared by the
 * transactions page ("Add Transaction") and the AI chat's add_pf_transaction
 * tool so both paths write identical rows.
 */
export async function createManualPfTransaction(
  db: PrismaClient,
  organisationId: string,
  input: ManualPfTransactionInput
) {
  // Manually-added transactions still need a batch to belong to
  // (importBatchId is required) — reuse a single "Manual entries" batch
  // per organisation instead of creating one per transaction.
  let batch = await db.statementImportBatch.findFirst({
    where: { organisationId, fileType: "MANUAL" },
  });
  if (!batch) {
    batch = await db.statementImportBatch.create({
      data: {
        organisationId,
        filename: "Manual entries",
        fileType: "MANUAL",
        status: "DONE",
      },
    });
  }

  const txn = await db.statementTransaction.create({
    data: {
      organisationId,
      importBatchId: batch.id,
      date: input.date,
      description: input.description,
      merchantName: input.merchantName,
      amount: input.amount,
      type: input.type,
      category: input.category,
      mccCode: input.mccCode ?? "",
      mccLabel: input.mccLabel ?? "",
    },
  });

  await db.statementImportBatch.update({
    where: { id: batch.id },
    data: { transactionCount: { increment: 1 } },
  });

  return txn;
}
