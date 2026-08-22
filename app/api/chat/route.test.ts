// app/api/chat/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    chatConversation: { create: vi.fn(), findFirst: vi.fn() },
    chatMessage: { create: vi.fn() },
  },
}));

vi.mock("@/server/services/chat.service", () => ({
  buildChatMessages: vi.fn().mockResolvedValue({ messages: [], nonce: "abc" }),
  parseToolCalls: vi.fn().mockReturnValue({ text: "AI response", toolCalls: [] }),
  executeToolCall: vi.fn(),
}));

vi.mock("@/server/middleware/rateLimit", () => ({
  chatRateLimiter: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST } from "@/app/api/chat/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseToolCalls, executeToolCall } from "@/server/services/chat.service";
import { chatRateLimiter } from "@/server/middleware/rateLimit";

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = "user-1";
const ORG_ID = "org-1";
const CONV_ID = "00000000-0000-0000-0000-000000000001";

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: object, opts: RequestInit = {}) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...opts,
  });
}

async function readSSE(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const text = await res.text();
  const events: Array<{ event: string; data: unknown }> = [];
  const chunks = text.split("\n\n").filter(Boolean);
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (eventLine && dataLine) {
      events.push({
        event: eventLine.slice("event: ".length).trim(),
        data: JSON.parse(dataLine.slice("data: ".length).trim()),
      });
    }
  }
  return events;
}

// ── Default mock setup ────────────────────────────────────────────────────────

function setupDefaultMocks() {
  vi.mocked(auth).mockResolvedValue({ user: { id: USER_ID } } as never);
  vi.mocked(db.user.findUnique).mockResolvedValue({
    id: USER_ID,
    organisationId: ORG_ID,
    organisation: { id: ORG_ID, name: "Test Org" },
  } as never);
  vi.mocked(db.chatConversation.create).mockResolvedValue({ id: CONV_ID } as never);
  vi.mocked(db.chatConversation.findFirst).mockResolvedValue({ id: CONV_ID } as never);
  vi.mocked(db.chatMessage.create).mockResolvedValue({} as never);
  vi.mocked(chatRateLimiter).mockResolvedValue(undefined);
  vi.mocked(parseToolCalls).mockReturnValue({ text: "AI response", toolCalls: [] });
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: "Hello!" }] }, finishReason: "STOP" }],
    }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when there is no auth session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await POST(makeReq({ message: "hello" }));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("returns 401 when session has no user id", async () => {
    vi.mocked(auth).mockResolvedValue({ user: {} } as never);
    const res = await POST(makeReq({ message: "hello" }));
    expect(res.status).toBe(401);
  });

  // ── Organisation ──────────────────────────────────────────────────────────

  it("returns 403 when user has no organisationId", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: USER_ID,
      organisationId: null,
    } as never);
    const res = await POST(makeReq({ message: "hello" }));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("No organisation");
  });

  // ── Request body validation ───────────────────────────────────────────────

  it("returns 400 when message is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid request body");
  });

  it("returns 400 when message is empty string", async () => {
    const res = await POST(makeReq({ message: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when message exceeds 4000 characters", async () => {
    const res = await POST(makeReq({ message: "x".repeat(4001) }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  it("returns 429 when the rate limiter throws", async () => {
    vi.mocked(chatRateLimiter).mockRejectedValueOnce(new Error("Rate limit exceeded") as never);
    const res = await POST(makeReq({ message: "hello" }));
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("Too many requests. Try again shortly.");
  });

  // ── IDOR prevention ───────────────────────────────────────────────────────

  it("returns 403 when conversationId does not belong to the org", async () => {
    vi.mocked(db.chatConversation.findFirst).mockResolvedValue(null as never);
    const res = await POST(makeReq({ message: "hello", conversationId: CONV_ID }));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  // ── New conversation auto-creation ────────────────────────────────────────

  it("auto-creates a conversation when no conversationId is provided", async () => {
    const res = await POST(makeReq({ message: "hello" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(db.chatConversation.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: ORG_ID,
          userId: USER_ID,
        }),
      })
    );
  });

  it("uses the first 60 chars of the message as the conversation title", async () => {
    const longMessage = "A".repeat(80);
    await POST(makeReq({ message: longMessage }));
    expect(vi.mocked(db.chatConversation.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "A".repeat(60),
        }),
      })
    );
  });

  it("uses the full message as title when it is <= 60 chars", async () => {
    const shortMessage = "Short message";
    await POST(makeReq({ message: shortMessage }));
    expect(vi.mocked(db.chatConversation.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: shortMessage }),
      })
    );
  });

  // ── SSE stream format ─────────────────────────────────────────────────────

  it("returns Content-Type: text/event-stream", async () => {
    const res = await POST(makeReq({ message: "hello" }));
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("returns Cache-Control: no-cache and Connection: keep-alive", async () => {
    const res = await POST(makeReq({ message: "hello" }));
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Connection")).toBe("keep-alive");
  });

  it("first SSE event is 'start' with conversationId", async () => {
    const res = await POST(makeReq({ message: "hello" }));
    const events = await readSSE(res);
    expect(events[0].event).toBe("start");
    expect((events[0].data as { conversationId: string }).conversationId).toBeTruthy();
  });

  // ── Smart default: no AI_PROVIDER, no GEMINI_API_KEY ───────────────────────
  // With neither an explicit provider nor a Gemini key, the route falls back to
  // the local Ollama engine (see ai-status.resolveProvider). The gemini no-key
  // branch is covered in its own describe below, where AI_PROVIDER=gemini is
  // forced via a fresh module import.

  it("returns 200 status even when no provider is configured", async () => {
    const res = await POST(makeReq({ message: "hello" }));
    expect(res.status).toBe(200);
  });

  // ── Existing conversation ─────────────────────────────────────────────────

  it("does not create a new conversation when valid conversationId is provided", async () => {
    await POST(makeReq({ message: "hello", conversationId: CONV_ID }));
    expect(vi.mocked(db.chatConversation.create)).not.toHaveBeenCalled();
    expect(vi.mocked(db.chatConversation.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: CONV_ID, organisationId: ORG_ID }),
      })
    );
  });

  // ── User message saved ────────────────────────────────────────────────────

  it("saves the user message to the database", async () => {
    await POST(makeReq({ message: "test message" }));
    const calls = vi.mocked(db.chatMessage.create).mock.calls;
    const userMsg = calls.find((c) => (c[0] as { data: { role: string } }).data.role === "user");
    expect(userMsg).toBeDefined();
    expect((userMsg![0] as { data: { content: string } }).data.content).toBe("test message");
  });

  it("saves attachmentId when provided", async () => {
    const attachmentId = "00000000-0000-0000-0000-000000000002";
    await POST(makeReq({ message: "check attachment", attachmentId }));
    const calls = vi.mocked(db.chatMessage.create).mock.calls;
    const userMsg = calls.find((c) => (c[0] as { data: { role: string } }).data.role === "user");
    expect((userMsg![0] as { data: { attachmentId: string } }).data.attachmentId).toBe(
      attachmentId
    );
  });

  it("saves null attachmentId when not provided", async () => {
    await POST(makeReq({ message: "no attachment" }));
    const calls = vi.mocked(db.chatMessage.create).mock.calls;
    const userMsg = calls.find((c) => (c[0] as { data: { role: string } }).data.role === "user");
    expect((userMsg![0] as { data: { attachmentId: null } }).data.attachmentId).toBeNull();
  });

  // ── Rate limiter is called with the right key ─────────────────────────────

  it("calls chatRateLimiter with the user-scoped key", async () => {
    await POST(makeReq({ message: "hello" }));
    expect(vi.mocked(chatRateLimiter)).toHaveBeenCalledWith(`chat:${USER_ID}`);
  });

  // ── buildChatMessages is called ───────────────────────────────────────────

  it("calls buildChatMessages with org-scoped params", async () => {
    const { buildChatMessages } = await import("@/server/services/chat.service");
    await POST(makeReq({ message: "test" }));
    expect(vi.mocked(buildChatMessages)).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organisationId: ORG_ID,
        userMessage: "test",
      })
    );
  });
});

// ── Tests using dynamic import to control GEMINI_API_KEY ─────────────────────
// These tests reload the route module with GEMINI_API_KEY set so that
// the Gemini API code path can be exercised.

describe("POST /api/chat (with GEMINI_API_KEY configured)", () => {
  let POST_WITH_KEY: typeof POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset modules so the route re-evaluates with GEMINI_API_KEY set
    vi.resetModules();
    process.env.GEMINI_API_KEY = "fake-key-123";

    // Re-mock all dependencies after resetModules
    vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
    vi.mock("@/lib/db", () => ({
      db: {
        user: { findUnique: vi.fn() },
        chatConversation: { create: vi.fn(), findFirst: vi.fn() },
        chatMessage: { create: vi.fn() },
      },
    }));
    vi.mock("@/server/services/chat.service", () => ({
      buildChatMessages: vi.fn().mockResolvedValue({ messages: [], nonce: "abc" }),
      parseToolCalls: vi.fn().mockReturnValue({ text: "AI response", toolCalls: [] }),
      executeToolCall: vi.fn(),
    }));
    vi.mock("@/server/middleware/rateLimit", () => ({
      chatRateLimiter: vi.fn().mockResolvedValue(undefined),
    }));

    const mod = await import("@/app/api/chat/route");
    POST_WITH_KEY = mod.POST;

    // Re-import mocked modules to get their fresh mock instances
    const authMod = await import("@/lib/auth");
    const dbMod = await import("@/lib/db");
    const chatSvcMod = await import("@/server/services/chat.service");

    vi.mocked(authMod.auth).mockResolvedValue({ user: { id: USER_ID } } as never);
    vi.mocked(dbMod.db.user.findUnique).mockResolvedValue({
      id: USER_ID,
      organisationId: ORG_ID,
      organisation: { id: ORG_ID, name: "Test Org" },
    } as never);
    vi.mocked(dbMod.db.chatConversation.create).mockResolvedValue({ id: CONV_ID } as never);
    vi.mocked(dbMod.db.chatConversation.findFirst).mockResolvedValue({ id: CONV_ID } as never);
    vi.mocked(dbMod.db.chatMessage.create).mockResolvedValue({} as never);
    vi.mocked(chatSvcMod.parseToolCalls).mockReturnValue({ text: "Hello!", toolCalls: [] });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: "Hello! How can I help?" }] }, finishReason: "STOP" },
        ],
      }),
    });
  });

  it("emits 'start' then 'token' then 'done' events", async () => {
    const res = await POST_WITH_KEY(makeReq({ message: "hello" }));
    const events = await readSSE(res);
    const eventNames = events.map((e) => e.event);
    expect(eventNames).toContain("start");
    expect(eventNames).toContain("token");
    expect(eventNames).toContain("done");
  });

  it("emits 'done' event with conversationId and content", async () => {
    const res = await POST_WITH_KEY(makeReq({ message: "hello" }));
    const events = await readSSE(res);
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
    const data = doneEvent!.data as { conversationId: string; content: string };
    expect(data.conversationId).toBe(CONV_ID);
    expect(data.content).toBeTruthy();
  });

  it("emits 'token' event with the Gemini response content", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: "Hello! How can I help you?" }] }, finishReason: "STOP" },
        ],
      }),
    });
    const { parseToolCalls: ptc } = await import("@/server/services/chat.service");
    vi.mocked(ptc).mockReturnValue({ text: "Hello! How can I help you?", toolCalls: [] });

    const res = await POST_WITH_KEY(makeReq({ message: "hello" }));
    const events = await readSSE(res);
    const tokenEvent = events.find((e) => e.event === "token");
    expect(tokenEvent).toBeDefined();
    expect((tokenEvent!.data as { content: string }).content).toContain("Hello!");
  });

  it("emits 'error' event when Gemini returns non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });
    const res = await POST_WITH_KEY(makeReq({ message: "hello" }));
    const events = await readSSE(res);
    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.data as { message: string }).message).toContain("503");
  });

  it("calls fetch with the Gemini API URL and API key", async () => {
    await POST_WITH_KEY(makeReq({ message: "hello" }));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("fake-key-123"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("executes tool calls when parseToolCalls returns them", async () => {
    const {
      parseToolCalls: ptc,
      executeToolCall: etc,
      buildChatMessages: bcm,
    } = await import("@/server/services/chat.service");
    const { db: dbMod } = await import("@/lib/db");
    const toolCall = { tool: "list_invoices", args: {} };
    vi.mocked(ptc).mockReturnValue({ text: "Here are the invoices:", toolCalls: [toolCall] });
    vi.mocked(etc).mockResolvedValue({ tool: "list_invoices", success: true, data: [] } as never);
    vi.mocked(bcm).mockResolvedValue({ messages: [], nonce: "abc" } as never);

    const res = await POST_WITH_KEY(makeReq({ message: "show my invoices" }));
    const events = await readSSE(res);

    expect(vi.mocked(etc)).toHaveBeenCalledWith(dbMod, ORG_ID, USER_ID, toolCall);
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
    const data = doneEvent!.data as { toolCalls: unknown[] };
    expect(data.toolCalls).toHaveLength(1);
  });

  it("uses fallback text when Gemini finishes with MAX_TOKENS and no content", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
      }),
    });
    const { parseToolCalls: ptc } = await import("@/server/services/chat.service");
    vi.mocked(ptc).mockImplementation((text: string) => ({ text, toolCalls: [] }));

    const res = await POST_WITH_KEY(makeReq({ message: "write me a novel" }));
    const events = await readSSE(res);
    const tokenEvent = events.find((e) => e.event === "token");
    expect(tokenEvent).toBeDefined();
    expect((tokenEvent!.data as { content: string }).content).toContain("ran out of space");
  });

  it("includes toolCalls and toolResults in the done event when tools are used", async () => {
    const { parseToolCalls: ptc, executeToolCall: etc } =
      await import("@/server/services/chat.service");
    const toolCall = { tool: "create_contact", args: { name: "Alice" } };
    const toolResult = {
      tool: "create_contact",
      success: true,
      data: { name: "Alice", type: "CUSTOMER" },
    };
    vi.mocked(ptc).mockReturnValue({ text: "Contact created.", toolCalls: [toolCall] });
    vi.mocked(etc).mockResolvedValue(toolResult as never);

    const res = await POST_WITH_KEY(makeReq({ message: "create contact Alice" }));
    const events = await readSSE(res);
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeDefined();
    const data = doneEvent!.data as { toolCalls: unknown[]; toolResults: unknown[] };
    expect(data.toolCalls).toHaveLength(1);
    expect(data.toolResults).toHaveLength(1);
  });
});

// ── Provider-selection helper ──────────────────────────────────────────────────
// Re-imports the route in a fresh module registry with a specific env so the
// provider is decided deterministically (resolveProvider reads env at import time).
async function loadPost(env: { AI_PROVIDER?: string; GEMINI_API_KEY?: string }) {
  vi.clearAllMocks();
  vi.resetModules();
  if (env.AI_PROVIDER === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = env.AI_PROVIDER;
  if (env.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;

  vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
  vi.mock("@/lib/db", () => ({
    db: {
      user: { findUnique: vi.fn() },
      chatConversation: { create: vi.fn(), findFirst: vi.fn() },
      chatMessage: { create: vi.fn() },
    },
  }));
  vi.mock("@/server/services/chat.service", () => ({
    buildChatMessages: vi.fn().mockResolvedValue({ messages: [], nonce: "abc" }),
    parseToolCalls: vi.fn().mockReturnValue({ text: "AI response", toolCalls: [] }),
    executeToolCall: vi.fn(),
  }));
  vi.mock("@/server/middleware/rateLimit", () => ({
    chatRateLimiter: vi.fn().mockResolvedValue(undefined),
  }));

  const mod = await import("@/app/api/chat/route");
  const authMod = await import("@/lib/auth");
  const dbMod = await import("@/lib/db");
  vi.mocked(authMod.auth).mockResolvedValue({ user: { id: USER_ID } } as never);
  vi.mocked(dbMod.db.user.findUnique).mockResolvedValue({
    id: USER_ID,
    organisationId: ORG_ID,
    organisation: { id: ORG_ID, name: "Test Org" },
  } as never);
  vi.mocked(dbMod.db.chatConversation.create).mockResolvedValue({ id: CONV_ID } as never);
  vi.mocked(dbMod.db.chatConversation.findFirst).mockResolvedValue({ id: CONV_ID } as never);
  vi.mocked(dbMod.db.chatMessage.create).mockResolvedValue({} as never);
  return mod.POST;
}

// ── Gemini provider forced, no API key ───────────────────────────────────────────
// Forces AI_PROVIDER=gemini so the "no key -> needs_setup" behaviour is exercised
// deterministically, independent of the smart default.
describe("POST /api/chat (Gemini provider, no API key)", () => {
  let POST_NOKEY: typeof POST;

  beforeEach(async () => {
    POST_NOKEY = await loadPost({ AI_PROVIDER: "gemini" });
  });

  it("emits 'start' then 'error' with a GEMINI_API_KEY message", async () => {
    const res = await POST_NOKEY(makeReq({ message: "hello" }));
    const events = await readSSE(res);
    expect(events[0].event).toBe("start");
    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.data as { message: string }).message).toContain("GEMINI_API_KEY");
  });

  it("does not call fetch when the key is missing", async () => {
    await POST_NOKEY(makeReq({ message: "hello" }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("emits exactly two events (start + error)", async () => {
    const res = await POST_NOKEY(makeReq({ message: "hello" }));
    const events = await readSSE(res);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.event)).toEqual(["start", "error"]);
  });
});

// ── Smart default: no explicit AI_PROVIDER ────────────────────────────────────────
// With no provider set, the route prefers Gemini when a key is present and falls
// back to the local Ollama engine otherwise.
describe("POST /api/chat (smart default — no explicit AI_PROVIDER)", () => {
  it("routes to the local Ollama engine when neither a key nor a provider is set", async () => {
    const POST_DEFAULT = await loadPost({});
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "hi from ollama" }, done: true }),
    });
    const res = await POST_DEFAULT(makeReq({ message: "hello" }));
    await readSSE(res);
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/chat");
    expect(url).not.toContain("generativelanguage.googleapis.com");
  });

  it("honours an explicit AI_PROVIDER=ollama even when a Gemini key is present", async () => {
    const POST_OLLAMA = await loadPost({ AI_PROVIDER: "ollama", GEMINI_API_KEY: "fake-key-123" });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "hi" }, done: true }),
    });
    const res = await POST_OLLAMA(makeReq({ message: "hello" }));
    await readSSE(res);
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/chat");
    expect(url).not.toContain("generativelanguage.googleapis.com");
  });
});
