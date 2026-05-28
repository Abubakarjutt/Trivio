import { NextRequest, NextResponse } from "next/server";
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
  });
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  let skipped = 0;
  if (skip) {
    const body = await request.json() as { duplicateIds?: string[] };
    const ids = body.duplicateIds ?? [];
    if (ids.length > 0) {
      await db.statementTransaction.deleteMany({
        where: { id: { in: ids }, importBatchId: batchId, organisationId },
      });
      skipped = ids.length;
    }
  }

  const count = await db.statementTransaction.count({ where: { importBatchId: batchId, organisationId } });
  await db.statementImportBatch.update({ where: { id: batchId }, data: { status: "DONE", transactionCount: count } });

  return NextResponse.json({ status: "done", batchId, count, skipped });
}
