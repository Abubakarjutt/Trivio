import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import { isGoalComplete } from "@/server/services/easyfinance.service";

export interface ManualPfTransactionInput {
  date: Date;
  description: string;
  merchantName: string;
  amount: number;
  type: "DEBIT" | "CREDIT";
  category: string;
  mccCode?: string;
  mccLabel?: string;
  /** Savings goal this transaction pays into: its amount is added to the goal. */
  goalId?: string;
}

/**
 * Record a manually-entered personal-finance transaction. Shared by the
 * transactions page ("Add Transaction") and the AI chat's add_pf_transaction
 * tool so both paths write identical rows. With a goalId, the transaction
 * and the goal's contribution are saved together or not at all.
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

  return db.$transaction(async (tx) => {
    const txn = await tx.statementTransaction.create({
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
        goalId: input.goalId ?? null,
      },
    });
    if (input.goalId) await addToGoal(tx, organisationId, input.goalId, input.amount);

    await tx.statementImportBatch.update({
      where: { id: batch.id },
      data: { transactionCount: { increment: 1 } },
    });
    return txn;
  });
}

type Tx = Prisma.TransactionClient;

async function addToGoal(tx: Tx, organisationId: string, goalId: string, amount: number) {
  const goal = await tx.goal.findFirst({ where: { id: goalId, organisationId } });
  if (!goal) throw new TRPCError({ code: "NOT_FOUND", message: "That goal doesn't exist." });
  if (goal.status !== "ACTIVE")
    throw new TRPCError({ code: "BAD_REQUEST", message: `"${goal.name}" isn't an active goal.` });
  // Atomic increment: two saves at once must both count.
  const updated = await tx.goal.update({
    where: { id: goal.id },
    data: { currentAmount: { increment: amount } },
  });
  if (isGoalComplete(Number(updated.currentAmount), Number(updated.targetAmount)))
    await tx.goal.update({ where: { id: goal.id }, data: { status: "COMPLETED" } });
}

/**
 * Delete personal-finance transactions, taking any goal contributions back
 * off their goals (never below zero; a completed goal that drops under its
 * target is active again).
 */
export async function deletePfTransactions(
  db: PrismaClient,
  organisationId: string,
  where: Prisma.StatementTransactionWhereInput
) {
  return db.$transaction(async (tx) => {
    const scoped = { ...where, organisationId };
    const linked = await tx.statementTransaction.findMany({
      where: { ...scoped, goalId: { not: null } },
      select: { goalId: true, amount: true },
    });
    const byGoal = new Map<string, Prisma.Decimal>();
    for (const t of linked)
      byGoal.set(t.goalId!, (byGoal.get(t.goalId!) ?? new Prisma.Decimal(0)).add(t.amount));

    for (const [goalId, amount] of byGoal) {
      const updated = await tx.goal.update({
        where: { id: goalId },
        data: { currentAmount: { decrement: amount } },
      });
      const left = Prisma.Decimal.max(updated.currentAmount, 0);
      const reopen =
        updated.status === "COMPLETED" &&
        !isGoalComplete(Number(left), Number(updated.targetAmount));
      if (!left.equals(updated.currentAmount) || reopen)
        await tx.goal.update({
          where: { id: goalId },
          data: { currentAmount: left, ...(reopen && { status: "ACTIVE" }) },
        });
    }
    return tx.statementTransaction.deleteMany({ where: scoped });
  });
}

/**
 * Find the active goal a name (or id) refers to — exact name, then a unique
 * partial match. Throws with the goals there are, so the chat can correct
 * itself.
 */
export async function findActiveGoal(
  db: Pick<PrismaClient, "goal">,
  organisationId: string,
  ref: string
) {
  const goals = await db.goal.findMany({
    where: { organisationId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const wanted = ref.trim().toLowerCase();
  const partial = goals.filter((g) => g.name.toLowerCase().includes(wanted));
  const hit =
    goals.find((g) => g.id === ref.trim()) ??
    goals.find((g) => g.name.toLowerCase() === wanted) ??
    (wanted && partial.length === 1 ? partial[0] : undefined);
  if (hit) return hit;
  throw new Error(
    goals.length
      ? `No active goal "${ref.trim()}". Use one of: ${goals.map((g) => g.name).join("; ")}`
      : `There are no active goals yet — create one first (goals.create) or leave goal out.`
  );
}
