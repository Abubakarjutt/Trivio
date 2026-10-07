import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { todayForOrg } from "@/server/services/outreach/today-service";
import { DEFAULT_CADENCE, DEFAULT_WEIGHTS } from "@/server/services/outreach/types";
import { makeDb, makeProspect, NOW } from "./helpers";

process.env.TZ = "UTC";
const config = {
  sellerProfile: "S",
  weights: DEFAULT_WEIGHTS,
  cadence: DEFAULT_CADENCE,
  dailyCap: 20,
  weeklyCap: 100,
  hiringKeywords: [],
};

describe("todayForOrg", () => {
  it("loads active prospects by score and attaches the drafts for each action", async () => {
    const db = makeDb();
    db.outreachEvent.count.mockResolvedValue(0);
    const note = { kind: "CONNECTION_NOTE", variant: "A", body: "hi?", violations: [] };
    const value = { kind: "VALUE_MESSAGE", variant: "A", body: "x", violations: [] };
    db.outreachProspect.findMany.mockResolvedValue([{ ...makeProspect(), drafts: [value, note] }]);
    const today = await todayForOrg(db as unknown as PrismaClient, "org-1", NOW, config);
    expect(db.outreachProspect.findMany).toHaveBeenCalledWith({
      where: { organisationId: "org-1", stage: { notIn: ["PILOT", "WON", "LOST", "DNC"] } },
      orderBy: [{ score: "desc" }, { createdAt: "asc" }],
      include: { drafts: { orderBy: { variant: "asc" } } },
    });
    expect(today.caps.remaining).toBe(20);
    const requests = today.buckets.find((b) => b.title === "Connection requests to send")!;
    expect(requests.items).toHaveLength(1);
    expect(requests.items[0].drafts).toEqual([note]);
    expect(requests.items[0].prospect).not.toHaveProperty("profileText");
  });
});
