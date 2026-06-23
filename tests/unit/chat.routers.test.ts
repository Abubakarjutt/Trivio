/**
 * chat router unit tests
 *
 * Tests the chatRouter tRPC procedures directly via createCallerFactory
 * with fully mocked Prisma — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { createCallerFactory } from "@/server/trpc";
import { chatRouter } from "@/server/routers/chat";

const ORG = "org-1";
const USER_ID = "user-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(db: Record<string, unknown> = {}): any {
  return {
    session: { user: { id: USER_ID } },
    user: { id: USER_ID, organisationId: ORG, organisation: { id: ORG, name: "Test Org" } },
    db,
    organisationId: ORG,
    organisation: { id: ORG, name: "Test Org" },
  };
}

const createCaller = createCallerFactory(chatRouter);

const baseConversation = {
  id: "conv-1",
  organisationId: ORG,
  userId: USER_ID,
  title: "Sample Conversation",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const baseMessage = {
  id: "msg-1",
  conversationId: "conv-1",
  role: "user" as const,
  content: "Hello",
  createdAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getConversation ──────────────────────────────────────────────────────

describe("chat.getConversation", () => {
  it("returns conversation with messages when found", async () => {
    const conversationWithMessages = {
      ...baseConversation,
      messages: [baseMessage],
    };
    const findFirst = vi.fn().mockResolvedValue(conversationWithMessages);
    const caller = createCaller(makeCtx({ chatConversation: { findFirst } }));
    const result = await caller.getConversation({ id: "conv-1" });

    expect(result).not.toBeNull();
    expect(result?.id).toBe("conv-1");
    expect(result?.title).toBe("Sample Conversation");
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0].content).toBe("Hello");
  });

  it("calls findFirst with correct where clause (scoped to org)", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ chatConversation: { findFirst } }));
    await caller.getConversation({ id: "conv-1" });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1", organisationId: ORG },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    );
  });

  it("returns null when conversation not found", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const caller = createCaller(makeCtx({ chatConversation: { findFirst } }));
    const result = await caller.getConversation({ id: "missing" });

    expect(result).toBeNull();
  });

  it("orders messages by createdAt ascending", async () => {
    const conversationWithMessages = {
      ...baseConversation,
      messages: [baseMessage],
    };
    const findFirst = vi.fn().mockResolvedValue(conversationWithMessages);
    const caller = createCaller(makeCtx({ chatConversation: { findFirst } }));
    await caller.getConversation({ id: "conv-1" });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    );
  });
});

// ─── listConversations ────────────────────────────────────────────────────

describe("chat.listConversations", () => {
  it("returns array of conversations for the user+org", async () => {
    const conversations = [
      {
        id: "conv-1",
        title: "First Chat",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-05"),
        _count: { messages: 5 },
      },
      {
        id: "conv-2",
        title: "Second Chat",
        createdAt: new Date("2026-01-02"),
        updatedAt: new Date("2026-01-04"),
        _count: { messages: 3 },
      },
    ];
    const findMany = vi.fn().mockResolvedValue(conversations);
    const caller = createCaller(makeCtx({ chatConversation: { findMany } }));
    const result = await caller.listConversations();

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("conv-1");
    expect(result[0]._count.messages).toBe(5);
    expect(result[1].id).toBe("conv-2");
  });

  it("returns empty array when no conversations exist", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ chatConversation: { findMany } }));
    const result = await caller.listConversations();

    expect(result).toEqual([]);
  });

  it("calls findMany with correct where clause (org + user scoped)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ chatConversation: { findMany } }));
    await caller.listConversations();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organisationId: ORG, userId: USER_ID },
      })
    );
  });

  it("orders conversations by updatedAt descending", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ chatConversation: { findMany } }));
    await caller.listConversations();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updatedAt: "desc" },
      })
    );
  });

  it("limits results to 50 conversations", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ chatConversation: { findMany } }));
    await caller.listConversations();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      })
    );
  });

  it("selects only necessary fields (id, title, createdAt, updatedAt, _count)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const caller = createCaller(makeCtx({ chatConversation: { findMany } }));
    await caller.listConversations();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { messages: true } },
        },
      })
    );
  });
});

// ─── deleteConversation ────────────────────────────────────────────────────

describe("chat.deleteConversation", () => {
  it("returns { success: true } after deletion", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const caller = createCaller(makeCtx({ chatConversation: { deleteMany } }));
    const result = await caller.deleteConversation({ id: "conv-1" });

    expect(result).toEqual({ success: true });
  });

  it("calls deleteMany with correct where clause (org scoped)", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const caller = createCaller(makeCtx({ chatConversation: { deleteMany } }));
    await caller.deleteConversation({ id: "conv-1" });

    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1", organisationId: ORG },
      })
    );
  });

  it("correctly scopes deletion to the org (prevents cross-org deletion)", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const caller = createCaller(makeCtx({ chatConversation: { deleteMany } }));
    await caller.deleteConversation({ id: "conv-1" });

    const whereClause = deleteMany.mock.calls[0][0].where;
    expect(whereClause).toHaveProperty("organisationId", ORG);
    expect(whereClause).toHaveProperty("id", "conv-1");
  });

  it("deletes the correct conversation by id", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const caller = createCaller(makeCtx({ chatConversation: { deleteMany } }));
    await caller.deleteConversation({ id: "conv-123" });

    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-123", organisationId: ORG },
      })
    );
  });
});
