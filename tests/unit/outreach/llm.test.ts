import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLlm, jsonSchemaFor, OutreachAiError } from "@/server/services/outreach/llm";

const Schema = z.object({ variantA: z.string(), variantB: z.string() });
const prompt = { system: "SYS", user: "USER" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const OLLAMA = {
  AI_PROVIDER: "ollama",
  OLLAMA_MODEL: "gemma4:e4b",
  OLLAMA_HOST: "http://127.0.0.1:11434",
} as unknown as NodeJS.ProcessEnv;
const GEMINI = {
  AI_PROVIDER: "gemini",
  GEMINI_API_KEY: "test-key",
  CHAT_MODEL: "gemini-2.5-flash",
} as unknown as NodeJS.ProcessEnv;

describe("jsonSchemaFor", () => {
  it("inlines everything and strips keys Gemini rejects", () => {
    const s = jsonSchemaFor(Schema, "openApi3");
    expect(s).not.toHaveProperty("$schema");
    expect(s).not.toHaveProperty("additionalProperties");
    expect(s).toMatchObject({ type: "object", required: ["variantA", "variantB"] });
  });
});

describe("createLlm with Ollama", () => {
  it("sends the schema as format, temperature 0 by default, and parses the reply", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ message: { content: '{"variantA":"a","variantB":"b"}' } }));
    const out = await createLlm(OLLAMA, fetchImpl).generateJson(Schema, prompt);
    expect(out).toEqual({ variantA: "a", variantB: "b" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "gemma4:e4b", stream: false, options: { temperature: 0 } });
    expect(body.format).toMatchObject({ type: "object" });
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USER" },
    ]);
  });

  it("uses temperature 0.7 for creative calls", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(json({ message: { content: '{"variantA":"a","variantB":"b"}' } }));
    await createLlm(OLLAMA, fetchImpl).generateJson(Schema, prompt, { creative: true });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).options.temperature).toBe(0.7);
  });

  it("retries once on a bad answer, then gives up with a clear message", async () => {
    const bad = () => json({ message: { content: '{"variantA":"a"}' } });
    const fetchImpl = vi.fn().mockResolvedValueOnce(bad()).mockResolvedValueOnce(bad());
    await expect(createLlm(OLLAMA, fetchImpl).generateJson(Schema, prompt)).rejects.toThrow(
      "The model's answer didn't match the expected format. Try again."
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("recovers when the retry is good", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ message: { content: "not json" } }))
      .mockResolvedValueOnce(json({ message: { content: '{"variantA":"a","variantB":"b"}' } }));
    await expect(createLlm(OLLAMA, fetchImpl).generateJson(Schema, prompt)).resolves.toEqual({
      variantA: "a",
      variantB: "b",
    });
  });

  it("treats a truncated 200 body as a format failure and retries", async () => {
    const truncated = () => new Response('{"message":{"content":"{\\"vari', { status: 200 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(truncated())
      .mockResolvedValueOnce(json({ message: { content: '{"variantA":"a","variantB":"b"}' } }));
    await expect(createLlm(OLLAMA, fetchImpl).generateJson(Schema, prompt)).resolves.toEqual({
      variantA: "a",
      variantB: "b",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives the format message when every body is truncated", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response("{", { status: 200 }));
    await expect(createLlm(OLLAMA, fetchImpl).generateJson(Schema, prompt)).rejects.toThrow(
      "The model's answer didn't match the expected format. Try again."
    );
  });

  it("maps a timeout while reading the body to the friendly message", async () => {
    const res = new Response("x", { status: 200 });
    vi.spyOn(res, "text").mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const fetchImpl = vi.fn().mockResolvedValue(res);
    await expect(createLlm(OLLAMA, fetchImpl).generateJson(Schema, prompt)).rejects.toThrow(
      "The AI took too long to answer."
    );
  });

  it("explains a missing model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: "model not found" }, 404));
    await expect(createLlm(OLLAMA, fetchImpl).generateJson(Schema, prompt)).rejects.toThrow(
      "Model not found. Pull gemma4:e4b in Settings first."
    );
  });

  it("explains an engine that isn't running", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const err = await createLlm(OLLAMA, fetchImpl)
      .generateJson(Schema, prompt)
      .catch((e) => e);
    expect(err).toBeInstanceOf(OutreachAiError);
    expect(err.message).toBe(
      "Can't reach the local AI engine (Ollama). Check that it's running in Settings."
    );
  });

  it("explains a timeout", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(createLlm(OLLAMA, fetchImpl).generateJson(Schema, prompt)).rejects.toThrow(
      "The AI took too long to answer."
    );
  });
});

describe("createLlm with Gemini", () => {
  it("posts to generateContent with the key in a header, never in the URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json({
        candidates: [
          { content: { parts: [{ text: '{"variantA":"a",' }, { text: '"variantB":"b"}' }] } },
        ],
      })
    );
    const out = await createLlm(GEMINI, fetchImpl).generateJson(Schema, prompt);
    expect(out).toEqual({ variantA: "a", variantB: "b" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(url).not.toContain("test-key");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "SYS" }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "USER" }] }]);
    expect(body.generationConfig).toMatchObject({
      temperature: 0,
      responseMimeType: "application/json",
    });
    expect(body.generationConfig.responseSchema).not.toHaveProperty("additionalProperties");
  });

  it("treats a truncated Gemini body as a format failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => new Response('{"cand', { status: 200 }));
    await expect(createLlm(GEMINI, fetchImpl).generateJson(Schema, prompt)).rejects.toThrow(
      "The model's answer didn't match the expected format. Try again."
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses without a key", async () => {
    await expect(
      createLlm({ AI_PROVIDER: "gemini" } as unknown as NodeJS.ProcessEnv, vi.fn()).generateJson(
        Schema,
        prompt
      )
    ).rejects.toThrow("Add a Gemini API key");
  });
});
