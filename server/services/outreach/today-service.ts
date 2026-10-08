// Loads the Today page for one organisation. Port of the I/O half of linkedin-outreach/outreach/today.py.
import type { PrismaClient } from "@prisma/client";
import type { OutreachConfig } from "./config";
import { capStatus } from "./prospects";
import { buildToday } from "./today";

export async function todayForOrg(
  db: PrismaClient,
  orgId: string,
  now: Date,
  config: OutreachConfig
) {
  const rows = await db.outreachProspect.findMany({
    where: { organisationId: orgId, stage: { notIn: ["PILOT", "WON", "LOST", "DNC"] } },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    include: { drafts: { orderBy: { variant: "asc" } } },
  });
  const caps = await capStatus(db, orgId, now, config);
  const buckets = buildToday(rows, now, config.cadence, caps.remaining).map((b) => ({
    title: b.title,
    items: b.items.map((i) => {
      const { profileText: _omit, drafts, ...prospect } = i.prospect;
      return {
        prospect,
        action: i.action,
        event: i.event,
        draftKind: i.draftKind,
        drafts: i.draftKind ? drafts.filter((d) => d.kind === i.draftKind) : [],
      };
    }),
  }));
  return { caps, buckets };
}
