import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { organisationId: true } });
  if (!user?.organisationId) return NextResponse.json({ error: "No organisation" }, { status: 403 });
  const organisationId = user.organisationId;

  const { batchId } = await params;
  const skip = request.nextUrl.searchParams.get("skip") === "true";

  const batch = await db.statementImportBatch.findFirst({
    where: { id: batchId, organisationId },
    select: { id: true, pendingDuplicatesJson: true },
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  let skipped = 0;
  if (skip) {
    // User chose to skip duplicates — they were never inserted, just count them from the JSON column
    const stored = batch.pendingDuplicatesJson as { description: string }[] | null;
    skipped = stored?.length ?? 0;
  } else {
    // User chose "import all" — insert the pending duplicates that were held back
    const stored = batch.pendingDuplicatesJson as {
      date: string; description: string; merchantName: string; amount: number;
      type: string; category: string; mccCode: string; mccLabel: string;
    }[] | null;
    if (stored && stored.length > 0) {
      await db.statementTransaction.createMany({
        data: stored.map((d) => ({
          organisationId,
          importBatchId: batchId,
          date: new Date(d.date),
          description: d.description,
          merchantName: d.merchantName,
          amount: d.amount,
          type: d.type as "DEBIT" | "CREDIT",
          category: d.category,
          mccCode: d.mccCode,
          mccLabel: d.mccLabel,
        })),
      });
    }
  }

  const count = await db.statementTransaction.count({ where: { importBatchId: batchId, organisationId } });
  await db.statementImportBatch.update({
    where: { id: batchId },
    data: { status: "DONE", transactionCount: count, pendingDuplicatesJson: Prisma.JsonNull },
  });

  return NextResponse.json({ status: "done", batchId, count, skipped });
}
