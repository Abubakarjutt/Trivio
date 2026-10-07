// One structured-output call for every Outreach AI task. Uses the provider Trivio's
// AI chat already uses (ai-status.ts). Every answer is checked with zod; one retry.
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { geminiModel, ollamaHost, ollamaModel, resolveProvider } from "@/server/services/ai-status";
import type { Prompt } from "./prompts";

export class OutreachAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachAiError";
  }
}

export interface Llm {
  generateJson<T>(schema: z.ZodType<T>, prompt: Prompt, opts?: { creative?: boolean }): Promise<T>;
}

const TIMEOUT_MS = 300_000;
const FORMAT_ERROR = "The model's answer didn't match the expected format. Try again.";
const GEMINI_DROP = new Set(["$schema", "additionalProperties", "default"]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>)
      .filter(([k]) => !GEMINI_DROP.has(k))
      .map(([k, v]) => [k, strip(v)])
  );
}

export function jsonSchemaFor(
  schema: z.ZodTypeAny,
  target: "jsonSchema7" | "openApi3"
): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, { target, $refStrategy: "none" }) as Record<string, unknown>;
  if (target === "openApi3") return strip(raw) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit $schema from the copy
  const { $schema: _drop, ...rest } = raw;
  return rest;
}

type Raw = (schema: z.ZodTypeAny, prompt: Prompt, temperature: number) => Promise<string>;

function networkError(e: unknown, provider: "ollama" | "gemini"): OutreachAiError {
  if (e instanceof OutreachAiError) return e;
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return new OutreachAiError(
      "The AI took too long to answer. Try again, or use a smaller paste."
    );
  }
  return new OutreachAiError(
    provider === "ollama"
      ? "Can't reach the local AI engine (Ollama). Check that it's running in Settings."
      : "Can't reach the Gemini API. Check your internet connection and try again."
  );
}

/**
 * Read the response body inside the same error mapping as the request (a timeout can fire while
 * the body is still arriving). An envelope that isn't JSON comes back as null, which the caller
 * turns into an empty answer so the normal format retry handles it.
 */
async function readEnvelope<T>(res: Response, provider: "ollama" | "gemini"): Promise<T | null> {
  let body: string;
  try {
    body = await res.text();
  } catch (e) {
    throw networkError(e, provider);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function ollamaRaw(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Raw {
  const model = ollamaModel(env);
  return async (schema, prompt, temperature) => {
    let res: Response;
    try {
      res = await fetchImpl(`${ollamaHost(env)}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format: jsonSchemaFor(schema, "jsonSchema7"),
          options: { temperature },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw networkError(e, "ollama");
    }
    if (res.status === 404)
      throw new OutreachAiError(`Model not found. Pull ${model} in Settings first.`);
    if (!res.ok)
      throw new OutreachAiError(`The AI request failed (HTTP ${res.status}). Try again.`);
    const data = await readEnvelope<{ message?: { content?: string } }>(res, "ollama");
    return data?.message?.content ?? "";
  };
}

function geminiRaw(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Raw {
  return async (schema, prompt, temperature) => {
    const key = env.GEMINI_API_KEY;
    if (!key)
      throw new OutreachAiError(
        "Add a Gemini API key, or switch the AI provider to the local engine in Settings."
      );
    let res: Response;
    try {
      res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel(env)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt.system }] },
            contents: [{ role: "user", parts: [{ text: prompt.user }] }],
            generationConfig: {
              temperature,
              responseMimeType: "application/json",
              responseSchema: jsonSchemaFor(schema, "openApi3"),
            },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }
      );
    } catch (e) {
      throw networkError(e, "gemini");
    }
    if (!res.ok)
      throw new OutreachAiError(`The AI request failed (HTTP ${res.status}). Try again.`);
    const data = await readEnvelope<{
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    }>(res, "gemini");
    return (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  };
}

export function createLlm(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Llm {
  const raw =
    resolveProvider(env) === "ollama" ? ollamaRaw(env, fetchImpl) : geminiRaw(env, fetchImpl);
  return {
    async generateJson<T>(
      schema: z.ZodType<T>,
      prompt: Prompt,
      opts: { creative?: boolean } = {}
    ): Promise<T> {
      const temperature = opts.creative ? 0.7 : 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        const text = await raw(schema as z.ZodTypeAny, prompt, temperature);
        try {
          const parsed = schema.safeParse(JSON.parse(text));
          if (parsed.success) return parsed.data;
        } catch {
          // Not JSON: fall through to the retry.
        }
      }
      throw new OutreachAiError(FORMAT_ERROR);
    },
  };
}
