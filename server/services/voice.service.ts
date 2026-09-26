// Voice input for the AI chat — speech-to-text on the user's own machine.
//
// The engine is whisper.cpp's `whisper-cli` (built by
// desktop/embedded/fetch-whisper.mjs, shipped in the app's resources; the
// desktop shell passes its path as WHISPER_BIN). The speech model is NOT
// bundled: it is downloaded from the whisper.cpp model repo when the user turns
// voice input on in Settings, into WHISPER_HOME/models, and checked against a
// pinned SHA-256. Audio never leaves the machine.
//
// Downloads resume (HTTP Range) — a 190 MB model on a slow link can take a
// while, and a restart or dropped connection must not start it over.
//
// The engine uses the GPU when there is one (Metal on Macs, Vulkan on Windows)
// and falls back to the CPU on its own. A GPU's first run compiles its shaders,
// which can take seconds, so the engine is warmed up in the background as soon
// as voice input is on — before the user presses the mic.

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** The env vars this module reads (process.env, or a test's own). */
export type VoiceEnv = Record<string, string | undefined>;

export const VOICE_MODELS = {
  base: {
    file: "ggml-base-q5_1.bin",
    label: "Fast",
    sizeMB: 60,
    sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
  },
  small: {
    file: "ggml-small-q5_1.bin",
    label: "Accurate",
    sizeMB: 190,
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
  },
} as const;
export type VoiceModelId = keyof typeof VOICE_MODELS;
export const VOICE_MODEL_IDS = Object.keys(VOICE_MODELS) as [VoiceModelId, ...VoiceModelId[]];

// "auto" lets whisper detect; naming the language avoids Urdu speech coming
// back in Hindi (Devanagari) script, which auto-detect often does.
export const VOICE_LANGUAGES = ["auto", "en", "ur"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

const DEFAULT_MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
// 16 kHz mono 16-bit WAV is 32 KB/s — this is a little over two minutes.
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 120_000;

// ── Where things are ─────────────────────────────────────────────────────────

export function whisperBin(env: VoiceEnv = process.env): string | null {
  const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const candidates = [
    env.WHISPER_BIN,
    // `npm run fetch:whisper` output, for `npm run dev`.
    join(process.cwd(), "desktop", "whisper", "bin", exe),
  ];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

export function modelsDir(env: VoiceEnv = process.env): string {
  return join(env.WHISPER_HOME || join(process.cwd(), ".whisper"), "models");
}

export function modelPath(id: VoiceModelId, env: VoiceEnv = process.env): string {
  return join(modelsDir(env), VOICE_MODELS[id].file);
}

export function modelUrl(id: VoiceModelId, env: VoiceEnv = process.env): string {
  return `${env.WHISPER_MODEL_BASE_URL || DEFAULT_MODEL_BASE_URL}/${VOICE_MODELS[id].file}`;
}

export function isVoiceModelId(v: unknown): v is VoiceModelId {
  return typeof v === "string" && v in VOICE_MODELS;
}

// ── Model download ───────────────────────────────────────────────────────────

interface DownloadState {
  received: number;
  total: number | null;
  error: string | null;
  running: Promise<void> | null;
}
const downloads = new Map<string, DownloadState>();

export interface VoiceStatus {
  engineInstalled: boolean;
  model: VoiceModelId;
  modelReady: boolean;
  /** What transcribes: known once the engine has warmed up. */
  accelerator: Accelerator | null;
  warmingUp: boolean;
  download: {
    received: number;
    total: number | null;
    active: boolean;
    error: string | null;
  } | null;
}

export function getVoiceStatus(id: VoiceModelId, env: VoiceEnv = process.env): VoiceStatus {
  const path = modelPath(id, env);
  const d = downloads.get(path);
  const bin = whisperBin(env);
  return {
    engineInstalled: bin !== null,
    model: id,
    modelReady: existsSync(path),
    accelerator: (bin && engines.get(bin)?.accelerator) || null,
    warmingUp: !!(bin && engines.get(bin)?.warmingUp),
    download: d
      ? { received: d.received, total: d.total, active: !!d.running, error: d.error }
      : null,
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * Start (or resume) downloading a model in the background. Returns the
 * in-flight promise; calling again while it runs returns the same one.
 */
export function downloadModel(id: VoiceModelId, env: VoiceEnv = process.env): Promise<void> {
  const path = modelPath(id, env);
  if (existsSync(path)) return Promise.resolve();
  const current = downloads.get(path);
  if (current?.running) return current.running;

  const state: DownloadState = { received: 0, total: null, error: null, running: null };
  downloads.set(path, state);
  const part = `${path}.part`;

  state.running = (async () => {
    mkdirSync(modelsDir(env), { recursive: true });
    const have = existsSync(part) ? statSync(part).size : 0;
    const res = await fetch(modelUrl(id, env), {
      headers: have > 0 ? { Range: `bytes=${have}-` } : {},
      redirect: "follow",
    });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
    // 206 = the server honoured the Range; anything else starts from zero.
    const resumed = res.status === 206;
    state.received = resumed ? have : 0;
    const length = Number(res.headers.get("content-length"));
    state.total = Number.isFinite(length) && length > 0 ? state.received + length : null;

    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        state.received += chunk.byteLength;
        ctrl.enqueue(chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(res.body.pipeThrough(counter) as import("node:stream/web").ReadableStream),
      createWriteStream(part, { flags: resumed ? "a" : "w" })
    );

    // A self-hosted mirror (WHISPER_MODEL_BASE_URL) may carry other builds.
    if (!env.WHISPER_MODEL_BASE_URL && (await sha256File(part)) !== VOICE_MODELS[id].sha256) {
      rmSync(part, { force: true });
      throw new Error("The downloaded model was corrupted. Please try again.");
    }
    renameSync(part, path);
  })()
    .catch((err: unknown) => {
      state.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      state.running = null;
    });
  return state.running;
}

// ── Transcription ────────────────────────────────────────────────────────────

export class VoiceError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** A RIFF/WAVE container — what the chat's recorder sends. */
export function isWav(buf: Buffer): boolean {
  return (
    buf.length > 44 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WAVE"
  );
}

/**
 * True when a 16-bit WAV holds no speech — whisper "hears" words like "you"
 * or "Thank you." in silence, so a silent recording never reaches it.
 * `threshold` is RMS on a 0..1 scale (~-46 dBFS: quieter than a whisper).
 */
export function isSilent(buf: Buffer, threshold = 0.005): boolean {
  // Walk the RIFF chunks to "data" (other chunks, e.g. FLLR, may come first).
  let at = 12;
  while (at + 8 <= buf.length && buf.toString("ascii", at, at + 4) !== "data") {
    at += 8 + buf.readUInt32LE(at + 4);
  }
  if (at + 8 > buf.length || buf.readUInt16LE(34) !== 16) return false; // not 16-bit PCM: let whisper decide
  const end = Math.min(buf.length, at + 8 + buf.readUInt32LE(at + 4));
  let sum = 0;
  let n = 0;
  for (let i = at + 8; i + 1 < end; i += 2, n++) {
    const v = buf.readInt16LE(i) / 32768;
    sum += v * v;
  }
  return n === 0 || Math.sqrt(sum / n) < threshold;
}

export function whisperArgs(
  model: string,
  file: string,
  language: VoiceLanguage,
  opts: { gpu?: boolean; logs?: boolean } = {}
): string[] {
  const threads = Math.max(1, Math.min(8, cpus().length - 1));
  // -nt: no timestamps. -np: no log noise (the warm-up keeps the logs to see
  // which device was picked). -ng: CPU only.
  return [
    "-m",
    model,
    "-f",
    file,
    "-l",
    language,
    "-nt",
    "-t",
    String(threads),
    ...(opts.logs ? [] : ["-np"]),
    ...(opts.gpu === false ? ["-ng"] : []),
  ];
}

// One transcription at a time: whisper uses every core (and the GPU).
let queue: Promise<unknown> = Promise.resolve();

// ── GPU / CPU ────────────────────────────────────────────────────────────────

export interface Accelerator {
  kind: "gpu" | "cpu";
  /** For people: "Apple M4 Pro (Metal)", "GPU (Vulkan)", "CPU". */
  name: string;
}

/** Which device whisper picked, from its startup log. */
export function parseAccelerator(log: string): Accelerator {
  const backend = /whisper_backend_init_gpu: using (\S+) backend/.exec(log)?.[1];
  if (!backend) return { kind: "cpu", name: "CPU" };
  if (backend.startsWith("MTL")) {
    const chip = /ggml_metal_init: found device: (.+)/.exec(log)?.[1]?.trim();
    return { kind: "gpu", name: `${chip || "GPU"} (Metal)` };
  }
  if (backend.startsWith("Vulkan")) return { kind: "gpu", name: "GPU (Vulkan)" };
  if (backend.startsWith("CUDA")) return { kind: "gpu", name: "NVIDIA GPU (CUDA)" };
  return { kind: "gpu", name: backend };
}

// Per engine binary: whether its GPU path works, and what it runs on.
interface EngineState {
  gpu: boolean;
  accelerator: Accelerator | null;
  warmUp: Promise<void> | null;
  warmingUp: boolean;
}
const engines = new Map<string, EngineState>();
function engineState(bin: string): EngineState {
  let e = engines.get(bin);
  if (!e) engines.set(bin, (e = { gpu: true, accelerator: null, warmUp: null, warmingUp: false }));
  return e;
}

/** Forget what was learnt about the engines (tests). */
export function resetVoiceEngines(): void {
  engines.clear();
}

function runEngine(bin: string, args: string[], env: VoiceEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, { env: env as NodeJS.ProcessEnv, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => child.kill(), TRANSCRIBE_TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * The CPU-only engine shipped next to a GPU one, if any. On Windows the main
 * engine is built with Vulkan and won't even start on a PC without a Vulkan
 * driver, so a plain CPU build ships beside it as whisper-cli-cpu.exe.
 */
export function cpuFallbackBin(bin: string): string {
  const cpu = bin.replace(/whisper-cli(\.exe)?$/, "whisper-cli-cpu$1");
  return cpu !== bin && existsSync(cpu) ? cpu : bin;
}

/**
 * Run the engine, on the GPU if it has one. A GPU run that fails (no GPU
 * driver, a broken one, a device lost mid-run) is retried on the CPU, and that
 * engine then stays on the CPU for the rest of this session.
 */
async function runWithFallback(
  bin: string,
  args: (gpu: boolean) => string[],
  env: VoiceEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const engine = engineState(bin);
  const cpuBin = cpuFallbackBin(bin);
  if (!engine.gpu) return runEngine(cpuBin, args(false), env);
  const first = await runEngine(bin, args(true), env).catch((err: unknown) => ({
    code: -1,
    stdout: "",
    stderr: String(err),
  }));
  if (first.code === 0) return first;
  const cpu = await runEngine(cpuBin, args(false), env);
  if (cpu.code === 0) {
    engine.gpu = false;
    engine.accelerator = { kind: "cpu", name: "CPU" };
    console.warn(`[voice] GPU run failed, using the CPU: ${lastLine(first.stderr)}`);
  }
  return cpu;
}

const lastLine = (s: string) => s.trim().split("\n").at(-1) ?? "";

/** One second of a quiet tone: enough for the engine to run end to end. */
function warmUpWav(): Buffer {
  const rate = 16000;
  const buf = Buffer.alloc(44 + rate * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + rate * 2, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) buf.writeInt16LE(Math.round(3000 * Math.sin(i / 8)), 44 + i * 2);
  return buf;
}

/**
 * Run the engine once in the background so the GPU's one-time shader compile
 * (seconds on a first run) happens before the user speaks, and learn which
 * device it uses. Once per engine per session; later calls are no-ops.
 */
export function warmUp(id: VoiceModelId, env: VoiceEnv = process.env): Promise<void> {
  const bin = whisperBin(env);
  const model = modelPath(id, env);
  if (!bin || !existsSync(model)) return Promise.resolve();
  const engine = engineState(bin);
  if (engine.warmUp) return engine.warmUp;
  engine.warmingUp = true;

  const job = queue.then(async () => {
    const file = join(tmpdir(), `trivio-voice-warmup-${randomUUID()}.wav`);
    await writeFile(file, warmUpWav());
    try {
      const run = await runWithFallback(
        bin,
        (gpu) => whisperArgs(model, file, "en", { gpu, logs: true }),
        env
      );
      if (run.code !== 0) throw new Error(lastLine(run.stderr) || `exit ${run.code}`);
      engine.accelerator = engine.gpu ? parseAccelerator(run.stderr) : { kind: "cpu", name: "CPU" };
    } finally {
      rmSync(file, { force: true });
    }
  });
  queue = job.catch(() => undefined);
  // Once per session even if it fails: a failure isn't fatal (transcribing
  // reports its own errors), and retrying on every status poll would be.
  engine.warmUp = job
    .catch((err: unknown) => {
      console.warn(`[voice] engine warm-up failed: ${err instanceof Error ? err.message : err}`);
    })
    .finally(() => {
      engine.warmingUp = false;
    });
  return engine.warmUp;
}

/** whisper's plain-text output → what goes into the chat box. */
export function cleanTranscript(raw: string): string {
  return (
    raw
      // Non-speech markers: [BLANK_AUDIO], [Music], (silence), *coughs* …
      .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function transcribe(
  audio: Buffer,
  opts: { model: VoiceModelId; language: VoiceLanguage; env?: VoiceEnv }
): Promise<string> {
  const env = opts.env ?? process.env;
  const job = queue.then(async () => {
    const bin = whisperBin(env);
    if (!bin) throw new VoiceError("The voice engine isn't installed in this build.", 503);
    const model = modelPath(opts.model, env);
    if (!existsSync(model))
      throw new VoiceError("The voice model hasn't finished downloading.", 409);
    if (!isWav(audio)) throw new VoiceError("Expected a WAV recording.", 400);
    if (isSilent(audio)) return "";

    const file = join(tmpdir(), `trivio-voice-${randomUUID()}.wav`);
    await writeFile(file, audio);
    try {
      const run = await runWithFallback(
        bin,
        (gpu) => whisperArgs(model, file, opts.language, { gpu }),
        env
      );
      if (run.code !== 0)
        throw new VoiceError(`Transcription failed: ${lastLine(run.stderr) || run.code}`, 500);
      return cleanTranscript(run.stdout);
    } finally {
      rmSync(file, { force: true });
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
