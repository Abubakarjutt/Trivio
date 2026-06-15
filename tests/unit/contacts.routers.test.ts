/**
 * contacts router unit tests
 *
 * Tests the contactsRouter tRPC procedures directly via createCallerFactory
 * with fully mocked Prisma — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// vi.mock is hoisted — must use literals in factory
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        organisationId: "org-1",
        organisation: { id: "org-1", name: "Test Org" },
      }),
    },
  },
}));

vi.mock("@/server/services/audit.service", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { createCallerFactory } from "@/server/trpc";
import { contactsRouter } from "@/server/routers/contacts";
import { writeAuditLog } from "@/server/services/audit.service";

const ORG = "org-1";
const USER_ID = "user-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  return {
    session: { user: { id: USER_ID, email: "u@test.com" } },
    user: { id: USER_ID, organisationId: ORG, organisation: { id: ORG, name: "Test Org" } },
    db,
    organisationId: ORG,
    organisation: { id: ORG, name: "Test Org" },
  };
}

const createCaller = createCallerFactory(contactsRouter);

const baseContact = {
  id: "contact-1",
  organisationId: ORG,
  type: "CUSTOMER" as const,
  name: "Acme Corp",
  email: "acme@example.com",
  phone: null,
  address: null,
  taxNumber: null,
  isArchived: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list ──────────────────────────────────────────────────────────────────────

describe("contacts.list", () => {
  it("returns empty array when no contacts exist", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ contact: { findMany } }));
    const result = await caller.list({});
    expect(result).toEqual([]);
  });

  it("returns contacts for the org with _count", async () => {
    const contacts = [
      { ...baseContact, _count: { invoices: 2, bills: 0 } },
    ];
    const findMany = vi.fn().mockResolvedValue(contacts);
    const caller = createCaller(makeCtx({ contact: { findMany } }));
    const result = await caller.list({});
    expect(result).toHaveLength(1);
    expect(result[0]._count.invoices).toBe(2);
  });

  it("filters by type CUSTOMER", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ contact: { findMany } }));
    await caller.list({ type: "CUSTOMER" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "CUSTOMER" }) })
    );
  });

  it("filters by type SUPPLIER", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ contact: { findMany } }));
    await caller.list({ type: "SUPPLIER" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "SUPPLIER" }) })
    );
  });

  it("filters by type BOTH", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ contact: { findMany } }));
    await caller.list({ type: "BOTH" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "BOTH" }) })
    );
  });

  it("does not filter by type when type=all (default)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ contact: { findMany } }));
    await caller.list({ type: "all" });
    const where = findMany.mock.calls[0][0].where;
    expect(where.type).toBeUndefined();
  });

  it("filters by search name (case-insensitive)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ contact: { findMany } }));
    await caller.list({ search: "acme" });
    const where = findMany.mock.calls[0][0].where;
    expect(where.name).toEqual({ contains: "acme", mode: "insensitive" });
  });

  it("excludes archived contacts by default", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ contact: { findMany } }));
    await caller.list({});
    const where = findMany.mock.calls[0][0].where;
    expect(where.isArchived).toBe(false);
  });

  it("includes archived contacts when includeArchived=true", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ contact: { findMany } }));
    await caller.list({ includeArchived: true });
    const where = findMany.mock.calls[0][0].where;
    expect(where.isArchived).toBeUndefined();
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe("contacts.getById", () => {
  it("returns contact when found", async () => {
    const contactWithRelations = {
      ...baseContact,
      invoices: [],
      bills: [],
    };
    const findFirst = vi.fn().mockResolvedValue(contactWithRelations);
    const caller = createCaller(makeCtx({ contact: { findFirst } }));
    const result = await caller.getById({ id: "contact-1" });
    expect(result.id).toBe("contact-1");
    expect(result.name).toBe("Acme Corp");
  });

  it("throws NOT_FOUND when contact does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ contact: { findFirst } }));
    await expect(caller.getById({ id: "missing" })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" })
    );
  });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe("contacts.create", () => {
  it("creates a contact with all fields", async () => {
    const created = {
      ...baseContact,
      email: "acme@example.com",
      phone: "+1234567890",
      address: "123 Main St",
      taxNumber: "TAX-001",
    };
    const create = vi.fn().mockResolvedValue(created);
    const caller = createCaller(makeCtx({ contact: { create } }));
    const result = await caller.create({
      type: "CUSTOMER",
      name: "Acme Corp",
      email: "acme@example.com",
      phone: "+1234567890",
      address: "123 Main St",
      taxNumber: "TAX-001",
    });
    expect(result.id).toBe("contact-1");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: ORG,
          type: "CUSTOMER",
          name: "Acme Corp",
          email: "acme@example.com",
        }),
      })
    );
  });

  it("creates a contact with minimal required fields (type + name)", async () => {
    const created = { ...baseContact, email: null, phone: null, address: null, taxNumber: null };
    const create = vi.fn().mockResolvedValue(created);
    const caller = createCaller(makeCtx({ contact: { create } }));
    const result = await caller.create({ type: "SUPPLIER", name: "Minimal Vendor" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "SUPPLIER",
          name: "Minimal Vendor",
          email: null,
        }),
      })
    );
    expect(result).toBeDefined();
  });

  it("calls writeAuditLog after creation", async () => {
    const created = { ...baseContact };
    const create = vi.fn().mockResolvedValue(created);
    const caller = createCaller(makeCtx({ contact: { create } }));
    await caller.create({ type: "CUSTOMER", name: "Acme Corp" });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organisationId: ORG,
        userId: USER_ID,
        action: "CREATE",
        entityType: "Contact",
        entityId: "contact-1",
      })
    );
  });

  it("returns the created contact", async () => {
    const created = { ...baseContact, name: "New Contact" };
    const create = vi.fn().mockResolvedValue(created);
    const caller = createCaller(makeCtx({ contact: { create } }));
    const result = await caller.create({ type: "BOTH", name: "New Contact" });
    expect(result.name).toBe("New Contact");
  });
});

// ─── update ───────────────────────────────────────────────────────────────────

describe("contacts.update", () => {
  it("throws NOT_FOUND when contact does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ contact: { findFirst } }));
    await expect(
      caller.update({ id: "missing", name: "Updated Name" })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("updates the name field", async () => {
    const existing = { ...baseContact };
    const updated = { ...baseContact, name: "Updated Corp" };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ contact: { findFirst, update } }));
    const result = await caller.update({ id: "contact-1", name: "Updated Corp" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "contact-1" } })
    );
    expect(result.name).toBe("Updated Corp");
  });

  it("sets email to null when empty string is passed", async () => {
    const existing = { ...baseContact, email: "old@example.com" };
    const updated = { ...baseContact, email: null };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ contact: { findFirst, update } }));
    await caller.update({ id: "contact-1", email: "" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: null }),
      })
    );
  });

  it("calls writeAuditLog after update", async () => {
    const existing = { ...baseContact };
    const updated = { ...baseContact, name: "Changed" };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(updated);
    const caller = createCaller(makeCtx({ contact: { findFirst, update } }));
    await caller.update({ id: "contact-1", name: "Changed" });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "UPDATE",
        entityType: "Contact",
        entityId: "contact-1",
      })
    );
  });
});

// ─── archive ──────────────────────────────────────────────────────────────────

describe("contacts.archive", () => {
  it("throws NOT_FOUND when contact does not exist", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ contact: { findFirst } }));
    await expect(
      caller.archive({ id: "missing", archive: true })
    ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("archives a contact (isArchived: true)", async () => {
    const existing = { ...baseContact };
    const archived = { ...baseContact, isArchived: true };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(archived);
    const caller = createCaller(makeCtx({ contact: { findFirst, update } }));
    const result = await caller.archive({ id: "contact-1", archive: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isArchived: true } })
    );
    expect(result.isArchived).toBe(true);
  });

  it("unarchives a contact (isArchived: false)", async () => {
    const existing = { ...baseContact, isArchived: true };
    const unarchived = { ...baseContact, isArchived: false };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(unarchived);
    const caller = createCaller(makeCtx({ contact: { findFirst, update } }));
    const result = await caller.archive({ id: "contact-1", archive: false });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isArchived: false } })
    );
    expect(result.isArchived).toBe(false);
  });
});
