// Regression: the AI chat had no personal-finance transaction tool, so
// "I spent 500 on groceries" fell through to create_journal_entry and the
// model kept asking the user for an account code.
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("@/lib/queue", () => ({ extractionQueue: { add: vi.fn() } }));

import { buildSystemPrompt, executeToolCall, parseToolCalls } from "@/server/services/chat.service";

function fakeDb() {
  const created: Record<string, unknown>[] = [];
  const db = {
    statementImportBatch: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "batch-1" }),
      update: vi.fn().mockResolvedValue({}),
    },
    statementTransaction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "txn-1", ...data };
      }),
    },
  };
  return { db: db as unknown as PrismaClient, created, raw: db };
}

describe("add_pf_transaction chat tool", () => {
  it("is advertised in the system prompt with a no-account-code rule", () => {
    const prompt = buildSystemPrompt(
      { orgName: "Me", currency: "PKR", accounts: [], contacts: [] },
      "nonce1"
    );
    expect(prompt).toContain("add_pf_transaction");
    expect(prompt).toMatch(/NEVER ask for an account code/);
    expect(prompt).toContain("Groceries");
  });

  it("records an expense without any account code", async () => {
    const { db, created, raw } = fakeDb();
    const result = await executeToolCall(db, "org-1", "user-1", {
      tool: "add_pf_transaction",
      args: {
        merchantName: "Carrefour",
        amount: 500,
        type: "EXPENSE",
        category: "groceries",
        date: "2026-09-25",
      },
    });

    expect(result.success).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      organisationId: "org-1",
      importBatchId: "batch-1",
      merchantName: "Carrefour",
      amount: 500,
      type: "DEBIT",
      category: "Groceries",
    });
    expect(raw.statementImportBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fileType: "MANUAL" }) })
    );
  });

  it("maps INCOME to CREDIT and unknown categories to Other", async () => {
    const { db, created } = fakeDb();
    await executeToolCall(db, "org-1", "user-1", {
      tool: "add_pf_transaction",
      args: { merchantName: "Employer", amount: 80000, type: "INCOME", category: "Paycheque" },
    });
    expect(created[0]).toMatchObject({ type: "CREDIT", category: "Other" });
  });

  it("snaps a partial category name to the canonical one", async () => {
    const { db, created } = fakeDb();
    await executeToolCall(db, "org-1", "user-1", {
      tool: "add_pf_transaction",
      args: { merchantName: "Systems Ltd", amount: 90000, type: "INCOME", category: "Salary" },
    });
    expect(created[0]).toMatchObject({ type: "CREDIT", category: "Salary & Employment" });
  });

  it("rejects a missing or non-positive amount", async () => {
    const { db, created } = fakeDb();
    const result = await executeToolCall(db, "org-1", "user-1", {
      tool: "add_pf_transaction",
      args: { merchantName: "X", amount: 0 },
    });
    expect(result.success).toBe(false);
    expect(created).toHaveLength(0);
  });
});

describe("parseToolCalls", () => {
  it("accepts a decorated tool-call line but still requires the nonce", () => {
    const out = parseToolCalls(
      'Sure.\nACTION: TOOL_CALL_abc123: {"tool":"goals.list","args":{}}\n`TOOL_CALL_abc123: {"tool":"org.get","args":{}}`\nTOOL_CALL_wrong: {"tool":"goals.delete","args":{"id":"x"}}',
      "abc123"
    );
    expect(out.toolCalls.map((c) => c.tool)).toEqual(["goals.list", "org.get"]);
    expect(out.text).toContain("TOOL_CALL_wrong");
  });
});
