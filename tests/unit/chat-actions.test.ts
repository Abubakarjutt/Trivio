// The chat's generic bridge onto the tRPC routers: anything the UI can do,
// the AI chat can do — through the same procedures, with the same scoping.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

// orgProcedure's middleware resolves the user's organisation via @/lib/db.
const libDb = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/db", () => libDb);
vi.mock("@/lib/queue", () => ({ extractionQueue: { add: vi.fn() } }));

import {
  buildActionCatalog,
  coerceInput,
  describeSchema,
  listAppActions,
  runAppAction,
} from "@/server/services/chat-actions";

describe("listAppActions", () => {
  const names = () => listAppActions().map((a) => a.name);

  it("exposes UI actions the chat used to be missing", () => {
    for (const n of [
      "statementTransactions.create",
      "statementTransactions.updateCategory",
      "statementTransactions.toggleExclude",
      "bankAccounts.matchLine",
      "bankAccounts.createJournalForLine",
      "invoices.update",
      "contacts.archive",
      "crmPipelines.createStage",
      "crmDeals.convertToInvoice",
      "goals.contribute",
      "org.setCurrency",
    ]) {
      expect(names()).toContain(n);
    }
  });

  it("never exposes auth, billing, the chat itself, or account deletion", () => {
    for (const n of names()) {
      expect(n).not.toMatch(/^(auth|subscription|chat)\./);
    }
    expect(names()).not.toContain("gdpr.deleteAccount");
    expect(names()).not.toContain("gdpr.recordConsent");
  });

  it("marks queries as reads in the prompt catalogue", () => {
    const catalog = buildActionCatalog();
    expect(catalog).toMatch(/statementTransactions — PERSONAL FINANCE[^:]*: .*list \(read\)/);
    expect(catalog).toMatch(/^transactions — BUSINESS journal/m);
    expect(catalog).toMatch(/updateCategory \{id:string,category:string/);
  });
});

describe("describeSchema / coerceInput", () => {
  const schema = z.object({
    id: z.string(),
    date: z.date(),
    kind: z.enum(["A", "B"]).optional(),
    lines: z.array(z.object({ when: z.date(), amount: z.number() })),
  });

  it("renders a compact signature with optionals and enums", () => {
    expect(describeSchema(schema)).toBe(
      "{id:string,date:date,kind?:A|B,lines:[{when:date,amount:number}]}"
    );
  });

  it("turns date strings into Dates wherever the schema wants z.date()", () => {
    const out = coerceInput(schema, {
      id: "x",
      date: "2026-09-25",
      lines: [{ when: "2026-09-01", amount: 5 }],
    }) as { date: Date; lines: { when: Date }[] };
    expect(out.date).toBeInstanceOf(Date);
    expect(out.lines[0].when).toBeInstanceOf(Date);
    expect(schema.safeParse(out).success).toBe(true);
  });
});

describe("runAppAction", () => {
  beforeEach(() => {
    libDb.db.user.findUnique.mockResolvedValue({
      id: "user-1",
      organisationId: "org-1",
      organisation: { id: "org-1" },
    });
  });

  it("runs the real procedure scoped to the user's organisation", async () => {
    const db = {
      user: { findUnique: vi.fn().mockResolvedValue({ organisationId: "org-1" }) },
      chartAccount: { findMany: vi.fn().mockResolvedValue([]) },
      statementTransaction: {
        findFirst: vi.fn().mockResolvedValue({ id: "t1" }),
        update: vi.fn().mockResolvedValue({ id: "t1", category: "Groceries" }),
      },
    } as unknown as PrismaClient;

    const res = await runAppAction(db, "user-1", "statementTransactions.updateCategory", {
      id: "t1",
      category: "Groceries",
    });

    expect(res.kind).toBe("mutation");
    expect(db.statementTransaction.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", organisationId: "org-1" },
    });
    expect(db.statementTransaction.update).toHaveBeenCalled();
  });

  it("surfaces validation errors from the procedure's own input schema", async () => {
    await expect(
      runAppAction(
        {
          user: { findUnique: vi.fn().mockResolvedValue({ organisationId: "org-1" }) },
        } as unknown as PrismaClient,
        "user-1",
        "statementTransactions.updateCategory", {
        id: "t1",
      })
    ).rejects.toThrow(/category/);
  });

  it("refuses denied or unknown actions", async () => {
    await expect(
      runAppAction({} as PrismaClient, "user-1", "gdpr.deleteAccount", {})
    ).rejects.toThrow(/Unknown or disallowed/);
    await expect(runAppAction({} as PrismaClient, "user-1", "nope.nothing", {})).rejects.toThrow(
      /Unknown or disallowed/
    );
  });
});
