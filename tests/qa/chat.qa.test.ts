// QA: the AI chat end to end — the real /api/chat and /api/chat/actions routes
// against the real database, with a scripted model standing in for Gemma.
// Proves that nothing the assistant proposes is written until the user
// approves it, that every approved transaction shows up on the Transactions
// page, and that a model that merely *claims* it saved something is caught.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db, newUser, type QaUser } from "./harness";
import { resolvePfCategory, localDateString } from "@/server/services/chat.service";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

process.env.AI_PROVIDER = "ollama";
process.env.OLLAMA_HOST = "http://ollama.qa";

type Msg = { role: string; content: string };
/** One scripted model reply: sees the conversation, returns the text Gemma would. */
type Reply = (msgs: Msg[], nonce: string) => string;

const script: Reply[] = [];
const seen: Msg[][] = [];

vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (!String(url).endsWith("/api/chat")) throw new Error("connection refused");
    const body = JSON.parse(String(init?.body)) as { messages: Msg[] };
    const nonce = /TOOL_CALL_([0-9a-f]{16})/.exec(body.messages[0]!.content)?.[1] ?? "";
    seen.push(body.messages);
    const next = script.shift();
    if (!next) throw new Error("scripted model ran out of replies");
    return Response.json({ message: { content: next(body.messages, nonce) }, done: true });
  })
);

const { auth } = await import("@/lib/auth");
const chat = await import("@/app/api/chat/route");
const actions = await import("@/app/api/chat/actions/route");

let u: QaUser;
let other: QaUser;
let signedIn: string | null = null;

const call = (nonce: string, tool: string, args: Record<string, unknown>) =>
  `TOOL_CALL_${nonce}: ${JSON.stringify({ tool, args })}`;
const spend = (merchantName: string, amount: number, extra: Record<string, unknown> = {}) => ({
  merchantName,
  amount,
  type: "EXPENSE",
  category: "Groceries",
  ...extra,
});

type DoneEvent = {
  conversationId: string;
  content: string;
  pendingActions: {
    id: string;
    tool: string;
    status: string;
    preview: { fields: { label: string; value: string }[] };
  }[];
};

/** POST /api/chat as the signed-in user; returns the SSE events. */
async function send(body: Record<string, unknown>, as: string | null = signedIn) {
  vi.mocked(auth).mockResolvedValue((as ? { user: { id: as } } : null) as never);
  const res = await chat.POST(
    new Request("http://app/api/chat", { method: "POST", body: JSON.stringify(body) }) as never
  );
  if (!res.ok) return { status: res.status, events: {} as Record<string, unknown> };
  const text = await res.text();
  const events: Record<string, unknown> = {};
  for (const block of text.split("\n\n")) {
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (ev && data) events[ev] = JSON.parse(data);
  }
  return { status: res.status, events, done: events.done as DoneEvent | undefined };
}

async function decide(id: string, decision: "approve" | "reject", as: string | null = signedIn) {
  vi.mocked(auth).mockResolvedValue((as ? { user: { id: as } } : null) as never);
  const res = await actions.POST(
    new Request("http://app/api/chat/actions", {
      method: "POST",
      body: JSON.stringify({ id, decision }),
    }) as never
  );
  return {
    status: res.status,
    body: res.ok
      ? ((await res.json()) as { action: { status: string; error?: string }; resume: boolean })
      : null,
  };
}

const month = () => localDateString().slice(0, 7);
async function pfMerchants() {
  const { items } = await u.api.statementTransactions.list({ month: month(), limit: 100 });
  return items.map((t) => t.merchantName);
}

beforeAll(async () => {
  u = await newUser();
  other = await newUser();
});

beforeEach(() => {
  script.length = 0;
  seen.length = 0;
  signedIn = u.userId;
});

describe("approval cards for every change", () => {
  it("a recorded expense waits for Approve, then appears in Transactions exactly once", async () => {
    script.push(
      (_m, n) => `✓ Expense recorded\n${call(n, "add_pf_transaction", spend("FreshMart", 500))}`
    );
    const { done } = await send({ message: "I spent 500 on groceries at FreshMart" });

    expect(done!.pendingActions).toHaveLength(1);
    const card = done!.pendingActions[0]!;
    expect(card.status).toBe("PENDING");
    expect(done!.content).not.toMatch(/✓/); // only the app may claim success
    // The card shows the date that will be written, not "whenever you click".
    expect(card.preview.fields).toContainEqual({ label: "Date", value: localDateString() });
    expect(await db.statementTransaction.count({ where: { organisationId: u.orgId } })).toBe(0);

    const first = await decide(card.id, "approve");
    expect(first.body).toMatchObject({ action: { status: "APPROVED" }, resume: true });
    const again = await decide(card.id, "approve"); // double-click / second tab
    expect(again.body!.action.status).toBe("APPROVED");

    expect(await pfMerchants()).toEqual(["FreshMart"]);
    const row = await db.statementTransaction.findFirstOrThrow({
      where: { organisationId: u.orgId },
    });
    expect(Number(row.amount)).toBe(500);
    expect(row.category).toBe(resolvePfCategory("Groceries"));
    expect((await u.api.statementTransactions.summary({ month: month() })).totalDebits).toBe(500);

    // Resume: the model is told, by the app, that it was saved — once.
    script.push(() => "All set — anything else?");
    const resumed = await send({ resume: true, conversationId: done!.conversationId });
    expect(resumed.done!.pendingActions).toHaveLength(0);
    const fed = seen
      .at(-1)!
      .map((m) => m.content)
      .join("\n");
    expect(fed).toMatch(/APPROVED by the user and SAVED/);
    expect((await send({ resume: true, conversationId: done!.conversationId })).status).toBe(409);
    expect(await pfMerchants()).toEqual(["FreshMart"]);
  });

  it("after Approve, 'recorded' is true — and a second request in the chat is saved too", async () => {
    const me = await newUser(); // a clean ledger
    signedIn = me.userId;
    script.push((_m, n) => call(n, "add_pf_transaction", spend("Pharmacy", 30)));
    const { done } = await send({ message: "I spent 30 at the pharmacy" });
    await decide(done!.pendingActions[0]!.id, "approve");

    // What Gemma really says after an approval: no ACTION line, a success claim.
    script.push(() => "The expense of $30 at the pharmacy has been successfully recorded.");
    const calls = seen.length;
    const resumed = await send({ resume: true, conversationId: done!.conversationId });
    expect(seen.length - calls).toBe(1); // no "you claimed success" correction round
    expect(resumed.done!.content).not.toMatch(/Nothing was changed/);

    script.push((_m, n) => call(n, "add_pf_transaction", spend("Barber", 25)));
    const second = await send({ message: "Also 25 at the barber", conversationId: done!.conversationId });
    expect(second.done!.pendingActions).toHaveLength(1);
    await decide(second.done!.pendingActions[0]!.id, "approve");
    const { items } = await me.api.statementTransactions.list({ month: month(), limit: 100 });
    expect(items.map((t) => t.merchantName).sort()).toEqual(["Barber", "Pharmacy"]);
  });

  it("two transactions in one message become two cards, and both appear once approved", async () => {
    script.push(
      (_m, n) =>
        `Here you go.\n${call(n, "add_pf_transaction", spend("Shell", 60, { category: "Transport" }))}\n` +
        `${call(n, "add_pf_transaction", spend("Cafe Uno", 12, { category: "Dining" }))}\n` +
        // small models sometimes repeat a line — it must not become a third card
        `${call(n, "add_pf_transaction", spend("Cafe Uno", 12, { category: "Dining" }))}`
    );
    const { done } = await send({ message: "fuel 60 at Shell and coffee 12 at Cafe Uno" });
    expect(done!.pendingActions).toHaveLength(2);

    const r1 = await decide(done!.pendingActions[0]!.id, "approve");
    expect(r1.body!.resume).toBe(false); // still waiting on the second card
    const r2 = await decide(done!.pendingActions[1]!.id, "approve");
    expect(r2.body!.resume).toBe(true);
    expect((await pfMerchants()).sort()).toEqual(["Cafe Uno", "FreshMart", "Shell"]);
  });

  it("Reject writes nothing, and a later Approve can't resurrect it", async () => {
    script.push((_m, n) => call(n, "add_pf_transaction", spend("Casino", 999)));
    const { done } = await send({ message: "log 999 at Casino" });
    const id = done!.pendingActions[0]!.id;

    const rej = await decide(id, "reject");
    expect(rej.body).toMatchObject({ action: { status: "REJECTED" }, resume: false });
    expect((await decide(id, "approve")).body!.action.status).toBe("REJECTED");
    expect(await pfMerchants()).not.toContain("Casino");
    // If the turn is continued anyway, the model is told it was NOT saved.
    script.push(() => "Okay, I won't record that.");
    await send({ resume: true, conversationId: done!.conversationId });
    expect(
      seen
        .at(-1)!
        .map((m) => m.content)
        .join("\n")
    ).toMatch(/REJECTED by the user — NOT saved/);
    expect(await pfMerchants()).not.toContain("Casino");
  });

  it("business changes (app actions) need approval too, and a failing one is reported, not faked", async () => {
    script.push((_m, n) =>
      call(n, "app_action", {
        action: "contacts.create",
        input: { type: "CUSTOMER", name: "Chat Co" },
      })
    );
    const { done } = await send({ message: "add customer Chat Co" });
    expect(await db.contact.count({ where: { organisationId: u.orgId, name: "Chat Co" } })).toBe(0);
    await decide(done!.pendingActions[0]!.id, "approve");
    expect(await db.contact.count({ where: { organisationId: u.orgId, name: "Chat Co" } })).toBe(1);

    const theirContact = await other.api.contacts.create({ type: "CUSTOMER", name: "Theirs" });
    script.push((_m, n) =>
      call(n, "app_action", {
        action: "invoices.create",
        input: {
          contactId: theirContact.id,
          date: localDateString(),
          dueDate: localDateString(),
          lines: [{ description: "x", quantity: 1, unitPrice: 10, taxAmount: 0 }],
        },
      })
    );
    const bad = await send({ message: "invoice them" });
    const res = await decide(bad.done!.pendingActions[0]!.id, "approve");
    expect(res.body).toMatchObject({ action: { status: "FAILED" }, resume: true });
    expect(res.body!.action.error).toMatch(/Contact not found/);
    expect(await db.invoice.count({ where: { organisationId: u.orgId } })).toBe(0);
  });
});

describe("a model that claims it saved something", () => {
  it("is made to write the real action, which then needs approval", async () => {
    script.push(() => "I've recorded your coffee expense of 4.50.");
    script.push((_m, n) =>
      call(n, "add_pf_transaction", spend("Blue Bottle", 4.5, { category: "Dining" }))
    );
    const { done } = await send({ message: "coffee 4.50 at Blue Bottle" });

    expect(seen[1]!.at(-1)!.content).toMatch(/NOTHING was saved/);
    expect(done!.pendingActions).toHaveLength(1);
    expect(done!.content).not.toMatch(/I've recorded/);
    expect(await pfMerchants()).not.toContain("Blue Bottle");
  });

  it("is labelled 'Nothing was changed' when it still doesn't act", async () => {
    script.push(() => "✓ Expense recorded: 30 at Pharmacy");
    script.push(() => "I've saved it for you.");
    const { done } = await send({ message: "pharmacy 30" });
    expect(done!.pendingActions).toHaveLength(0);
    expect(done!.content).toMatch(/Nothing was changed/);
    expect(done!.content).not.toMatch(/✓/);
  });

  it("an invalid proposal goes back to the model instead of becoming a dud card", async () => {
    script.push((_m, n) => call(n, "add_pf_transaction", spend("Nowhere", -5)));
    script.push((_m, n) => call(n, "add_pf_transaction", spend("Somewhere", 5)));
    const { done } = await send({ message: "spent 5 somewhere" });
    expect(seen[1]!.at(-1)!.content).toMatch(/positive amount/);
    expect(done!.pendingActions.map((a) => a.preview.fields[0]!.value)).toEqual(["Somewhere"]);
  });

  it("reads run straight away so the model can look things up, then propose", async () => {
    script.push((_m, n) =>
      call(n, "app_action", { action: "statementTransactions.list", input: { month: month() } })
    );
    script.push((msgs, n) => {
      expect(msgs.at(-1)!.content).toMatch(/TOOL_RESULTS[\s\S]*FreshMart/);
      return call(n, "add_pf_transaction", spend("FreshMart", 20));
    });
    const { done } = await send({ message: "add another 20 at the grocery place I used" });
    expect(done!.pendingActions).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });
});

describe("who can see and answer a conversation", () => {
  it("only the signed-in owner can approve, continue, read or delete it", async () => {
    script.push((_m, n) => call(n, "add_pf_transaction", spend("Secret", 7)));
    const { done } = await send({ message: "secret 7" });
    const id = done!.pendingActions[0]!.id;
    const convId = done!.conversationId;

    expect((await decide(id, "approve", other.userId)).status).toBe(404);
    expect((await decide(id, "approve", null)).status).toBe(401);
    expect((await send({ message: "hi" }, null)).status).toBe(401);
    expect((await send({ message: "hi", conversationId: convId }, other.userId)).status).toBe(403);

    // A teammate in the same organisation still can't read or post into it.
    const mate = await db.user.create({
      data: { email: `mate-${Date.now()}@example.test`, name: "Mate", organisationId: u.orgId },
    });
    expect((await send({ message: "hi", conversationId: convId }, mate.id)).status).toBe(403);
    expect((await decide(id, "approve", mate.id)).status).toBe(404);
    const { callerFor } = await import("./harness");
    expect(await callerFor(mate.id).chat.getConversation({ id: convId })).toBeNull();
    await callerFor(mate.id).chat.deleteConversation({ id: convId });
    expect(await db.chatConversation.count({ where: { id: convId } })).toBe(1);

    const conv = await u.api.chat.getConversation({ id: convId });
    expect(conv!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(conv!.messages[1]!.pendingActions[0]!.status).toBe("PENDING");
    expect((await u.api.chat.listConversations()).map((c) => c.id)).toContain(convId);
    expect(await other.api.chat.listConversations()).toEqual([]);
    expect(await pfMerchants()).not.toContain("Secret");

    await u.api.chat.deleteConversation({ id: convId });
    expect(await u.api.chat.getConversation({ id: convId })).toBeNull();
    expect(await db.chatPendingAction.count({ where: { id } })).toBe(0);
  });

  it("reports the local assistant as not ready when Ollama isn't reachable", async () => {
    const status = await u.api.chat.getAiStatus();
    expect(status).toMatchObject({ provider: "ollama", ready: false });
  });
});

describe("business journal entries by chat", () => {
  it("the card says which side is the debit and which the credit, and posts balanced", async () => {
    script.push((_m, n) =>
      call(n, "create_journal_entry", {
        date: localDateString(),
        description: "Office rent",
        lines: [
          { accountCode: "5300", debit: 150 },
          { accountCode: "1100", credit: 150 },
        ],
      })
    );
    const { done } = await send({ message: "paid 150 office rent in cash" });
    const lines = done!.pendingActions[0]!.preview.fields.find((f) => f.label === "Lines")!.value;
    expect(lines).toBe("Account code: 5300 · Debit: 150\nAccount code: 1100 · Credit: 150");
    expect(await db.journalEntry.count({ where: { organisationId: u.orgId } })).toBe(0);

    await decide(done!.pendingActions[0]!.id, "approve");
    const posted = await db.journalLine.findMany({
      where: { journalEntry: { organisationId: u.orgId, description: "Office rent" } },
    });
    expect(posted.reduce((s, l) => s + Number(l.debit ?? 0), 0)).toBe(150);
    expect(posted.reduce((s, l) => s + Number(l.credit ?? 0), 0)).toBe(150);
  });
});

describe("the model uses account codes, guesses wrong, or invents tool names", () => {
  it("sees the whole chart of accounts, not the first 30", async () => {
    script.push(() => "Hello!");
    await send({ message: "hi" });
    const prompt = seen[0]![0]!.content;
    const codes = await db.chartAccount.findMany({
      where: { organisationId: u.orgId },
      select: { code: true },
    });
    expect(codes.length).toBeGreaterThan(30);
    for (const { code } of codes) expect(prompt).toContain(code);
  });

  it("an app action may name accounts by code; a wrong code goes back to the model, not onto a card", async () => {
    const expense = (expenseAccountId: string) => ({
      action: "transactions.createExpense",
      input: {
        date: localDateString(),
        description: "Studio rent",
        amount: 150,
        expenseAccountId,
        cashAccountId: "1100",
      },
    });
    script.push((_m, n) => call(n, "app_action", expense("6000")));
    script.push((msgs, n) => {
      expect(msgs.at(-1)!.content).toMatch(/No account "6000"[\s\S]*5300 Rent & Lease/);
      return call(n, "app_action", expense("5300"));
    });
    const { done } = await send({ message: "paid 150 studio rent in cash" });
    expect(done!.pendingActions).toHaveLength(1);
    // The card shows what the user knows — the code — not an internal id.
    expect(done!.pendingActions[0]!.preview.fields).toContainEqual({
      label: "Expense account id",
      value: "5300",
    });

    const res = await decide(done!.pendingActions[0]!.id, "approve");
    expect(res.body!.action.status).toBe("APPROVED");
    const lines = await db.journalLine.findMany({
      where: { journalEntry: { organisationId: u.orgId, description: "Studio rent" } },
      include: { account: true },
    });
    expect(
      lines.map((l) => [l.account.code, Number(l.debit ?? 0), Number(l.credit ?? 0)]).sort()
    ).toEqual([
      ["1100", 0, 150],
      ["5300", 150, 0],
    ]);
  });

  it("an account code can't reach another organisation's account", async () => {
    const theirs = await db.chartAccount.findFirstOrThrow({
      where: { organisationId: other.orgId, code: "5300" },
    });
    script.push((_m, n) =>
      call(n, "app_action", {
        action: "transactions.createExpense",
        input: {
          date: localDateString(),
          description: "x",
          amount: 1,
          expenseAccountId: theirs.id,
          cashAccountId: "1100",
        },
      })
    );
    script.push(() => "I couldn't find that account.");
    const { done } = await send({ message: "expense to their account" });
    expect(done!.pendingActions).toHaveLength(0);
    expect(seen[1]!.at(-1)!.content).toMatch(/No account/);
  });

  it("'area.named_tool' is understood, and a made-up tool never becomes a card", async () => {
    script.push((_m, n) =>
      call(n, "transactions.create_journal_entry", {
        description: "Named tool via area prefix",
        lines: [
          { accountCode: "Rent & Lease", debit: 20, credit: false },
          { accountCode: "1100", credit: "20" },
        ],
      })
    );
    const { done } = await send({ message: "rent 20" });
    expect(done!.pendingActions.map((a) => a.tool)).toEqual(["create_journal_entry"]);
    // No date given → the card shows today's (local) date, which is what gets saved.
    expect(done!.pendingActions[0]!.preview.fields).toContainEqual({
      label: "Date",
      value: localDateString(),
    });
    expect((await decide(done!.pendingActions[0]!.id, "approve")).body!.action.status).toBe(
      "APPROVED"
    );
    const entry = await db.journalEntry.findFirstOrThrow({
      where: { organisationId: u.orgId, description: "Named tool via area prefix" },
    });
    expect(entry.date.toISOString().slice(0, 10)).toBe(localDateString());

    script.push((_m, n) => call(n, "make_coffee", { size: "large" }));
    script.push(() => "Sorry, I can't do that.");
    const r2 = await send({ message: "make me a coffee" });
    expect(r2.done!.pendingActions).toHaveLength(0);
    expect(seen.at(-1)!.at(-1)!.content).toMatch(/Unknown tool "make_coffee"/);
  });

  it("every built-in tool the model is told about is actually implemented", async () => {
    const { NAMED_TOOLS, executeToolCall } = await import("@/server/services/chat.service");
    const scratch = await newUser();
    const missing: string[] = [];
    for (const tool of NAMED_TOOLS) {
      const r = await executeToolCall(db, scratch.orgId, scratch.userId, { tool, args: {} });
      if (r.error === `Unknown tool: ${tool}`) missing.push(tool);
    }
    expect(missing).toEqual([]);
  });
});
