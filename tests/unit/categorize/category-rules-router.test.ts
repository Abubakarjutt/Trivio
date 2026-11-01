import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const libDb = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db", () => libDb);

import { createCallerFactory, createTRPCRouter } from "@/server/trpc";
import { categoryRulesRouter } from "@/server/routers/categoryRules";
import { makeDb, type MockDb } from "../outreach/helpers";

const createCaller = createCallerFactory(createTRPCRouter({ categoryRules: categoryRulesRouter }));
let db: MockDb;
const caller = () => createCaller({ session: { user: { id: "user-1" }, expires: "2099-01-01" }, db: db as unknown as PrismaClient, ip: "test" } as Parameters<typeof createCaller>[0]).categoryRules;

beforeEach(() => {
  db = makeDb();
  libDb.db.user.findUnique.mockResolvedValue({ id: "user-1", organisationId: "org-1", organisation: { id: "org-1" } });
});

describe("categoryRules", () => {
  it("lists only this org's rules, newest first", async () => {
    db.categoryRule.findMany.mockResolvedValue([]);
    await caller().list();
    expect(db.categoryRule.findMany.mock.calls[0]![0]).toMatchObject({ where: { organisationId: "org-1" }, orderBy: { updatedAt: "desc" } });
  });

  it("updates the category within the org", async () => {
    db.categoryRule.updateMany.mockResolvedValue({ count: 1 });
    await caller().update({ id: "r1", category: "Rent" });
    expect(db.categoryRule.updateMany.mock.calls[0]![0]).toEqual({ where: { id: "r1", organisationId: "org-1" }, data: { category: "Rent" } });
  });

  it("deletes within the org and is NOT_FOUND otherwise", async () => {
    db.categoryRule.deleteMany.mockResolvedValue({ count: 0 });
    await expect(caller().delete({ id: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.categoryRule.deleteMany.mock.calls[0]![0]).toEqual({ where: { id: "x", organisationId: "org-1" } });
  });
});
