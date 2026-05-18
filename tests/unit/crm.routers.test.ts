/**
 * CRM router tests
 *
 * Tests all 5 CRM tRPC routers directly via createCallerFactory with
 * fully mocked Prisma — no DB connection required.
 */

import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createCallerFactory } from "@/server/trpc";
import { crmLeadsRouter } from "@/server/routers/crmLeads";
import { crmCompaniesRouter } from "@/server/routers/crmCompanies";
import { crmDealsRouter } from "@/server/routers/crmDeals";
import { crmActivitiesRouter } from "@/server/routers/crmActivities";
import { crmPipelinesRouter } from "@/server/routers/crmPipelines";

// vi.mock is hoisted — use literals in factory, not variable references
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-crm-test",
        organisation: { id: "org-crm-test", name: "CRM Test Org" },
      }),
    },
  },
}));

const ORG = "org-crm-test";
const USER_ID = "user-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  return {
    session: { user: { id: USER_ID } },
    user: { id: USER_ID, organisationId: ORG, organisation: { id: ORG, name: "CRM Test Org" } },
    db,
    organisationId: ORG,
    organisation: { id: ORG, name: "CRM Test Org" },
  };
}

function dec(n: number) {
  return new Prisma.Decimal(n);
}

// ─── Sample data helpers ──────────────────────────────────────────────────────

const baseLead = {
  id: "lead-1",
  organisationId: ORG,
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: null,
  companyName: "Acme",
  jobTitle: null,
  estimatedValue: dec(5000),
  source: "WEBSITE" as const,
  notes: null,
  status: "NEW" as const,
  assignedToId: null,
  assignedTo: null,
  tags: [],
  convertedAt: null,
  convertedContactId: null,
  convertedContact: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const basePipeline = {
  id: "pipe-1",
  organisationId: ORG,
  name: "Sales",
  isDefault: true,
  stages: [{ id: "stage-1", pipelineId: "pipe-1", name: "New", order: 1, probability: 10, createdAt: new Date(), updatedAt: new Date() }],
  _count: { deals: 0 },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const baseStage = basePipeline.stages[0];

const baseDeal = {
  id: "deal-1",
  organisationId: ORG,
  name: "Enterprise Deal",
  value: dec(10000),
  contactId: "contact-1",
  contact: { id: "contact-1", name: "Jane Doe", email: "jane@example.com", phone: null },
  crmCompanyId: null,
  crmCompany: null,
  pipelineId: "pipe-1",
  pipeline: { id: "pipe-1", name: "Sales" },
  stageId: "stage-1",
  stage: baseStage,
  expectedCloseDate: null,
  probability: 50,
  source: null,
  wonLostReason: null,
  closedAt: null,
  invoiceId: null,
  invoice: null,
  activities: [],
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const baseActivity = {
  id: "act-1",
  organisationId: ORG,
  type: "CALL" as const,
  subject: "Discovery call",
  notes: null,
  dueDate: null,
  completedAt: null,
  contactId: "contact-1",
  contact: { id: "contact-1", name: "Jane Doe" },
  dealId: null,
  deal: null,
  crmCompanyId: null,
  crmCompany: null,
  createdById: USER_ID,
  createdBy: { id: USER_ID, name: "Test User" },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const baseCompany = {
  id: "co-1",
  organisationId: ORG,
  name: "Acme Corp",
  industry: "Tech",
  website: null,
  phone: null,
  address: null,
  size: "SMALL" as const,
  tags: [],
  notes: null,
  linkedContactId: null,
  linkedContact: null,
  deals: [],
  activities: [],
  _count: { deals: 0 },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

// ═══════════════════════════════════════════════════════════════════════════════
// LEADS ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const leadsCaller = createCallerFactory(crmLeadsRouter);

describe("crmLeadsRouter.list", () => {
  it("returns empty array when no leads", async () => {
    const ctx = makeCtx({ crmLead: { findMany: vi.fn().mockResolvedValue([]) } });
    const result = await leadsCaller(ctx).list({});
    expect(result).toEqual([]);
  });

  it("returns leads with status filter", async () => {
    const ctx = makeCtx({ crmLead: { findMany: vi.fn().mockResolvedValue([baseLead]) } });
    const result = await leadsCaller(ctx).list({ status: "NEW" });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("NEW");
  });
});

describe("crmLeadsRouter.get", () => {
  it("returns lead by id", async () => {
    const ctx = makeCtx({ crmLead: { findFirst: vi.fn().mockResolvedValue(baseLead) } });
    const result = await leadsCaller(ctx).get({ id: "lead-1" });
    expect(result.id).toBe("lead-1");
  });

  it("throws NOT_FOUND when lead not in org", async () => {
    const ctx = makeCtx({ crmLead: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(leadsCaller(ctx).get({ id: "bad-id" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("crmLeadsRouter.create", () => {
  it("creates lead with status NEW", async () => {
    const created = { ...baseLead, id: "lead-new" };
    const mock = vi.fn().mockResolvedValue(created);
    const ctx = makeCtx({ crmLead: { create: mock } });
    const result = await leadsCaller(ctx).create({ firstName: "Jane", lastName: "Doe", source: "WEBSITE" });
    expect(mock).toHaveBeenCalledOnce();
    expect(result.id).toBe("lead-new");
  });
});

describe("crmLeadsRouter.update", () => {
  it("updates lead status", async () => {
    const updated = { ...baseLead, status: "CONTACTED" as const };
    const mock = vi.fn().mockResolvedValue(updated);
    const ctx = makeCtx({
      crmLead: { findFirst: vi.fn().mockResolvedValue(baseLead), update: mock },
    });
    const result = await leadsCaller(ctx).update({ id: "lead-1", status: "CONTACTED" });
    expect(result.status).toBe("CONTACTED");
  });

  it("throws NOT_FOUND for unknown lead", async () => {
    const ctx = makeCtx({ crmLead: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(leadsCaller(ctx).update({ id: "bad", status: "CONTACTED" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("crmLeadsRouter.delete", () => {
  it("deletes lead and returns success", async () => {
    const delMock = vi.fn().mockResolvedValue(baseLead);
    const ctx = makeCtx({
      crmLead: { findFirst: vi.fn().mockResolvedValue(baseLead), delete: delMock },
    });
    const result = await leadsCaller(ctx).delete({ id: "lead-1" });
    expect(result.success).toBe(true);
    expect(delMock).toHaveBeenCalledOnce();
  });

  it("throws NOT_FOUND for unknown lead", async () => {
    const ctx = makeCtx({ crmLead: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(leadsCaller(ctx).delete({ id: "bad" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANIES ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const companiesCaller = createCallerFactory(crmCompaniesRouter);

describe("crmCompaniesRouter.list", () => {
  it("returns companies with _count", async () => {
    const ctx = makeCtx({ crmCompany: { findMany: vi.fn().mockResolvedValue([baseCompany]) } });
    const result = await companiesCaller(ctx).list();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Acme Corp");
  });
});

describe("crmCompaniesRouter.create", () => {
  it("creates company", async () => {
    const mock = vi.fn().mockResolvedValue(baseCompany);
    const ctx = makeCtx({ crmCompany: { create: mock } });
    const result = await companiesCaller(ctx).create({ name: "Acme Corp", size: "SMALL" });
    expect(mock).toHaveBeenCalledOnce();
    expect(result.name).toBe("Acme Corp");
  });
});

describe("crmCompaniesRouter.delete", () => {
  it("deletes company", async () => {
    const delMock = vi.fn().mockResolvedValue(baseCompany);
    const ctx = makeCtx({
      crmCompany: { findFirst: vi.fn().mockResolvedValue(baseCompany), delete: delMock },
    });
    const result = await companiesCaller(ctx).delete({ id: "co-1" });
    expect(result.success).toBe(true);
  });

  it("throws NOT_FOUND for unknown company", async () => {
    const ctx = makeCtx({ crmCompany: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(companiesCaller(ctx).delete({ id: "bad" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("crmCompaniesRouter.linkContact", () => {
  it("sets linkedContactId", async () => {
    const updateMock = vi.fn().mockResolvedValue({ ...baseCompany, linkedContactId: "contact-1" });
    const ctx = makeCtx({
      crmCompany: { findFirst: vi.fn().mockResolvedValue(baseCompany), update: updateMock },
    });
    const result = await companiesCaller(ctx).linkContact({ id: "co-1", contactId: "contact-1" });
    expect(result.linkedContactId).toBe("contact-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEALS ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const dealsCaller = createCallerFactory(crmDealsRouter);

describe("crmDealsRouter.list", () => {
  it("returns open deals", async () => {
    const ctx = makeCtx({ crmDeal: { findMany: vi.fn().mockResolvedValue([baseDeal]) } });
    const result = await dealsCaller(ctx).list({});
    expect(result).toHaveLength(1);
  });
});

describe("crmDealsRouter.get", () => {
  it("returns deal by id", async () => {
    const ctx = makeCtx({ crmDeal: { findFirst: vi.fn().mockResolvedValue(baseDeal) } });
    const result = await dealsCaller(ctx).get({ id: "deal-1" });
    expect(result.id).toBe("deal-1");
  });

  it("throws NOT_FOUND for unknown deal", async () => {
    const ctx = makeCtx({ crmDeal: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(dealsCaller(ctx).get({ id: "bad" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("crmDealsRouter.create", () => {
  it("creates deal with auto-suggested probability", async () => {
    const createMock = vi.fn().mockResolvedValue(baseDeal);
    const ctx = makeCtx({
      crmDeal: { create: createMock },
      crmPipelineStage: {
        findUnique: vi.fn().mockResolvedValue(baseStage),
        count: vi.fn().mockResolvedValue(3),
      },
    });
    await dealsCaller(ctx).create({
      name: "Enterprise Deal",
      value: 10000,
      contactId: "contact-1",
      pipelineId: "pipe-1",
      stageId: "stage-1",
    });
    expect(createMock).toHaveBeenCalledOnce();
    const callData = createMock.mock.calls[0][0].data;
    // probability should be auto-suggested (1/3 * 100 = 33)
    expect(callData.probability).toBe(33);
  });

  it("uses provided probability when given", async () => {
    const createMock = vi.fn().mockResolvedValue(baseDeal);
    const ctx = makeCtx({
      crmDeal: { create: createMock },
      crmPipelineStage: {
        findUnique: vi.fn().mockResolvedValue(baseStage),
        count: vi.fn().mockResolvedValue(3),
      },
    });
    await dealsCaller(ctx).create({
      name: "Enterprise Deal",
      value: 10000,
      contactId: "contact-1",
      pipelineId: "pipe-1",
      stageId: "stage-1",
      probability: 75,
    });
    expect(createMock.mock.calls[0][0].data.probability).toBe(75);
  });
});

describe("crmDealsRouter.close", () => {
  it("marks deal won with probability 100", async () => {
    const terminalStage = { id: "stage-2", pipelineId: "pipe-1", order: 2 };
    const updateMock = vi.fn().mockResolvedValue({ ...baseDeal, closedAt: new Date(), probability: 100 });
    const ctx = makeCtx({
      crmDeal: { findFirst: vi.fn().mockResolvedValue(baseDeal), update: updateMock },
      crmPipelineStage: { findFirst: vi.fn().mockResolvedValue(terminalStage) },
    });
    await dealsCaller(ctx).close({ id: "deal-1", outcome: "WON", reason: "Contract signed" });
    const updateData = updateMock.mock.calls[0][0].data;
    expect(updateData.probability).toBe(100);
    expect(updateData.wonLostReason).toBe("Contract signed");
  });

  it("marks deal lost with probability 0", async () => {
    const terminalStage = { id: "stage-2", pipelineId: "pipe-1", order: 2 };
    const updateMock = vi.fn().mockResolvedValue({ ...baseDeal, closedAt: new Date(), probability: 0 });
    const ctx = makeCtx({
      crmDeal: { findFirst: vi.fn().mockResolvedValue(baseDeal), update: updateMock },
      crmPipelineStage: { findFirst: vi.fn().mockResolvedValue(terminalStage) },
    });
    await dealsCaller(ctx).close({ id: "deal-1", outcome: "LOST" });
    expect(updateMock.mock.calls[0][0].data.probability).toBe(0);
  });
});

describe("crmDealsRouter.delete", () => {
  it("deletes deal without invoice", async () => {
    const delMock = vi.fn().mockResolvedValue(baseDeal);
    const ctx = makeCtx({
      crmDeal: { findFirst: vi.fn().mockResolvedValue({ ...baseDeal, invoiceId: null }), delete: delMock },
    });
    const result = await dealsCaller(ctx).delete({ id: "deal-1" });
    expect(result.success).toBe(true);
  });

  it("throws BAD_REQUEST when deal has linked invoice", async () => {
    const ctx = makeCtx({
      crmDeal: { findFirst: vi.fn().mockResolvedValue({ ...baseDeal, invoiceId: "inv-1" }) },
    });
    await expect(dealsCaller(ctx).delete({ id: "deal-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("crmDealsRouter.forecast", () => {
  it("returns weighted forecast for open deals", async () => {
    // Use local-time constructor to avoid UTC midnight shifting month
    const deal = { ...baseDeal, value: dec(10000), probability: 50, expectedCloseDate: new Date(2026, 6, 1) }; // July 1 local
    const ctx = makeCtx({ crmDeal: { findMany: vi.fn().mockResolvedValue([deal]) } });
    const result = await dealsCaller(ctx).forecast();
    expect(result).toHaveLength(1);
    expect(result[0].month).toBe("2026-07");
    expect(result[0].weightedValue).toBe(5000);
  });

  it("returns empty array when no open deals with close dates", async () => {
    const ctx = makeCtx({ crmDeal: { findMany: vi.fn().mockResolvedValue([baseDeal]) } }); // no expectedCloseDate
    const result = await dealsCaller(ctx).forecast();
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITIES ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const activitiesCaller = createCallerFactory(crmActivitiesRouter);

describe("crmActivitiesRouter.list", () => {
  it("returns activities", async () => {
    const ctx = makeCtx({ crmActivity: { findMany: vi.fn().mockResolvedValue([baseActivity]) } });
    const result = await activitiesCaller(ctx).list({});
    expect(result).toHaveLength(1);
  });
});

describe("crmActivitiesRouter.create", () => {
  it("creates activity with createdById from session", async () => {
    const createMock = vi.fn().mockResolvedValue(baseActivity);
    const ctx = makeCtx({ crmActivity: { create: createMock } });
    await activitiesCaller(ctx).create({ type: "CALL", subject: "Discovery call" });
    const data = createMock.mock.calls[0][0].data;
    expect(data.createdById).toBe(USER_ID);
    expect(data.type).toBe("CALL");
  });
});

describe("crmActivitiesRouter.update", () => {
  it("marks activity complete by setting completedAt", async () => {
    const updateMock = vi.fn().mockResolvedValue({ ...baseActivity, completedAt: new Date() });
    const ctx = makeCtx({
      crmActivity: { findFirst: vi.fn().mockResolvedValue(baseActivity), update: updateMock },
    });
    const now = new Date().toISOString();
    await activitiesCaller(ctx).update({ id: "act-1", completedAt: now });
    const data = updateMock.mock.calls[0][0].data;
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it("throws NOT_FOUND for unknown activity", async () => {
    const ctx = makeCtx({ crmActivity: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(activitiesCaller(ctx).update({ id: "bad" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("crmActivitiesRouter.delete", () => {
  it("deletes activity", async () => {
    const delMock = vi.fn().mockResolvedValue(baseActivity);
    const ctx = makeCtx({
      crmActivity: { findFirst: vi.fn().mockResolvedValue(baseActivity), delete: delMock },
    });
    const result = await activitiesCaller(ctx).delete({ id: "act-1" });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINES ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

const pipelinesCaller = createCallerFactory(crmPipelinesRouter);

describe("crmPipelinesRouter.list", () => {
  it("returns pipelines with stages", async () => {
    const ctx = makeCtx({ crmPipeline: { findMany: vi.fn().mockResolvedValue([basePipeline]) } });
    const result = await pipelinesCaller(ctx).list();
    expect(result).toHaveLength(1);
    expect(result[0].stages).toHaveLength(1);
  });
});

describe("crmPipelinesRouter.delete", () => {
  it("throws BAD_REQUEST when deals exist in pipeline", async () => {
    const ctx = makeCtx({
      crmPipeline: { findFirst: vi.fn().mockResolvedValue(basePipeline) },
      crmDeal: { count: vi.fn().mockResolvedValue(3) },
    });
    await expect(pipelinesCaller(ctx).delete({ id: "pipe-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deletes pipeline when no deals exist", async () => {
    const delMock = vi.fn().mockResolvedValue(basePipeline);
    const ctx = makeCtx({
      crmPipeline: { findFirst: vi.fn().mockResolvedValue(basePipeline), delete: delMock },
      crmDeal: { count: vi.fn().mockResolvedValue(0) },
    });
    const result = await pipelinesCaller(ctx).delete({ id: "pipe-1" });
    expect(result.success).toBe(true);
  });
});

describe("crmPipelinesRouter.deleteStage", () => {
  const stageWithPipeline = { ...baseStage, pipeline: { organisationId: ORG } };

  it("throws BAD_REQUEST when deals are in stage", async () => {
    const ctx = makeCtx({
      crmPipelineStage: { findFirst: vi.fn().mockResolvedValue(stageWithPipeline) },
      crmDeal: { count: vi.fn().mockResolvedValue(2) },
    });
    await expect(pipelinesCaller(ctx).deleteStage({ stageId: "stage-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("deletes stage when no deals", async () => {
    const delMock = vi.fn().mockResolvedValue(baseStage);
    const ctx = makeCtx({
      crmPipelineStage: { findFirst: vi.fn().mockResolvedValue(stageWithPipeline), delete: delMock },
      crmDeal: { count: vi.fn().mockResolvedValue(0) },
    });
    const result = await pipelinesCaller(ctx).deleteStage({ stageId: "stage-1" });
    expect(result.success).toBe(true);
  });
});

describe("crmPipelinesRouter.reorderStages", () => {
  it("calls update for each stageId with correct order", async () => {
    const updateMock = vi.fn().mockResolvedValue(baseStage);
    const ctx = makeCtx({
      crmPipeline: { findFirst: vi.fn().mockResolvedValue(basePipeline) },
      crmPipelineStage: { update: updateMock },
      $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    });
    await pipelinesCaller(ctx).reorderStages({ pipelineId: "pipe-1", stageIds: ["stage-2", "stage-1"] });
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock.mock.calls[0][0].data.order).toBe(1);
    expect(updateMock.mock.calls[1][0].data.order).toBe(2);
  });
});
