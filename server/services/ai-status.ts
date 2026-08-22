// Trivio — AI-assistant status.
//
// The AI chat has two backends (see app/api/chat/route.ts):
//   • gemini  — the cloud default, needs GEMINI_API_KEY
//   • ollama  — a LOCAL Gemma model (e.g. "gemma4:e4b") served by an Ollama
//               instance the desktop app installs & runs on the user's machine
//
// The desktop shell is the source of truth for *lifecycle* (is the binary
// installed? is the server running? is the model pulled?) — it exposes that over
// its IPC bridge. But the web UI also needs a server-side signal for two cases:
//    1. "is the assistant usable right now?" — a settings/onboarding probe
//    2. a fallback when the IPC bridge isn't present (plain web build)
//
// Every *decision* here is a pure function so the module is fully unit-testable
// without a real Ollama server; only the network probe touches `fetch`, and even
// that is injectable.

export type AiProvider = "gemini" | "ollama";

export interface AiStatus {
  provider: AiProvider;
  model: string;
  // provider is configured well enough to be usable
  configured: boolean;
  // (ollama only) the local Ollama server answered a request
  running: boolean;
  // (ollama only) the requested model is pulled and available
  modelAvailable: boolean;
  // true when the assistant can serve a turn right now
  ready: boolean;
  version?: string;
  models?: string[];
  // whether a local (desktop-managed) provider is in play
  desktopManaged: boolean;
}

// Resolve the active chat provider from the environment.
//
// Rule (so BOTH options stay available): an explicit AI_PROVIDER always wins
// ("ollama" -> the local engine, anything else -> the cloud). With no explicit
// provider we apply a smart default: use the cloud (Gemini) when GEMINI_API_KEY
// is present, otherwise the local Ollama engine -- so a no-key local user still
// gets a working assistant with zero setup. The desktop shell always sets
// AI_PROVIDER=ollama explicitly, so it is unaffected by the smart default.
export function resolveProvider(env: NodeJS.ProcessEnv): AiProvider {
  const explicit = (env.AI_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit === "ollama" ? "ollama" : "gemini";
  return env.GEMINI_API_KEY ? "gemini" : "ollama";
}

export function ollamaModel(env: NodeJS.ProcessEnv): string {
  return env.OLLAMA_MODEL || "gemma4:e4b";
}

export function ollamaHost(env: NodeJS.ProcessEnv): string {
  return (env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
}

export function geminiModel(env: NodeJS.ProcessEnv): string {
  return env.CHAT_MODEL || "gemini-2.5-flash";
}

// Does the model list contain the requested model? Ollama reports names with a
// tag (e.g. "gemma4:e4b" or "gemma4:e4b-q4_0") and bare "gemma4:e4b" is aliased to
// the latest — so we match the exact name, a "model:" prefix, or the latest tag.
export function modelIsPresent(models: string[], model: string): boolean {
  if (!models.length) return false;
  const bare = model.includes(":") ? model : `${model}:latest`;
  return models.some(
    (m) => m === model || m === bare || m.startsWith(`${model}:`) || m.startsWith(`${model}-`)
  );
}

// A "gemma e2b" style request: map the loosely-specified name to the concrete
// Ollama model tag we ship/pull. Anything starting with "gemma" is normalised to
// the concrete Ollama tag we pull (gemma4:e4b).
export function normalizeGemmaModel(input: string | undefined): string {
  const s = (input || "").trim().toLowerCase();
  if (!s) return "gemma4:e4b";
  // Already a concrete tag (has a colon) — trust it.
  if (s.includes(":")) return s;
  if (s === "gemma e2b" || s === "gemma-e2b" || s === "gemma2b" || s === "gemma 2b")
    return "gemma4:e4b";
  if (s.startsWith("gemma")) return "gemma4:e4b";
  return s;
}

// Build a status from a successful `/api/tags` response.
export function statusFromTags(
  models: string[],
  requestedModel: string,
  version?: string
): AiStatus {
  const modelAvailable = modelIsPresent(models, requestedModel);
  return {
    provider: "ollama",
    model: requestedModel,
    configured: true,
    running: true,
    modelAvailable,
    ready: modelAvailable,
    version,
    models,
    desktopManaged: true,
  };
}

// The full status for the current environment. For Gemini, "ready" means the key
// is present. For Ollama, we probe the local server's /api/tags.
export async function getAiStatus(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<AiStatus> {
  const provider = resolveProvider(env);
  if (provider === "gemini") {
    const key = Boolean(env.GEMINI_API_KEY);
    return {
      provider: "gemini",
      model: geminiModel(env),
      configured: key,
      running: false,
      modelAvailable: false,
      ready: key,
      desktopManaged: false,
    };
  }

  const model = ollamaModel(env);
  const host = ollamaHost(env);
  try {
    const res = await fetchImpl(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      throw new Error(`Ollama /api/tags returned ${res.status}`);
    }
    const tags = (await res.json()) as { models?: Array<{ name?: string }>; version?: string };
    const names = (tags.models ?? []).map((m) => m.name ?? "").filter(Boolean);
    return statusFromTags(names, model, tags.version);
  } catch {
    // Server not reachable / not installed / not started yet.
    return {
      provider: "ollama",
      model,
      configured: true,
      running: false,
      modelAvailable: false,
      ready: false,
      desktopManaged: true,
    };
  }
}
