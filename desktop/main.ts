// Trivio — macOS desktop shell (Electron main process)
//
// A thin native wrapper around the Next.js web app. The main process either
// boots the bundled Next.js "standalone" server on a private loopback port
// (local mode), loads the `next dev` server (dev mode), or loads an
// already-hosted web URL (remote / thin-client mode). The UI itself is
// unchanged — we only add a native window, menu bar, document-style
// behaviour, and an installable .app/.dmg.
//
// A packaged Electron app ships no standalone `node` binary, so when we need
// to run the bundled server.js we launch the Electron executable itself with
// ELECTRON_RUN_AS_NODE=1, which makes it behave as a plain Node runtime.
//
// Run modes (env DESKTOP_MODE, default "auto"):
//   dev    load http://127.0.0.1:3000          (pair with `next dev`)
//   local  boot the assembled server dir on a free port, then load it
//   remote load ELECTRON_REMOTE_URL / TARGET_URL — no local server
//   auto   local if an assembled server dir exists, else dev

import {
  app,
  BrowserWindow,
  Menu,
  shell,
  dialog,
  ipcMain,
  protocol,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import {
  decideDatabaseMode,
  startEmbeddedDatabase,
  stopDatabaseProcess,
  type DatabaseHandle,
} from "./embedded/embedded-db";


// ── Ollama (local AI) engine lifecycle ─────────────────────────────────────────
// The desktop shell owns a local Ollama server + Gemma model so the AI chat can
// run fully offline. We keep the engine's running handle and the env the server
// was started with; the server-env integration (buildServerEnv) points the
// embedded Next.js app at this loopback Ollama.
import {
  buildLayout,
  runSetup,
  getStatus,
  startServer,
  stopOllama,
  ollamaPort,
  ollamaModelName,
  ollamaServerUrl,
  type OllamaHandle,
  type OllamaStatus,
  type OllamaProgress,
} from "./embedded/ollama";

// Module-level engine state.
let ollamaHandleRef: { handle: OllamaHandle | null } = { handle: null };
let ollamaLayout = null as ReturnType<typeof buildLayout> | null;
let ollamaEnv: NodeJS.ProcessEnv = { ...process.env };
let ollamaSetupInProgress = false;

function getOllamaLayout() {
  if (!ollamaLayout) ollamaLayout = buildLayout(process.env, app.getPath("userData"));
  return ollamaLayout;
}

// Broadcast a progress/status snapshot to every open window so the onboarding,
// settings, and chat UIs can reflect the engine's state in real time.
function broadcastOllamaProgress(p: OllamaProgress): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("ollama:progress", p);
   }
}

function broadcastOllamaStatus(s: OllamaStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("ollama:status", s);
   }
}

// Point the embedded Next.js server at the local Ollama engine. The chat route
// (app/api/chat/route.ts) reads AI_PROVIDER / OLLAMA_HOST / OLLAMA_PORT /
// OLLAMA_MODEL; when the desktop shell owns the engine we default the provider
// to "ollama" and point it at our loopback server. An explicit value the user
// set in ~/.trivio/.env still wins.
function applyOllamaToServerEnv(env: NodeJS.ProcessEnv): void {
  const layout = getOllamaLayout();
  const port = ollamaPort(env);
  ollamaEnv = env;
  if (!env.AI_PROVIDER) env.AI_PROVIDER = "ollama";
  if (!env.OLLAMA_HOST) env.OLLAMA_HOST = ollamaServerUrl("127.0.0.1", port);
  if (!env.OLLAMA_PORT) env.OLLAMA_PORT = String(port);
  if (!env.OLLAMA_MODEL) env.OLLAMA_MODEL = ollamaModelName(env);
  void layout;
}

// Kick off a full setup (download binary → start server → pull model), guarding
// against concurrent runs. Safe to call from multiple entry points (onboarding,
// settings, chat prompt) — the guard makes it idempotent.
async function triggerOllamaSetup(): Promise<OllamaStatus> {
  if (ollamaSetupInProgress) {
    console.log("[ollama] setup already in progress — reusing");
    return getStatus({ layout: getOllamaLayout(), env: ollamaEnv });
   }
  ollamaSetupInProgress = true;
  try {
    const status = await runSetup({
      layout: getOllamaLayout(),
      env: ollamaEnv,
      onProgress: broadcastOllamaProgress,
      log: (m) => console.log(m),
     }, ollamaHandleRef);
    broadcastOllamaStatus(status);
    return status;
   } finally {
    ollamaSetupInProgress = false;
   }
}


// The local AI engine (Ollama + a Gemma model) that the desktop shell OWNS: it
// downloads the Ollama binary into the user's data dir, runs `ollama serve` on a
// private loopback port, and pulls the model — so the user never touches a
// terminal. The embedded Next.js server points its "ollama" chat provider at
// this instance (see buildServerEnv). All decisions are pure/injectable in
// ./embedded/ollama; here we only wire it to IPC + the server env.
import {
  buildLayout,
  getStatus,
  runSetup,
  startServer,
  stopOllama,
  ollamaModelName,
  type OllamaHandle,
  type OllamaStatus,
  type OllamaProgress,
} from "./embedded/ollama";

// Register the trivio:// deep-link scheme as a privileged/standard scheme so the
// renderer can link to it and the OS routes trivio:// URLs to this app. Must run
// before app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: "trivio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ── Paths & mode ─────────────────────────────────────────────────────────────

type Mode = "dev" | "local" | "remote" | "auto";

function resolveMode(): Mode {
  return (process.env.DESKTOP_MODE || "auto").toLowerCase() as Mode;
}

// Directory that holds the Next.js build. In dev it is the project root
// (compiled main lives in desktop/dist, so two levels up); when packaged it is
// the electron-builder resources dir.
function appRoot(): string {
  if (process.env.APP_DIR) return process.env.APP_DIR;
  if (app.isPackaged) return process.resourcesPath;
  return resolve(__dirname, "..", "..");
}

// Where the assembled runnable server lives (server.js + static/ + public/).
function serverDir(): string {
  if (process.env.APP_SERVER_DIR) return process.env.APP_SERVER_DIR;
  // Assembled by electron-builder into the app's resources, or by our assemble
  // step into desktop/dist-server for local runs.
  if (app.isPackaged) return join(process.resourcesPath, "app-server");
  return join(appRoot(), "desktop", "dist-server");
}

// ── Local server lifecycle ───────────────────────────────────────────────────

let server: ChildProcess | null = null;
let dbHandle: DatabaseHandle | null = null;

function getFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => res(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
}

// Poll the app's health route until the server answers.
async function waitForServer(url: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res && res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for the app server at ${url}`);
}

// Load the user's env so the embedded server has DB/Redis/AI credentials.
// Later sources win over earlier: TRIVIO_ENV_FILE → ~/.trivio/.env → the
// server dir → the app root. The real process env always wins for PORT/HOSTNAME.
function buildServerEnv(base: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // First-run onboarding: seed ~/.trivio/.env from the bundled template so the
  // user has a file to fill in. Real credentials stay in the user home dir,
  // never inside the signed app bundle (assemble-server ships only .env.example).
  const userEnv = join(homedir(), ".trivio", ".env");
  if (
    !process.env.TRIVIO_ENV_FILE &&
    !existsSync(userEnv) &&
    existsSync(join(base, ".env.example"))
  ) {
    try {
      mkdirSync(join(homedir(), ".trivio"), { recursive: true });
      writeFileSync(userEnv, readFileSync(join(base, ".env.example"), "utf8"));
      console.log("[desktop] seeded ~/.trivio/.env from template — fill in your credentials");
    } catch (err) {
      console.warn("[desktop] could not seed ~/.trivio/.env:", err);
    }
  }

  const paths = [
    process.env.TRIVIO_ENV_FILE,
    join(homedir(), ".trivio", ".env"),
    join(base, ".env"),
    join(appRoot(), ".env"),
  ];
  for (const p of paths) {
    if (!p || !existsSync(p)) continue;
    let raw: string;
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, unquoted] = m;
      // Preserve explicit shell overrides for everything except the two we
      // deliberately re-point (PORT/HOSTNAME) below.
      if (key in env && key !== "PORT" && key !== "HOSTNAME") continue;
      let value = unquoted.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    console.log(`[desktop] loaded env from ${p}`);
  }
  return env as NodeJS.ProcessEnv;
}

// Boot the assembled Next.js standalone server on a private loopback port and
// point NextAuth at it so session callbacks validate correctly.
async function startLocalServer(): Promise<string> {
  const dir = serverDir();
  const serverJs = join(dir, "server.js");
  if (!existsSync(serverJs)) {
    throw new Error(
      `Embedded server not found at ${serverJs}.\n` +
        "Run `npm run build:server` (assembles desktop/dist-server) or " +
        "`npm run build:desktop`, or use DESKTOP_MODE=dev / DESKTOP_MODE=remote."
    );
  }

  const port = await getFreePort();
  const env = buildServerEnv(dir);
  Object.assign(env, {
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
    AUTH_TRUST_HOST: "true",
    // Server-side flag: this instance is bound to loopback only and never
    // reachable off-machine, so IP-based rate limiting has no abuse surface
    // to defend and would otherwise lock every real user out of their own
    // single-tenant install after a handful of retries (all share 127.0.0.1).
    // See server/middleware/rateLimit.ts.
    TRIVIO_DESKTOP_EMBEDDED: "true",
    // The desktop app is a single-tenant local install with no guarantee an
    // email provider (Resend) is configured, so the verification round-trip
    // would leave users permanently unable to sign in. See server/routers/auth.ts.
    SKIP_EMAIL_VERIFICATION: "true",
  });

  // ── Database ──────────────────────────────────────────────────────────────
  // By default the desktop app owns its OWN embedded Postgres inside the user's
  // data dir (see desktop/embedded/embedded-db.ts) — no external server, no
  // docker container. Embedded is the DEFAULT: a bare DATABASE_URL (e.g. the one
  // in the shared .env.example) does NOT bypass it. An external database is
  // selected only via TRIVIO_DATABASE_MODE=external or TRIVIO_DATABASE_URL
  // (a hosted SaaS instance, a dev box, CI) — then no engine is started and the
  // same server code runs unchanged everywhere.
  const dbMode = decideDatabaseMode(env);
  if (dbMode === "embedded") {
    const ignoredExternalUrl = env.DATABASE_URL;
    const db = await startEmbeddedDatabase({
      env,
      userDataDir: app.getPath("userData"),
      resourcesDir: app.isPackaged ? process.resourcesPath : join(appRoot(), "desktop", "embedded"),
      serverDir: dir,
      isPackaged: app.isPackaged,
    });
    dbHandle = db;
    env.DATABASE_URL = db.url;
    env.TRIVIO_DATABASE_URL = db.url;
    console.log(`[desktop] using built-in embedded Postgres at ${db.dataDir} (${db.url})`);
    if (ignoredExternalUrl) {
      console.log(
        `[desktop] note: a bare DATABASE_URL ("${ignoredExternalUrl}") was ignored — the built-in ` +
          `engine is the default. Set TRIVIO_DATABASE_MODE=external (or TRIVIO_DATABASE_URL) to use it.`
      );
    }
  } else {
    console.log("[desktop] using external DATABASE_URL from environment");
  }

  // A packaged Electron app ships no standalone `node` binary, so we launch the
  // Electron executable itself as a Node runtime (ELECTRON_RUN_AS_NODE) to host
  // server.js. In dev we use whatever `node` the dev loop is using.
  const execArgv = [serverJs];
  const cmd = app.isPackaged ? process.execPath : "node";
  const childEnv: NodeJS.ProcessEnv = { ...env };
  if (app.isPackaged) childEnv.ELECTRON_RUN_AS_NODE = "1";
  // Silence the noisy "localStorage not available" ExperimentalWarning from the
  // embedded server. This must go through NODE_OPTIONS: a Node runtime flag placed
  // after the script path (e.g. `[serverJs, "--no-warnings=..."]`) is ignored by
  // Node and merely becomes an argv entry the server never reads.
  childEnv.NODE_OPTIONS = [childEnv.NODE_OPTIONS, "--no-warnings=ExperimentalWarning"]
    .filter(Boolean)
    .join(" ");

  console.log(`[desktop] starting app server: ${cmd} ${execArgv.join(" ")} @127.0.0.1:${port}`);
  server = spawn(cmd, execArgv, {
    cwd: dir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  server.stdout?.on("data", (d: Buffer) => {
    const s = String(d).trimEnd();
    if (s) console.log(`[next] ${s}`);
  });
  server.stderr?.on("data", (d: Buffer) => {
    const s = String(d).trimEnd();
    if (s) console.error(`[next:err] ${s}`);
  });
  server.on("exit", (code) => {
    console.log(`[desktop] app server exited code=${code ?? 0}`);
    server = null;
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  console.log(`[desktop] app server ready at ${url}`);
  return url;
}

function stopServer(): void {
  if (server && !server.killed) {
    console.log("[desktop] stopping embedded app server");
    server.kill("SIGTERM");
    const kill = setTimeout(() => {
      if (server && !server.killed) server.kill("SIGKILL");
    }, 5000);
    server.once("exit", () => clearTimeout(kill));
    server = null;
  }
}

// ── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    // Native macOS chrome with the traffic-light buttons inset over the app's
    // top bar, which has safe top padding so they never overlap content.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 16 },
    backgroundColor: "#0b0d10",
    show: false,
    title: "Trivio",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses a small amount of node via contextBridge
    },
  });

  // Reveal only after first paint to avoid a white flash.
  win.once("ready-to-show", () => {
    win.show();
    // Flush a deep link that arrived before the window was ready (a cold-start
    // trivio:// launch), then run the optional update check.
    flushPendingDeepLink();
    void runUpdateCheck();
  });

  // Open external http(s) links in the user's default browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !/^(http:\/\/127\.0\.0\.1|http:\/\/localhost)/.test(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const external =
      /^https?:\/\//i.test(url) && !/^(http:\/\/127\.0\.0\.1|http:\/\/localhost)/.test(url);
    if (external) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow = win;
  return win;
}

// ── IPC bridge (from preload) ────────────────────────────────────────────────

function registerIpc(): void {
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
    return undefined;
  });
  ipcMain.handle("shell:openItem", (_e, path: string) => shell.openPath(path));
  ipcMain.handle("dialog:showMessageBox", (event, opts) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return dialog.showMessageBox(win ?? (undefined as unknown as BrowserWindow), opts);
  });
  // In-app navigation / deep-link from the renderer bridge.
  ipcMain.on("window:navigate", (_e, target: string) => {
    const url = target.startsWith("http")
      ? target
      : `${chosenUrlForNav()}${target.startsWith("/") ? target : "/" + target}`;
    mainWindow?.webContents.loadURL(url);
  });
}

function chosenUrlForNav(): string {
  return mainWindow?.webContents.getURL() || "http://127.0.0.1:3000";
}

// ── Deep links (trivio://) & auto-updater ──────────────────────────────────

// A trivio:// URL (e.g. trivio://settings/security, trivio://update) asks the
// in-app web layer to navigate to a route. On macOS it arrives via `open-url`;
// on Windows/Linux it arrives in the second-instance argv. We forward it to the
// live renderer on the `deep-link` channel; if no window is up yet (a cold-start
// trivio:// launch) we queue it and flush once the window loads.
const DEEP_LINK_SCHEME = "trivio";
let pendingDeepLinkRaw: string | null = null;

function parseDeepLink(raw: string): { path: string; query: string } {
  const withoutScheme = raw.replace(new RegExp(`^${DEEP_LINK_SCHEME}://`, "i"), "");
  const [pathPart, queryPart] = withoutScheme.split("?", 2);
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart || ""}`;
  return { path, query: queryPart ? `?${queryPart}` : "" };
}

function sendDeepLink(raw: string): void {
  const { path, query } = parseDeepLink(raw);
  mainWindow?.webContents.send("deep-link", { raw, path, query });
}

function dispatchDeepLink(raw: string): void {
  console.log(`[desktop] deep link -> ${raw}`);
  if (!mainWindow || !mainWindow.isVisible()) {
    pendingDeepLinkRaw = raw;
    return;
  }
  sendDeepLink(raw);
}

function flushPendingDeepLink(): void {
  if (!pendingDeepLinkRaw) return;
  const raw = pendingDeepLinkRaw;
  pendingDeepLinkRaw = null;
  sendDeepLink(raw);
}

// Auto-updater. electron-updater reads the feed from the app-update.yml that
// electron-builder writes into Resources/ (generic provider). Point it at a
// hosted feed by setting UPDATE_FEED_URL at build/run time. Checks only run in a
// packaged build and only when a feed is configured, so an unsigned / dev build
// never hits the network.
//
// Loaded lazily and guarded so the shell still boots if the updater package is
// unavailable at runtime.
interface MinimalUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(url: string): void;
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
  on(event: string, cb: (...args: unknown[]) => void): void;
  quitAndInstall(): void;
}

function getUpdater(): MinimalUpdater | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { autoUpdater } = require("electron-updater") as { autoUpdater: MinimalUpdater };
    return autoUpdater;
  } catch (err) {
    console.warn("[desktop] electron-updater unavailable — updates disabled:", err);
    return null;
  }
}

// Parent the native dialog on the main window when it exists, otherwise show it
// parent-less. Electron accepts both the parented and options-only overload;
// the helper keeps the call sites type-correct when the window has closed.
function showDialog(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  return mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
}

function updaterFeedConfigured(): boolean {
  return (
    Boolean(process.env.UPDATE_FEED_URL) ||
    existsSync(join(process.resourcesPath, "app-update.yml"))
  );
}

function runUpdateCheck(): void {
  if (!app.isPackaged) {
    void showDialog({
      type: "info",
      title: "Trivio",
      message: "Updates are only checked in the installed app.",
      buttons: ["OK"],
    });
    return;
  }
  const updater = getUpdater();
  if (!updater) return;
  if (!updaterFeedConfigured()) {
    console.log("[desktop] no update feed configured — skipping check");
    return;
  }
  if (process.env.UPDATE_FEED_URL) updater.setFeedURL(process.env.UPDATE_FEED_URL);
  void updater
    .checkForUpdates()
    .then((res) => {
      const v = res?.updateInfo?.version;
      if (v && v !== app.getVersion()) console.log(`[desktop] update available: ${v}`);
      else console.log("[desktop] already on the latest version");
    })
    .catch((err) => console.warn("[desktop] update check failed:", err));
}

function setupUpdater(): void {
  if (!app.isPackaged) return;
  const updater = getUpdater();
  if (!updater) return;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("update-downloaded", (info) => {
    const version = (info as { version?: string })?.version;
    void showDialog({
      type: "info",
      title: "Trivio",
      message: `A new version${version ? ` (${version})` : ""} of Trivio is ready.`,
      detail: "Restart the app to finish the update.",
      buttons: ["Restart", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) updater.quitAndInstall();
    });
  });
  updater.on("error", (err) => console.warn("[desktop] auto-updater error:", err));
}

// ── Native menu ──────────────────────────────────────────────────────────────

function buildMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Open in Browser",
          accelerator: "CmdOrCtrl+Shift+B",
          click: () => {
            const url = mainWindow?.webContents.getURL();
            if (url) void shell.openExternal(url);
          },
        },
        {
          label: "Check for Updates…",
          click: () => runUpdateCheck(),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [{ role: "close" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        {
          label: "Developer Tools",
          accelerator: process.platform === "darwin" ? "Alt+CmdOrCtrl+I" : "Ctrl+Shift+I",
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App lifecycle ────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    // On Windows/Linux a trivio:// URL is delivered as an argv entry here.
    const link = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (link) dispatchDeepLink(link);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS routes a trivio:// URL here while the app is already running.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    dispatchDeepLink(url);
  });

  app.whenReady().then(async () => {
    buildMenu();
    registerIpc();
    setupUpdater();

    const mode = resolveMode();
    const assembledExists = existsSync(join(serverDir(), "server.js"));
    const runMode: Mode =
      mode === "dev"
        ? "dev"
        : mode === "remote"
          ? "remote"
          : mode === "local"
            ? "local"
            : assembledExists
              ? "local"
              : "dev";

    let url =
      runMode === "remote"
        ? process.env.ELECTRON_REMOTE_URL || process.env.TARGET_URL || "https://app.trivio-ai.com"
        : devUrl();

    if (runMode === "local") {
      try {
        url = await startLocalServer();
      } catch (err) {
        console.error("[desktop] embedded server failed:", err);
        dialog.showErrorBox(
          "Trivio",
          `Could not start the embedded app server.

${err instanceof Error ? err.message : String(err)}

You can also run Trivio in thin-client mode by setting DESKTOP_MODE=remote.`
        );
        app.quit();
        return;
      }
    }

    const win = createWindow();
    win
      .loadURL(url)
      .catch((e) => dialog.showErrorBox("Trivio", `Failed to load ${url}:\n${String(e)}`));

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.focus();
    });
  });
}

// Gracefully stop the embedded server AND the embedded Postgres engine on
// every quit path, so the app never leaves a database process behind.
async function stopAll(): Promise<void> {
  stopServer();
  await stopDatabase();
}

// Tear down the embedded engine if one is running. Idempotent; never throws.
async function stopDatabase(): Promise<void> {
  if (!dbHandle) return;
  const handle = dbHandle;
  dbHandle = null;
  try {
    await handle.stop();
    console.log("[desktop] embedded Postgres stopped");
  } catch (err) {
    console.error("[desktop] error stopping embedded Postgres:", err);
  }
}

app.on("window-all-closed", () => {
  void stopAll();
  // Keep the app alive in the dock on macOS (standard behaviour).
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void stopAll();
});
process.on("SIGINT", () => {
  void stopAll().then(() => app.quit());
});
process.on("SIGTERM", () => {
  void stopAll().then(() => app.exit(0));
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// dev server URL (ELECTRON_DEV_URL / DEV_SERVER_URL override, else 3000).
function devUrl(): string {
  return process.env.ELECTRON_DEV_URL || process.env.DEV_SERVER_URL || "http://127.0.0.1:3000";
}
