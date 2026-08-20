// Trivio desktop — runtime behaviour test for the compiled Electron shell.
//
// Loads the REAL compiled main.cjs with a mocked `electron` module and drives its
// lifecycle, asserting the shell's logic without a GUI. Parameterised by
// SCENARIO=dev|remote|local (each scenario runs in its own process because it
// patches Module._load / global.fetch / child_process).
//
// Usage: SCENARIO=remote node desktop/test-shell.scenario.cjs

const Module = require("node:module");
const cp = require("node:child_process");
const { EventEmitter } = require("node:events");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const pathMod = require("node:path");

const SCENARIO = process.env.SCENARIO || "remote";
// The compiled shell reads DESKTOP_MODE to pick its run mode; derive it from the
// scenario so this file is runnable standalone (SCENARIO=remote|local) or via the
// runner. Default a remote URL so remote assertions have a value to compare.
process.env.DESKTOP_MODE = SCENARIO;
if (SCENARIO === "remote" && !process.env.ELECTRON_REMOTE_URL) {
  process.env.ELECTRON_REMOTE_URL = "https://app.trivio.example";
}
let PASS = 0,
  FAIL = 0;
const out = [];
function ok(name, cond, extra) {
  if (cond) {
    PASS++;
    out.push("PASS     " + name);
  } else {
    FAIL++;
    out.push("FAIL     " + name + (extra ? "     :: " + extra : ""));
  }
}

// ── electron mock ────────────────────────────────────────────────────────────
const events = new Map();
const ipcHandles = new Map();
const ipcOns = new Map();
const fakeWindows = [];
const shellExternal = [];
const shellItems = [];
const dialogBoxes = [];
let menuTemplate = null,
  menuSet = false;
let schemes = null;

class FakeWC {
  constructor() {
    this.url = "about:blank";
    this.handlers = new Map();
    this.openHandler = null;
    this.sent = [];
    this._closed = false;
  }
  getURL() {
    return this.url;
  }
  loadURL(u) {
    this.url = u;
    return Promise.resolve(u);
  }
  send(channel, payload) {
    this.sent.push({ channel, payload });
  }
  setWindowOpenHandler(cb) {
    this.openHandler = cb;
  }
  on(ev, cb) {
    const a = this.handlers.get(ev) || this.handlers.set(ev, []).get(ev);
    a.push(cb);
  }
  emit(ev, ...args) {
    for (const cb of this.handlers.get(ev) || []) cb(...args);
  }
  toggleDevTools() {}
  isVisible() {
    return !this._closed;
  }
  isMinimized() {
    return false;
  }
  restore() {}
  focus() {}
}
class FakeWin {
  constructor(opts) {
    this.opts = opts;
    this.webContents = new FakeWC();
    this._rt = [];
    this._closed = false;
    fakeWindows.push(this);
  }
  loadURL(u) {
    return this.webContents.loadURL(u);
  }
  show() {}
  once(ev, cb) {
    if (ev === "ready-to-show") this._rt.push(cb);
  }
  on(ev, cb) {}
  isVisible() {
    return !this._closed;
  }
  isMinimized() {
    return false;
  }
  restore() {}
  focus() {}
  static getAllWindows() {
    return fakeWindows.filter((w) => !w._closed);
  }
  static fromWebContents(wc) {
    return fakeWindows.find((w) => w.webContents === wc) || undefined;
  }
}
function emitApp(ev, ...args) {
  for (const cb of events.get(ev) || []) cb(...args);
}

const mockElectron = {
  app: {
    isPackaged: false,
    name: "Trivio",
    resourcesPath: "/tmp/trivio-res",
    requestSingleInstanceLock() {
      return true;
    },
    on(ev, cb) {
      const a = events.get(ev) || events.set(ev, []).get(ev);
      a.push(cb);
    },
    whenReady() {
      return __readyPromise;
    },
    getPath(name) {
      return name === "userData" ? "/tmp/trivio-userdata" : "/tmp/trivio-" + name;
    },
    quit() {},
    exit() {},
    getVersion() {
      return "0.1.0";
    },
  },
  BrowserWindow: FakeWin,
  Menu: {
    setApplicationMenu() {
      menuSet = true;
    },
    buildFromTemplate(t) {
      menuTemplate = t;
      return { template: t };
    },
  },
  shell: {
    openExternal(u) {
      shellExternal.push(u);
      return Promise.resolve();
    },
    openPath(p) {
      shellItems.push(p);
      return Promise.resolve("");
    },
  },
  dialog: {
    showMessageBox(a, b) {
      let win, opts;
      if (b !== undefined) {
        win = a;
        opts = b;
      } else {
        win = undefined;
        opts = a;
      }
      dialogBoxes.push({ win, opts });
      return Promise.resolve({ response: 0, checkboxChecked: false });
    },
    showErrorBox() {
      return Promise.resolve();
    },
  },
  ipcMain: {
    handle(ch, fn) {
      ipcHandles.set(ch, fn);
    },
    on(ch, fn) {
      ipcOns.set(ch, fn);
    },
  },
  protocol: {
    registerSchemesAsPrivileged(arr) {
      schemes = arr;
    },
  },
};
let resolveReady;
const __readyPromise = new Promise((r) => {
  resolveReady = r;
});

// ── local-mode mocks (socket-free env/argv assertions) ──────────────────────
let capturedSpawn = null;
let fakeNet = null;
if (SCENARIO === "local") {
  // Hermetic: point the shell at a throwaway dir containing a stub server.js so
  // the scenario doesn't depend on a real `npm run build:server` artifact.
  // startLocalServer only stat-s server.js; spawn/net/fetch are all mocked.
  const stubDir = mkdtempSync(pathMod.join(tmpdir(), "trivio-srv-"));
  writeFileSync(pathMod.join(stubDir, "server.js"), "// stub for test\nprocess.exit(0);\n");
  process.env.APP_SERVER_DIR = stubDir;
  // Use an EXTERNAL database so this hermetic scenario never needs a real
  // Postgres engine/binary; the embedded-DB lifecycle is covered by
  // tests/unit/embedded-db.test.ts. main.ts threads DATABASE_URL into the
  // child env, which we assert below.
  process.env.TRIVIO_DATABASE_MODE = "external";
  process.env.DATABASE_URL = "postgresql://trivio:trivio@127.0.0.1:5432/trivio_test";
  process.on("exit", () => {
    try {
      rmSync(stubDir, { recursive: true, force: true });
    } catch {}
  });
  fakeNet = {
    createServer() {
      const srv = new EventEmitter();
      srv._addr = { port: 3999, address: "127.0.0.1", family: "IPv4" };
      srv.listen = function (_p, _h, cb) {
        if (typeof cb === "function") setTimeout(cb, 0);
        return srv;
      };
      srv.address = () => srv._addr;
      srv.close = function (cb) {
        if (typeof cb === "function") setTimeout(cb, 0);
      };
      srv.once = function (ev, cb) {
        this.on(ev, cb);
      };
      return srv;
    },
  };
  cp.spawn = function (cmd, args, opts) {
    capturedSpawn = {
      cmd,
      args,
      env: opts && opts.env,
      stdio: opts && opts.stdio,
      cwd: opts && opts.cwd,
    };
    const child = new EventEmitter();
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  };
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
}

const origLoad = Module._load;
Module._load = function (request) {
  if (request === "electron") return mockElectron;
  if (request === "electron-updater")
    return {
      autoUpdater: {
        autoDownload: false,
        autoInstallOnAppQuit: false,
        setFeedURL() {},
        checkForUpdates: async () => null,
        on() {},
        quitAndInstall() {},
      },
    };
  if ((request === "net" || request === "node:net") && fakeNet) return fakeNet;
  return origLoad.apply(this, arguments);
};

const MAIN = require("node:path").resolve(__dirname, "dist", "main.cjs");

async function run() {
  require(MAIN);
  ok(
    "protocol.registerSchemesAsPrivileged registered trivio scheme",
    schemes && schemes[0].scheme === "trivio" && schemes[0].privileges.standard === true,
    JSON.stringify(schemes && schemes[0])
  );

  resolveReady();
  await new Promise((r) => setTimeout(r, SCENARIO === "local" ? 200 : 50));

  if (SCENARIO === "local") {
    ok("local mode spawned the embedded server", !!capturedSpawn);
    if (capturedSpawn) {
      ok(
        "exec args are exactly [server.js] (no stray flags)",
        Array.isArray(capturedSpawn.args) &&
          capturedSpawn.args.length === 1 &&
          /server\.js$/.test(capturedSpawn.args[0]),
        JSON.stringify(capturedSpawn.args)
      );
      ok(
        "child env NODE_OPTIONS carries --no-warnings=ExperimentalWarning",
        typeof capturedSpawn.env.NODE_OPTIONS === "string" &&
          /--no-warnings=ExperimentalWarning/.test(capturedSpawn.env.NODE_OPTIONS),
        JSON.stringify(capturedSpawn.env.NODE_OPTIONS)
      );
      ok(
        "child env NEXTAUTH_URL points at the loopback port",
        /127\.0\.0\.1:/.test(capturedSpawn.env.NEXTAUTH_URL || ""),
        JSON.stringify(capturedSpawn.env.NEXTAUTH_URL)
      );
      ok("child env AUTH_TRUST_HOST=true", capturedSpawn.env.AUTH_TRUST_HOST === "true");
      ok(
        "child cwd is the server dir (APP_SERVER_DIR)",
        capturedSpawn.cwd === process.env.APP_SERVER_DIR,
        JSON.stringify(capturedSpawn.cwd)
      );
      ok(
        "window loaded the loopback url",
        fakeWindows.length === 1 && /127\.0\.0\.1:\d+$/.test(fakeWindows[0].webContents.url),
        fakeWindows[0] && fakeWindows[0].webContents.url
      );
      ok(
        "local mode threads DATABASE_URL into the embedded server env",
        typeof capturedSpawn.env.DATABASE_URL === "string" &&
          /postgres(ql)?:\/\//.test(capturedSpawn.env.DATABASE_URL),
        JSON.stringify(capturedSpawn.env.DATABASE_URL)
      );
    }
  } else {
    ok(
      "exactly one BrowserWindow created",
      fakeWindows.length === 1,
      "count=" + fakeWindows.length
    );
    const win = fakeWindows[0];
    // Non-local modes (remote/dev) load a URL without booting the embedded server.
    // remote reads ELECTRON_REMOTE_URL/TARGET_URL; dev reads devUrl() (ELECTRON_DEV_URL
    // / DEV_SERVER_URL, defaulting to 127.0.0.1:3000). Mirror the shell's resolution.
    const expectedUrl =
      SCENARIO === "dev"
        ? process.env.ELECTRON_DEV_URL || process.env.DEV_SERVER_URL || "http://127.0.0.1:3000"
        : process.env.ELECTRON_REMOTE_URL || process.env.TARGET_URL || "https://app.trivio-ai.com";
    ok(
      SCENARIO + " mode loads the expected URL",
      win && win.webContents.url === expectedUrl,
      "url=" + (win && win.webContents.url)
    );
    ok(
      "application menu built with File/Edit/View/Window",
      menuSet &&
        menuTemplate &&
        ["File", "Edit", "View", "Window"].every((l) => menuTemplate.some((m) => m.label === l)),
      JSON.stringify(menuTemplate && menuTemplate.map((m) => m.label))
    );
    ok(
      "IPC handlers registered",
      ipcHandles.has("shell:openExternal") &&
        ipcHandles.has("shell:openItem") &&
        ipcHandles.has("dialog:showMessageBox") &&
        ipcOns.has("window:navigate")
    );
    for (const cb of (win && win._rt) || []) cb();
    await new Promise((r) => setTimeout(r, 30));
    ok(
      "unpackaged update check shows info dialog (no network)",
      dialogBoxes.length >= 1 &&
        /installed app/i.test((dialogBoxes[0].opts && dialogBoxes[0].opts.message) || ""),
      JSON.stringify(dialogBoxes[0] && dialogBoxes[0].opts && dialogBoxes[0].opts.message)
    );
    await ipcHandles.get("shell:openExternal")({}, "https://example.com/login");
    ok("openExternal forwards https", shellExternal.includes("https://example.com/login"));
    await ipcHandles.get("shell:openExternal")({}, "file:///tmp/x");
    ok(
      "openExternal blocks non-http scheme",
      shellExternal.length === 1,
      JSON.stringify(shellExternal)
    );
    await ipcHandles.get("shell:openItem")({}, "/tmp/some/file");
    ok("openItem forwards to shell.openPath", shellItems.includes("/tmp/some/file"));
    const dlg = await ipcHandles.get("dialog:showMessageBox")(
      { sender: null },
      { message: "hi", buttons: ["OK"] }
    );
    ok(
      "dialog:showMessageBox resolves a response",
      dlg && typeof dlg.response === "number",
      JSON.stringify(dlg)
    );
    ipcOns.get("window:navigate")({}, "/settings/security");
    ok(
      "window:navigate loads base+path",
      /\/settings\/security$/.test(win.webContents.url),
      "url=" + win.webContents.url
    );
    emitApp("open-url", { preventDefault() {} }, "trivio://settings/security");
    const dl1 = win.webContents.sent.filter((s) => s.channel === "deep-link").pop();
    ok(
      "open-url deep link parsed (path+empty query)",
      dl1 && dl1.payload.path === "/settings/security" && dl1.payload.query === "",
      JSON.stringify(dl1)
    );
    emitApp("second-instance", {}, ["electron", "trivio://update?check=1"]);
    const dl2 = win.webContents.sent.filter((s) => s.channel === "deep-link").pop();
    ok(
      "second-instance deep link parsed (path+query)",
      dl2 && dl2.payload.path === "/update" && dl2.payload.query === "?check=1",
      JSON.stringify(dl2)
    );
    const openExt = win.webContents.openHandler({ url: "https://evil.com" });
    ok(
      "setWindowOpenHandler denies external + opens in browser",
      openExt.action === "deny" && shellExternal.includes("https://evil.com"),
      JSON.stringify(openExt)
    );
    ok(
      "setWindowOpenHandler allows loopback",
      win.webContents.openHandler({ url: "http://127.0.0.1:3000/x" }).action === "allow"
    );
    let navPrev = false;
    win.webContents.emit(
      "will-navigate",
      {
        preventDefault() {
          navPrev = true;
        },
      },
      "https://evil.com/redirect"
    );
    ok(
      "will-navigate blocks external + opens in browser",
      navPrev && shellExternal.includes("https://evil.com/redirect")
    );
    let navPrev2 = false;
    win.webContents.emit(
      "will-navigate",
      {
        preventDefault() {
          navPrev2 = true;
        },
      },
      "http://127.0.0.1:3000/ok"
    );
    ok("will-navigate allows loopback (no preventDefault)", navPrev2 === false, "prev=" + navPrev2);
    let threw = false;
    try {
      emitApp("window-all-closed");
    } catch (e) {
      threw = true;
    }
    ok("window-all-closed -> stopServer idempotent", !threw);
    fakeWindows[0]._closed = true;
    const before = fakeWindows.filter((w) => !w._closed).length;
    emitApp("activate");
    await new Promise((r) => setTimeout(r, 10));
    ok(
      "activate recreates a window when none are open",
      fakeWindows.filter((w) => !w._closed).length > before
    );
  }

  console.log(out.join("\n"));
  console.log(`\n[${SCENARIO}] ==== ${PASS} passed, ${FAIL} failed ====`);
  if (FAIL > 0) process.exit(1);
}
run().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
