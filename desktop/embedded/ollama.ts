//
// The AI chat's "ollama" provider (see app/api/chat/route.ts) talks to a local
// Ollama server running Gemma. The desktop shell OWNS that lifecycle so the user
// never touches a terminal: it downloads the Ollama binary into the user's data
// dir, starts `ollama serve` on a private loopback port, and pulls the model.
// No system install, no sudo, no network egress the user didn't ask for — the
// binary lives under the user data dir and runs headless.
//
// Layout (under <userData>/ollama, overridable via TRIVIO_OLLAMA_HOME):
//      <home>/bin/ollama(.exe)   ← the downloaded CLI/server
//      <home>/models/            ← pulled models (OLLAMA_MODELS)
//      <home>/VERSION            ← provenance
//
// Like the embedded Postgres engine, every *decision* is a pure function so the
// whole module is unit-testable without a real binary, network, or GUI. The
// lifecycle (download / spawn / pull) is a thin adapter around child_process and
// fetch, all of which are injectable.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, chmodSync, rmSync, readdirSync, statSync, cpSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createConnection } from "node:net";

// ── Types ────────────────────────────────────────────────────────────────────

export type OllamaPlatform = "darwin" | "linux" | "win32";

// Where everything Ollama-related lives for this install.
export interface OllamaLayout {
  home: string; // <home>
  binDir: string; // <home>/bin
  bin: string; // <home>/bin/ollama(.exe)
  modelsDir: string; // <home>/models
  versionFile: string; // <home>/VERSION
}

// The running server (or "not running"), plus how to tear it down.
export interface OllamaHandle {
  server: ChildProcess | null;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

// Aggregate status the UI / IPC layer reports.
export interface OllamaStatus {
  binaryInstalled: boolean;
  serverRunning: boolean;
  modelAvailable: boolean;
  models: string[];
  model: string; // the model this install is set up for
  version?: string;
  home: string;
  bin: string;
  port: number;
  ready: boolean; // binaryInstalled && serverRunning && modelAvailable
}

// Progress emitted during install / setup.
export type OllamaPhase =
  | "checking"
  | "downloading"
  | "extracting"
  | "starting"
  | "pulling"
  | "ready"
  | "error";

export interface OllamaProgress {
  phase: OllamaPhase;
  pct?: number; // 0..100 when known
  message?: string;
}

// ── Pure decisions (unit-tested directly) ──────────────────────────────────────

// Where the Ollama install lives. Overridable via TRIVIO_OLLAMA_HOME (tests /
// power users); otherwise under the Electron userData dir so it survives app
// updates and is isolated per user.
export function resolveOllamaHome(env: NodeJS.ProcessEnv, userDataDir: string): string {
  return env.TRIVIO_OLLAMA_HOME || join(userDataDir, "ollama");
}

export function buildLayout(
  env: NodeJS.ProcessEnv,
  userDataDir: string,
  plat: OllamaPlatform = process.platform as OllamaPlatform
): OllamaLayout {
  const home = resolveOllamaHome(env, userDataDir);
  const binName = plat === "win32" ? "ollama.exe" : "ollama";
  return {
    home,
    binDir: join(home, "bin"),
    bin: join(home, "bin", binName),
    modelsDir: join(home, "models"),
    versionFile: join(home, "VERSION"),
  };
}

// The server URL the embedded Next.js server will point its ollama provider at.
export function ollamaServerUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

// The default loopback port Ollama listens on (matches Ollama's own default).
export function ollamaPort(env: NodeJS.ProcessEnv): number {
  const raw = (env.OLLAMA_PORT || "").trim();
  const n = raw ? Number(raw) : 11434;
  return Number.isFinite(n) && n > 0 ? n : 11434;
}

// The model this install pulls. "gemma e2b" / "gemma2b" / "gemma2" all mean a
// Gemma; normalise to the concrete Ollama tag we pull (gemma4:e4b).
export function ollamaModelName(env: NodeJS.ProcessEnv): string {
  const raw = (env.OLLAMA_MODEL || "").trim().toLowerCase();
  if (
    raw === "gemma e2b" ||
    raw === "gemma-e2b" ||
    raw === "gemma2b" ||
    raw === "gemma 2b" ||
    raw === "gemma"
  ) {
    return "gemma4:e4b";
  }
  // A concrete tag (has a colon) or a non-gemma name: trust it as-is.
  if (raw) return raw;
  return "gemma4:e4b";
}

// Arch-aware download asset for the official Ollama releases. Overridable with
// OLLAMA_DOWNLOAD_URL so a pinned/patched build can be pointed at without a code
// change. Windows ships the embeddable zip (see the win32 branch below).
export function ollamaDownloadUrl(
  env: NodeJS.ProcessEnv,
  plat: OllamaPlatform,
  targetArch: string,
  version = env.OLLAMA_VERSION || "v0.5.7"
): string {
  if (env.OLLAMA_DOWNLOAD_URL) return env.OLLAMA_DOWNLOAD_URL;

  const base = `https://github.com/ollama/ollama/releases/download/${version}`;
  const archPart = targetArch === "arm64" ? "arm64" : "amd64";

  if (plat === "darwin") {
    // Apple Silicon ships Ollama-darwin.zip; Intel ships Ollama-darwin-amd64.zip.
    return targetArch === "arm64" ? `${base}/Ollama-darwin.zip` : `${base}/Ollama-darwin-amd64.zip`;
  }
  if (plat === "linux") {
    return `${base}/ollama-linux-${archPart}.tgz`;
  }
  if (plat === "win32") {
    // Embeddable zip, NOT the NSIS installer: the desktop owns a headless
    // `ollama serve`, so we ship the portable build that drops ollama.exe +
    // its GPU libs at the archive root. archPart is amd64/arm64, matching
    // Ollama's release asset names (ollama-windows-{amd64,arm64}.zip).
    return `${base}/ollama-windows-${archPart}.zip`;
  }
  throw new Error(`Unsupported platform for Ollama download: ${plat}`);
}

// The archive format for a platform (used to pick the extractor).
export function archiveKind(plat: OllamaPlatform, url: string): "zip" | "tgz" | "exe" {
  if (url.endsWith(".zip")) return "zip";
  if (url.endsWith(".tgz") || url.endsWith(".tar.gz")) return "tgz";
  if (url.endsWith(".exe") || url.endsWith(".msi")) return "exe";
  return "zip";
}

// Args to run the embedded server headless.
export function ollamaServeArgs(): string[] {
  return ["serve"];
}

// Env the `ollama` child needs: bind loopback only, and point model storage at
// our models dir so models survive across launches.
export function ollamaChildEnv(
  base: NodeJS.ProcessEnv,
  home: string,
  host: string,
  port: number
): NodeJS.ProcessEnv {
  return {
    ...base,
    OLLAMA_HOST: `${host}:${port}`,
    OLLAMA_MODELS: join(home, "models"),
  };
}

export function ollamaPullArgs(model: string): string[] {
  return ["pull", model];
}

// Does the model list contain the requested model? Ollama reports tagged names
// (e.g. "gemma4:e4b-q4_0"); a bare "gemma4:e4b" is the latest alias.
export function isModelPulled(models: string[], model: string): boolean {
  if (!models.length) return false;
  const bare = model.includes(":") ? model : `${model}:latest`;
  return models.some(
    (m) => m === model || m === bare || m.startsWith(`${model}:`) || m.startsWith(`${model}-`)
  );
}

// Parse one line of `ollama pull` output into a progress step. Ollama's
// non-TTY output looks like:
//    pulling manifest
//    pulling sha256:abcd… 100.00%
//    writing manifest
//    verifying sha256:abcd… 100.00%
//    success
// We track the highest percentage seen and treat "success" as done.
export function parsePullLine(
  line: string,
  soFar: { pct: number }
): { pct: number; phase: OllamaPhase; message: string } {
  const t = line.trim();
  if (!t) return { ...soFar, phase: "pulling", message: "" };

  if (/^success$/i.test(t)) return { ...soFar, phase: "ready", message: "Model downloaded" };
  if (/error|failed|unable|denied/i.test(t)) {
    return { ...soFar, phase: "error", message: t };
  }

  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(m[1]))));
    if (pct > soFar.pct) soFar.pct = pct;
    return { ...soFar, phase: "pulling", message: t };
  }

  if (/pulling|verifying|writing|downloading|manifest|schedule|copying/i.test(t)) {
    return { ...soFar, phase: "pulling", message: t };
  }
  return { ...soFar, phase: "pulling", message: t };
}

// Is a full setup complete enough to serve a turn?
export function isSetupComplete(
  s: Pick<OllamaStatus, "binaryInstalled" | "serverRunning" | "modelAvailable">
): boolean {
  return s.binaryInstalled && s.serverRunning && s.modelAvailable;
}

// Candidate locations for the `ollama` executable inside an extracted archive,
// most-specific first. Ollama's macOS release is a .app bundle whose CLI lives
// under Resources; the raw/CLI builds put a bare `ollama` at the root.
export function ollamaBinaryCandidates(extractDir: string, plat: OllamaPlatform): string[] {
  const exe = plat === "win32" ? "ollama.exe" : "ollama";
  const byPlat: string[] =
    plat === "darwin"
      ? [
          join("Ollama.app", "Contents", "Resources", "ollama"),
          join("Ollama.app", "Contents", "MacOS", "Ollama"),
          "ollama",
        ]
      : plat === "win32"
        ? ["ollama.exe"]
        : ["bin/ollama", "ollama"];

  return byPlat.map((p) => join(extractDir, p));
}

// ── Lifecycle adapters (thin wrappers around spawn/spawnSync/fetch) ────────────

// Download a URL to a file using curl (already required for the embedded PG
// engine), then extract it. Injectable so tests exercise the flow without a
// network.
export interface DownloadDeps {
  existsSyncImpl?: typeof existsSync;
  mkdirSyncImpl?: typeof mkdirSync;
  chmodSyncImpl?: typeof chmodSync;
  rmSyncImpl?: typeof rmSync;
  spawnSyncImpl?: typeof spawnSync;
  log?: (msg: string) => void;
}

// Ensure the `ollama` binary exists at layout.bin, downloading + extracting it
// from the official release if not. Returns the binary path.
export async function ensureBinary(
  layout: OllamaLayout,
  env: NodeJS.ProcessEnv,
  plat: OllamaPlatform,
  targetArch: string,
  deps: DownloadDeps = {}
): Promise<string> {
  const exists = deps.existsSyncImpl ?? existsSync;
  const mkdir = deps.mkdirSyncImpl ?? mkdirSync;
  const chmod = deps.chmodSyncImpl ?? chmodSync;
  const rm = deps.rmSyncImpl ?? rmSync;
  const spawnSyncImpl = deps.spawnSyncImpl ?? spawnSync;
  const log = deps.log ?? ((m: string) => console.log(m));

  mkdir(layout.binDir, { recursive: true });

  if (exists(layout.bin)) {
    log(`[ollama] binary already present at ${layout.bin}`);
    return layout.bin;
  }

  const url = ollamaDownloadUrl(env, plat, targetArch);
  log(`[ollama] downloading ${url}`);
  const kind = archiveKind(plat, url);

  const tmpDir = join(layout.home, ".dl");
  rm(tmpDir, { recursive: true, force: true });
  mkdir(tmpDir, { recursive: true });

  const archivePath = join(
    tmpDir,
    kind === "tgz" ? "ollama.tgz" : kind === "exe" ? "Ollama.exe" : "ollama.zip"
  );

  if (kind === "exe") {
    // The Windows .exe is an NSIS/MSI *installer* — it needs admin rights and
    // drops into %LOCALAPPDATA%\Programs, so it is not embeddable. The desktop
    // ships the embeddable ollama-windows-*.zip instead, so an .exe/.msi URL only
    // reaches here via a user-supplied OLLAMA_DOWNLOAD_URL; reject it with
    // actionable guidance rather than trying to run an installer.
    throw new Error(
      "Ollama on Windows must be the embeddable zip (ollama-windows-amd64.zip / " +
        "ollama-windows-arm64.zip), not the installer. Clear OLLAMA_DOWNLOAD_URL to " +
        "use the default embeddable build."
    );
  }

  // curl the archive (consistent with the embedded PG fetch tool).
  const dl = spawnSyncImpl("curl", ["-fL", "-o", archivePath, url], { stdio: "pipe" });
  if (dl.status !== 0) {
    throw new Error(
      `Failed to download Ollama from ${url} (curl exit ${dl.status}). Check your connection or set OLLAMA_DOWNLOAD_URL.`
    );
  }

  const extractDir = join(tmpDir, "x");
  mkdir(extractDir, { recursive: true });
  if (kind === "zip") {
    // Windows 10+ ships libarchive `tar` (handles .zip); POSIX uses `unzip`.
    const uz =
      plat === "win32"
        ? spawnSyncImpl("tar", ["-xf", archivePath, "-C", extractDir], { stdio: "pipe" })
        : spawnSyncImpl("unzip", ["-q", archivePath, "-d", extractDir], { stdio: "pipe" });
    if (uz.status !== 0) {
      throw new Error(
        plat === "win32"
          ? "Failed to extract Ollama (need 'tar' — ships with Windows 10+)"
          : "Failed to extract Ollama (is 'unzip' available?)"
      );
    }
  } else {
    // tgz — use tar via shell (portable across platforms).
    const tz = spawnSyncImpl("sh", ["-c", `tar -xzf ${archivePath} -C ${extractDir}`], {
      stdio: "pipe",
    });
    if (tz.status !== 0) throw new Error("Failed to extract Ollama (is 'tar' available?)");
  }

  const found = findOllamaBinary(extractDir, plat, exists);
  if (!found) {
    throw new Error("Could not locate the ollama executable inside the downloaded archive.");
  }

  // Copy the resolved binary (and its .app siblings if needed) into bin/.
  const destDir = dirname(found);
  copyInto(destDir, layout.binDir, log);
  // The bare binary is what we run.
  const binDest = plat === "win32" ? layout.bin : layout.bin;
  if (!exists(binDest)) {
    // Fall back: the resolved file may already be at the canonical name.
    const resolved = exists(join(layout.binDir, plat === "win32" ? "ollama.exe" : "ollama"))
      ? join(layout.binDir, plat === "win32" ? "ollama.exe" : "ollama")
      : found;
    return resolved;
  }
  try {
    chmod(binDest, 0o755);
  } catch {
    /* non-fatal on some FS */
  }
  rm(tmpDir, { recursive: true, force: true });
  log(`[ollama] binary ready at ${binDest}`);
  return binDest;
}

// Recursively find the first executable named `ollama`/`ollama.exe`.
export function findOllamaBinary(
  extractDir: string,
  plat: OllamaPlatform,
  exists: (p: string) => boolean = existsSync
): string | null {
  // 1. Known candidate paths.
  for (const c of ollamaBinaryCandidates(extractDir, plat)) {
    if (exists(c)) return c;
  }
  // 2. Recursive search (depth-limited) for any executable of the right name.
  const want = plat === "win32" ? "ollama.exe" : "ollama";
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      if (e === want) {
        found.push(full);
        continue;
      }
      try {
        if (statSync(full).isDirectory()) walk(full, depth + 1);
      } catch {
        /* skip */
      }
    }
  };
  walk(extractDir, 0);
  return found[0] ?? null;
}

// Copy every file under srcDir into destDir (best-effort; used to hoist the
// extracted binary + its runtime siblings next to our canonical name).
function copyInto(srcDir: string, destDir: string, log: (m: string) => void): void {
  // cpSync (Node >=16.7) is cross-platform, unlike the POSIX-only `cp -R`.
  cpSync(srcDir, destDir, { recursive: true });
  void log;
}

// Wait for a TCP port to accept a connection. Uses node:net's createConnection;
// the connection factory is injectable via setNetConnect so tests can stub the
// socket without opening a real port.
let netConnect: typeof createConnection = createConnection;
export function setNetConnect(fn: typeof createConnection): void {
  netConnect = fn;
}

export function waitForPort(host: string, port: number, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timed out waiting for Ollama on ${host}:${port}`));
    }, timeoutMs);
    const attempt = () => {
      const socket = netConnect({ host, port });
      const onConnected = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve();
      };
      const onError = () => {
        socket.destroy();
        if (settled) return;
        attempt(); // retry until the timeout fires
      };
      socket.once("connect", onConnected);
      socket.once("error", onError);
    };
    attempt();
  });
}

// Start `ollama serve` on a private loopback port and return a handle.
export interface StartServerOpts {
  binPath: string;
  home: string;
  host?: string;
  port?: number;
  env: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
  waitForReady?: (host: string, port: number, timeoutMs?: number) => Promise<void>;
  log?: (msg: string) => void;
}

export async function startServer(opts: StartServerOpts): Promise<OllamaHandle> {
  const spawnImpl = opts.spawnImpl ?? spawn;
  const host = opts.host || "127.0.0.1";
  const port = opts.port || ollamaPort(opts.env);
  const log = opts.log ?? ((m: string) => console.log(m));
  const url = ollamaServerUrl(host, port);
  const childEnv = ollamaChildEnv(opts.env, opts.home, host, port);

  log(`[ollama] starting server on ${url}`);
  const server = spawnImpl(opts.binPath, ollamaServeArgs(), {
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
    detached: process.platform !== "win32",
  });
  server.stdout?.on("data", (d: Buffer) => log(`[ollama:out] ${String(d).trimEnd()}`));
  server.stderr?.on("data", (d: Buffer) => log(`[ollama:err] ${String(d).trimEnd()}`));

  await (opts.waitForReady ?? waitForPort)(host, port, 30000);
  log(`[ollama] server ready at ${url}`);

  return {
    server,
    url,
    port,
    stop: () => stopOllama(server, log),
  };
}

// Pull a model, streaming progress. Resolves when the pull exits 0.
export interface PullOpts {
  binPath: string;
  home: string;
  model: string;
  env: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
  onProgress?: (p: OllamaProgress) => void;
  log?: (msg: string) => void;
}

export function pullModel(opts: PullOpts): Promise<{ ok: boolean }> {
  const spawnImpl = opts.spawnImpl ?? spawn;
  const log = opts.log ?? ((m: string) => console.log(m));
  const childEnv = ollamaChildEnv(opts.env, opts.home, "127.0.0.1", ollamaPort(opts.env));
  const emit = opts.onProgress ?? (() => {});

  return new Promise((resolve, reject) => {
    const child = spawnImpl(opts.binPath, ollamaPullArgs(opts.model), {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
    let acc = { pct: 0 };
    let lastEmit = 0;
    const emitNow = (p: OllamaProgress) => {
      emit(p);
      lastEmit = Date.now();
    };
    child.stdout?.on("data", (d: Buffer) => {
      const text = String(d);
      for (const line of text.split(/\r?\n/)) {
        const r = parsePullLine(line, acc);
        // throttle progress chatter
        if (r.phase === "ready") emitNow({ phase: "ready", pct: 100, message: r.message });
        else if (r.phase === "error") emitNow({ phase: "error", message: r.message });
        else if (Date.now() - lastEmit > 400) {
          emitNow({ phase: "pulling", pct: r.pct, message: r.message });
          lastEmit = Date.now();
        }
      }
    });
    child.on("exit", (code) => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`ollama pull ${opts.model} failed (exit ${code})`));
    });
    child.on("error", (err) => reject(err));
    void log;
  });
}

// List locally available models. `ollama list` reads the on-disk manifest dir
// and works WITHOUT the server running, so this is safe to call anytime.
export interface ListModelsOpts {
  binPath: string;
  home: string;
  env: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
  log?: (msg: string) => void;
}

export function listModels(opts: ListModelsOpts): Promise<string[]> {
  const spawnImpl = opts.spawnImpl ?? spawn;
  const childEnv = ollamaChildEnv(opts.env, opts.home, "127.0.0.1", ollamaPort(opts.env));
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(opts.binPath, ["list"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });
    } catch {
      resolve([]);
      return;
    }
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += String(d);
    });
    child.on("exit", () => resolve(parseModelList(out)));
    child.on("error", () => resolve([]));
  });
}

// `ollama list` prints a table:  NAME  ID  SIZE  MODIFIED
// Skip the header + blank lines; the first whitespace-delimited token of each
// remaining line is the model name.
export function parseModelList(out: string): string[] {
  const lines = out.split(/\r?\n/);
  const names: string[] = [];
  let seenHeader = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.toUpperCase() === "NAME" || /^NAME\s+ID/i.test(t)) {
      seenHeader = true;
      continue;
    }
    if (!seenHeader) continue;
    const name = t.split(/\s+/)[0];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

// Probe whether the local server is up and what models it knows about.
export async function probeServer(
  host: string,
  port: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4000
): Promise<{ running: boolean; models: string[]; version?: string } | null> {
  try {
    const res = await fetchImpl(`http://${host}:${port}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const tags = (await res.json()) as { models?: Array<{ name?: string }>; version?: string };
    return {
      running: true,
      models: (tags.models ?? []).map((m) => m.name ?? "").filter(Boolean),
      version: tags.version,
    };
  } catch {
    return null;
  }
}

// ── Aggregate status ───────────────────────────────────────────────────────────

export interface GetStatusOpts {
  layout: OllamaLayout;
  env: NodeJS.ProcessEnv;
  host?: string;
  port?: number;
  model?: string;
  fetchImpl?: typeof fetch;
  existsSyncImpl?: typeof existsSync;
  listModelsImpl?: (o: ListModelsOpts) => Promise<string[]>;
  log?: (msg: string) => void;
}

export async function getStatus(opts: GetStatusOpts): Promise<OllamaStatus> {
  const exists = opts.existsSyncImpl ?? existsSync;
  const host = opts.host || "127.0.0.1";
  const port = opts.port || ollamaPort(opts.env);
  const model = opts.model || ollamaModelName(opts.env);

  const binaryInstalled = exists(opts.layout.bin);

  // If the binary isn't installed, nothing else can run.
  if (!binaryInstalled) {
    return {
      binaryInstalled: false,
      serverRunning: false,
      modelAvailable: false,
      models: [],
      model,
      home: opts.layout.home,
      bin: opts.layout.bin,
      port,
      ready: false,
    };
  }

  const probe = await probeServer(host, port, opts.fetchImpl);
  const serverRunning = !!probe;

  let models: string[] = probe?.models ?? [];
  if (!models.length) {
    // Server isn't up (or knows nothing) — fall back to reading the on-disk list.
    const lister = opts.listModelsImpl ?? listModels;
    try {
      models = await lister({
        binPath: opts.layout.bin,
        home: opts.layout.home,
        env: opts.env,
        log: opts.log,
      });
    } catch {
      models = [];
    }
  }

  const modelAvailable = isModelPulled(models, model);
  return {
    binaryInstalled,
    serverRunning,
    modelAvailable,
    models,
    model,
    version: probe?.version,
    home: opts.layout.home,
    bin: opts.layout.bin,
    port,
    ready: isSetupComplete({ binaryInstalled, serverRunning, modelAvailable }),
  };
}

// ── High-level orchestrator used by the main process ────────────────────────────

export interface SetupOpts {
  layout: OllamaLayout;
  env: NodeJS.ProcessEnv;
  platform?: OllamaPlatform;
  arch?: string;
  host?: string;
  port?: number;
  model?: string;
  spawnImpl?: typeof spawn;
  spawnSyncImpl?: typeof spawnSync;
  fetchImpl?: typeof fetch;
  existsSyncImpl?: typeof existsSync;
  mkdirSyncImpl?: typeof mkdirSync;
  chmodSyncImpl?: typeof chmodSync;
  rmSyncImpl?: typeof rmSync;
  waitForReady?: (host: string, port: number, timeoutMs?: number) => Promise<void>;
  onProgress?: (p: OllamaProgress) => void;
  log?: (msg: string) => void;
}

// Run the full first-time setup: install the binary, start the server, and pull
// the model — skipping any step that's already done. Emits progress events and
// returns the final status. The caller keeps the returned handle's server alive
// for the process lifetime.
export async function runSetup(
  opts: SetupOpts,
  handleRef: { handle: OllamaHandle | null }
): Promise<OllamaStatus> {
  const plat = (opts.platform ?? (process.platform as OllamaPlatform)) as OllamaPlatform;
  const archName = opts.arch || process.arch; // "arm64" | "x64"
  const host = opts.host || "127.0.0.1";
  const port = opts.port || ollamaPort(opts.env);
  const model = opts.model || ollamaModelName(opts.env);
  const emit = opts.onProgress ?? (() => {});
  const log = opts.log ?? ((m: string) => console.log(m));

  const exists = opts.existsSyncImpl ?? existsSync;
  emit({ phase: "checking", message: "Checking for Ollama…" });

  // 1. Ensure the binary is installed (download if missing).
  if (!exists(opts.layout.bin)) {
    emit({ phase: "downloading", message: "Downloading Ollama…" });
    await ensureBinary(opts.layout, opts.env, plat, archName, {
      spawnSyncImpl: opts.spawnSyncImpl,
      existsSyncImpl: opts.existsSyncImpl,
      mkdirSyncImpl: opts.mkdirSyncImpl,
      chmodSyncImpl: opts.chmodSyncImpl,
      rmSyncImpl: opts.rmSyncImpl,
      log,
    });
    emit({ phase: "extracting", message: "Ollama installed" });
  }

  // 2. Start the server if it isn't running.
  const probe = await probeServer(host, port, opts.fetchImpl);
  if (!probe) {
    emit({ phase: "starting", message: "Starting Ollama…" });
    const handle = await startServer({
      binPath: opts.layout.bin,
      home: opts.layout.home,
      host,
      port,
      env: opts.env,
      spawnImpl: opts.spawnImpl,
      waitForReady: opts.waitForReady,
      log,
    });
    handleRef.handle = handle;
  }

  // 3. Pull the model if it isn't present.
  const pre = probe?.models ?? [];
  const already = isModelPulled(pre, model);
  if (!already) {
    emit({ phase: "pulling", pct: 0, message: `Downloading ${model}…` });
    await pullModel({
      binPath: opts.layout.bin,
      home: opts.layout.home,
      model,
      env: opts.env,
      spawnImpl: opts.spawnImpl,
      onProgress: (p) => emit(p),
      log,
    });
  }

  emit({ phase: "ready", message: "AI assistant ready" });

  // Re-probe to report the final, accurate status.
  const finalProbe = await probeServer(host, port, opts.fetchImpl);
  const models = finalProbe?.models ?? pre;
  return {
    binaryInstalled: true,
    serverRunning: !!finalProbe,
    modelAvailable: isModelPulled(models, model),
    models,
    model,
    version: finalProbe?.version,
    home: opts.layout.home,
    bin: opts.layout.bin,
    port,
    ready: !!finalProbe && isModelPulled(models, model),
  };
}

// ── Stop ───────────────────────────────────────────────────────────────────────

// Stop a running server: SIGTERM, then SIGKILL as a backstop. Idempotent.
export function stopOllama(
  server: ChildProcess | null | undefined,
  log: (m: string) => void = () => {}
): Promise<void> {
  if (!server || server.killed) return Promise.resolve();
  log("[ollama] stopping server");
  server.kill("SIGTERM");
  return new Promise((resolve) => {
    const kill = setTimeout(() => {
      if (!server.killed) server.kill("SIGKILL");
      resolve();
    }, 10000);
    server.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
  });
}
