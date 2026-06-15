import { timingSafeEqual, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/server/routers/gdpr";

function safeCompare(a: string, b: string): boolean {
  // Hash both to equal-length digests so timingSafeEqual doesn't leak the secret length
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  const cronSecret = process.env.CRON_SECRET;
  if (!secret || !cronSecret || !safeCompare(secret, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);

  const orgs = await db.organisation.findMany({ select: { id: true, users: { select: { id: true }, take: 1 } } });

  let totalDeleted = 0;
  for (const org of orgs) {
    const result = await db.chatMessage.deleteMany({
      where: { conversation: { organisationId: org.id }, createdAt: { lt: cutoff } },
    });
    if (result.count > 0 && org.users[0]) {
      totalDeleted += result.count;
      await writeAuditLog({
        db,
        organisationId: org.id,
        userId: org.users[0].id,
        action: "DELETE",
        entityType: "ChatMessage",
        entityId: org.id,
        after: { deletedCount: result.count, reason: "12-month retention policy (automated)" },
      });
    }
  }

  return NextResponse.json({ ok: true, deleted: totalDeleted, orgs: orgs.length, cutoff: cutoff.toISOString() });
}
