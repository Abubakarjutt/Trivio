import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libDb = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => libDb);

import { createCallerFactory, createTRPCRouter } from "@/server/trpc";
import { orgRouter } from "@/server/routers/org";
import { authRouter } from "@/server/routers/auth";
import { makeDb, type MockDb } from "../outreach/helpers";

const createCaller = createCallerFactory(createTRPCRouter({ org: orgRouter, auth: authRouter }));
let db: MockDb;
const caller = () =>
  createCaller({
    session: { user: { id: "user-1" }, expires: "2099-01-01" },
    db: db as unknown as PrismaClient,
    ip: "test",
  } as Parameters<typeof createCaller>[0]);

const ORG = { id: "org-1", name: "Acme", currency: "PKR", hasSampleData: false, counterpartySecret: "s".repeat(64) };
// Behaves like Prisma: a field in `omit` is not returned.
const honourOmit = (row: Record<string, unknown>) => async (args: { omit?: Record<string, boolean> }) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !args?.omit?.[k]));

beforeEach(() => {
  db = makeDb();
  libDb.db.user.findUnique.mockResolvedValue({
    id: "user-1",
    organisationId: "org-1",
    role: "OWNER",
    organisation: { id: "org-1" },
  });
});

describe("counterpartySecret never reaches the client", () => {
  it("org.get", async () => {
    db.organisation.findUnique.mockImplementation(honourOmit(ORG));
    db.usageRecord.findUnique.mockResolvedValue(null);
    const r = await caller().org.get();
    expect(r).not.toHaveProperty("counterpartySecret");
    expect(r.name).toBe("Acme");
    expect(db.organisation.findUnique.mock.calls[0]![0].omit).toEqual({ counterpartySecret: true });
  });

  it("org.update", async () => {
    db.organisation.update.mockImplementation(honourOmit(ORG));
    const r = await caller().org.update({ name: "Acme 2" });
    expect(r).not.toHaveProperty("counterpartySecret");
  });

  it("auth.me", async () => {
    db.user.findUnique.mockResolvedValue({ id: "user-1" });
    await caller().auth.me();
    expect(db.user.findUnique.mock.calls[0]![0].include.organisation.omit).toEqual({
      counterpartySecret: true,
    });
  });
});
