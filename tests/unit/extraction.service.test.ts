/**
 * Unit tests for extraction.service.ts — extractDocument
 *
 * Mocks global `fetch` and `@/lib/storage` so no real HTTP calls or file I/O occur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── helpers ──────────────────────────────────────────────────────────────────

function ollamaHealthOk() {
  return { status: 200, ok: true, json: async () => ({ models: [] }) };
}

function ollamaHealthFail(status = 503) {
  return { status, ok: false, text: async () => "Service Unavailable" };
}

const VALID_EXTRACTION = {
  supplierName: "Acme Ltd",
  supplierEmail: "billing@acme.example.com",
  invoiceNumber: "INV-001",
  invoiceDate: "2026-01-15",
  dueDate: "2026-02-15",
  lineItems: [{ description: "Consulting", quantity: 1, unitPrice: 500.0, amount: 500.0 }],
  subtotal: 500.0,
  taxAmount: 50.0,
  totalAmount: 550.0,
  currency: "USD",
  notes: "Net 30",
  confidence: { supplierName: 0.99, totalAmount: 0.98 },
};

function ollamaChatOk(payload: unknown = VALID_EXTRACTION) {
  return {
    status: 200,
    ok: true,
    json: async () => ({ message: { content: JSON.stringify(payload) } }),
    text: async () => "",
  };
}

function ollamaChatFail(status = 500, body = "Internal Server Error") {
  return {
    status,
    ok: false,
    text: async () => body,
    json: async () => ({}),
  };
}

function makeFetchSequence(...responses: unknown[]) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[call] ?? responses[responses.length - 1];
    call++;
    return Promise.resolve(r);
  });
}

const FAKE_FILE = Buffer.from("fake file content");

// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/storage", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "@/lib/storage";

// ─────────────────────────────────────────────────────────────────────────────

describe("extractDocument", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    vi.mocked(readFile).mockResolvedValue(FAKE_FILE);
  });

  afterEach(() => {
    process.env = OLD_ENV;
    vi.unstubAllGlobals();
  });

  // ── Mock fallback paths ────────────────────────────────────────────────────

  it("returns mock result when Ollama health check throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.pdf", "application/pdf");
    expect(result.supplierName).toBe("Acme Supplies Ltd");
    expect(result.invoiceNumber).toBe("INV-2026-0042");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("returns mock result when Ollama health endpoint returns non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ollamaHealthFail(503)));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");
    expect(result.supplierName).toBe("Acme Supplies Ltd");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("returns mock result when Ollama health check times out (AbortError)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation was aborted", "AbortError")));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");
    expect(result.supplierName).toBe("Acme Supplies Ltd");
  });

  // ── Image extraction path ─────────────────────────────────────────────────

  it("sends image as base64 in the Ollama messages images array for JPEG", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.jpg", "image/jpeg");

    const fetchMock = vi.mocked(fetch);
    const chatCall = fetchMock.mock.calls[1];
    const body = JSON.parse((chatCall![1] as RequestInit).body as string);
    const msg = body.messages[0];
    expect(msg.images).toBeDefined();
    expect(msg.images[0]).toBe(FAKE_FILE.toString("base64"));
  });

  it("sends image as base64 in images array for PNG", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.png", "image/png");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string);
    expect(body.messages[0].images).toBeDefined();
  });

  it("sends image as base64 for WebP", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.webp", "image/webp");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string);
    expect(body.messages[0].images).toBeDefined();
  });

  // ── PDF path ───────────────────────────────────────────────────────────────

  it("does NOT include images array for PDF mime type", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.pdf", "application/pdf");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string);
    expect(body.messages[0].images).toBeUndefined();
  });

  it("includes base64 content in the prompt text for PDF", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.pdf", "application/pdf");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string);
    expect(body.messages[0].content).toContain("Base64 content");
  });

  it("does NOT include images array for unsupported mime type", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.bin", "application/octet-stream");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string);
    expect(body.messages[0].images).toBeUndefined();
  });

  // ── Response parsing ───────────────────────────────────────────────────────

  it("parses and returns a valid Ollama extraction response", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk(VALID_EXTRACTION)));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");

    expect(result.supplierName).toBe("Acme Ltd");
    expect(result.invoiceNumber).toBe("INV-001");
    expect(result.totalAmount).toBe(550.0);
    expect(result.lineItems).toHaveLength(1);
    expect(result.currency).toBe("USD");
  });

  it("strips markdown code fences from Ollama response", async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(VALID_EXTRACTION)}\n\`\`\``;
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), {
      status: 200, ok: true,
      json: async () => ({ message: { content: fenced } }),
      text: async () => "",
    }));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");
    expect(result.supplierName).toBe("Acme Ltd");
  });

  it("strips markdown code fences without language tag", async () => {
    const fenced = "```\n" + JSON.stringify(VALID_EXTRACTION) + "\n```";
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), {
      status: 200, ok: true,
      json: async () => ({ message: { content: fenced } }),
      text: async () => "",
    }));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");
    expect(result.invoiceNumber).toBe("INV-001");
  });

  it("extracts JSON from response that contains surrounding text", async () => {
    const withText = `Here is the extracted data:\n${JSON.stringify(VALID_EXTRACTION)}\nEnd of extraction.`;
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), {
      status: 200, ok: true,
      json: async () => ({ message: { content: withText } }),
      text: async () => "",
    }));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");
    expect(result.supplierName).toBe("Acme Ltd");
  });

  // ── Field normalisation ───────────────────────────────────────────────────

  it("normalizes missing optional fields to null", async () => {
    const sparse = { lineItems: [], confidence: {} };
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk(sparse)));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");

    expect(result.supplierName).toBeNull();
    expect(result.supplierEmail).toBeNull();
    expect(result.invoiceNumber).toBeNull();
    expect(result.invoiceDate).toBeNull();
    expect(result.dueDate).toBeNull();
    expect(result.subtotal).toBeNull();
    expect(result.taxAmount).toBeNull();
    expect(result.totalAmount).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.notes).toBeNull();
  });

  it("normalizes missing lineItems to empty array", async () => {
    const noItems = { ...VALID_EXTRACTION, lineItems: undefined };
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk(noItems)));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");
    expect(result.lineItems).toEqual([]);
  });

  it("normalizes null lineItems to empty array", async () => {
    const nullItems = { ...VALID_EXTRACTION, lineItems: null };
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk(nullItems)));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");
    expect(result.lineItems).toEqual([]);
  });

  it("normalizes missing confidence to empty object", async () => {
    const noConf = { ...VALID_EXTRACTION, confidence: undefined };
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk(noConf)));
    const { extractDocument } = await import("@/server/services/extraction.service");
    const result = await extractDocument("path/to/file.jpg", "image/jpeg");
    expect(result.confidence).toEqual({});
  });

  // ── Error paths ────────────────────────────────────────────────────────────

  it("throws when Ollama chat request returns non-ok status", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatFail(500)));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await expect(extractDocument("path/to/file.jpg", "image/jpeg")).rejects.toThrow("Ollama request failed");
  });

  it("throws when Ollama returns empty message content", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), {
      status: 200, ok: true,
      json: async () => ({ message: { content: "" } }),
      text: async () => "",
    }));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await expect(extractDocument("path/to/file.jpg", "image/jpeg")).rejects.toThrow("no content");
  });

  it("throws when Ollama returns null message", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), {
      status: 200, ok: true,
      json: async () => ({ message: null }),
      text: async () => "",
    }));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await expect(extractDocument("path/to/file.jpg", "image/jpeg")).rejects.toThrow("no content");
  });

  it("throws when Ollama response body is not valid extraction JSON", async () => {
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), {
      status: 200, ok: true,
      json: async () => ({ message: { content: "not json at all" } }),
      text: async () => "",
    }));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await expect(extractDocument("path/to/file.jpg", "image/jpeg")).rejects.toThrow("Failed to parse extraction JSON");
  });

  // ── Ollama config ─────────────────────────────────────────────────────────

  it("uses OLLAMA_BASE_URL env var if set", async () => {
    process.env.OLLAMA_BASE_URL = "http://custom-host:11434";
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.jpg", "image/jpeg");

    const fetchMock = vi.mocked(fetch);
    expect((fetchMock.mock.calls[0]![0] as string)).toContain("http://custom-host:11434");
  });

  it("uses OLLAMA_MODEL env var if set", async () => {
    process.env.OLLAMA_MODEL = "llava:13b";
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.jpg", "image/jpeg");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string);
    expect(body.model).toBe("llava:13b");
  });

  it("defaults to localhost:11434 when OLLAMA_BASE_URL is not set", async () => {
    delete process.env.OLLAMA_BASE_URL;
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.jpg", "image/jpeg");

    expect((vi.mocked(fetch).mock.calls[0]![0] as string)).toContain("localhost:11434");
  });

  it("truncates PDF base64 to 5000 chars in the prompt", async () => {
    const largeBuffer = Buffer.alloc(10000, "A");
    vi.mocked(readFile).mockResolvedValue(largeBuffer);
    vi.stubGlobal("fetch", makeFetchSequence(ollamaHealthOk(), ollamaChatOk()));
    const { extractDocument } = await import("@/server/services/extraction.service");
    await extractDocument("path/to/file.pdf", "application/pdf");

    const body = JSON.parse((vi.mocked(fetch).mock.calls[1]![1] as RequestInit).body as string);
    const content: string = body.messages[0].content;
    const base64Marker = "Base64 content (first 5000 chars):";
    const startIdx = content.indexOf(base64Marker) + base64Marker.length;
    const nextNewline = content.indexOf("\n", startIdx);
    const base64Snippet = content.slice(startIdx, nextNewline).trim();
    expect(base64Snippet.length).toBeLessThanOrEqual(5000);
  });
});
