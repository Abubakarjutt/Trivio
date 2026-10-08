import type { OutreachProspect } from "@prisma/client";
import type { ProspectState } from "@/server/services/outreach/types";

// A Wednesday, so day/week boundary tests have room on both sides.
export const NOW = new Date("2026-10-07T12:00:00Z");
export const DAY = 86_400_000;
export const at = (ms: number) => new Date(NOW.getTime() + ms);

export function makeState(o: Partial<ProspectState> = {}): ProspectState {
  return {
    stage: "QUEUED",
    stageChangedAt: NOW,
    unansweredCount: 0,
    lightTouchDone: false,
    awaitingReply: false,
    lastMessageAt: null,
    lastReplyAt: null,
    lastTouchAt: null,
    ...o,
  };
}

export function makeProspect(o: Partial<OutreachProspect> = {}): OutreachProspect {
  return {
    id: "p1",
    organisationId: "org-1",
    profileUrl: "https://www.linkedin.com/in/jane-doe",
    name: "Jane Doe",
    title: "CTO",
    company: "Acme AI",
    companyWebsite: null,
    companySize: null,
    location: null,
    profileText: "Jane Doe — CTO at Acme AI …",
    stack: [],
    signals: [],
    score: 0,
    primarySignal: null,
    scoreReasons: [],
    enrichmentStatus: "checked",
    source: "test",
    crmLeadId: null,
    crmDealId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...makeState(),
    ...o,
  };
}
