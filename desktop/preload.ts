// Trivio — Electron preload bridge.
//
// Runs in an isolated context with a small, explicit API exposed to the web
// app via contextBridge. The web UI is unchanged; these helpers let it behave
// like a native app (deep-linking, native dialogs, updates) without ever
// exposing `nodeIntegration`.

import { contextBridge, ipcRenderer } from "electron";

// Channels the renderer may use. Keep this list explicit and small.
const CHANNELS = {
  OPEN_EXTERNAL: "shell:openExternal",
  OPEN_ITEM: "shell:openItem",
  SHOW_MESSAGE_BOX: "dialog:showMessageBox",
  DEEP_LINK: "deep-link",
  // Ollama (local AI engine) lifecycle + notifications. The renderer never sees
  // a Node child_process or a raw port — only status/progress snapshots and a
  // handful of one-shot commands.
  OLLAMA_STATUS: "ollama:status",
  OLLAMA_SETUP: "ollama:setup",
  OLLAMA_START: "ollama:start",
  OLLAMA_PULL: "ollama:pull",
  OLLAMA_INSTALL: "ollama:install",
  OLLAMA_STOP: "ollama:stop",
  OLLAMA_PROGRESS: "ollama:progress",
  OLLAMA_STATUS_CHANGE: "ollama:status-change",
} as const;

// Map a scheme/URL so it works whether the web server is 127.0.0.1:<port>
// (local mode) or a hosted hostname (remote mode).
function resolveNativeUrl(url: string): string {
  return url;
}

// A deep-link-style intent, e.g. "trivio://settings/security" or an https
// URL. We translate the intent into an in-app navigation for local/remote.
function openIntent(intent: string): void {
  if (/^https?:\/\//i.test(intent) && !/^(http:\/\/127\.0\.0\.1|http:\/\/localhost)/.test(intent)) {
    void ipcRenderer.invoke(CHANNELS.OPEN_EXTERNAL, resolveNativeUrl(intent));
    return;
  }
  // In-app navigation: the renderer can't switch location directly through the
  // bridge, so ask the main process to load it for us.
  ipcRenderer.send("window:navigate", intent);
}

// The local AI engine sub-API. Every method is a thin, frozen wrapper over an
// IPC channel so the renderer stays free of Node/Electron surface area. The
// progress + status-change subscriptions return an unsubscribe function so the
// renderer can clean up on unmount.
const ollama = {
  // Is the engine installed / running / model present right now?
  status(): Promise<unknown> {
    return ipcRenderer.invoke(CHANNELS.OLLAMA_STATUS);
  },
  // Full first-time setup: install binary → start server → pull model. Progress
  // is streamed on the OLLAMA_PROGRESS channel (see onProgress); resolves with
  // the final status.
  setup(): Promise<unknown> {
    return ipcRenderer.invoke(CHANNELS.OLLAMA_SETUP);
  },
  // Start (or ensure running) just the server.
  start(): Promise<unknown> {
    return ipcRenderer.invoke(CHANNELS.OLLAMA_START);
  },
  // Pull the configured model (starts the server if needed).
  pull(): Promise<unknown> {
    return ipcRenderer.invoke(CHANNELS.OLLAMA_PULL);
  },
  // Download + extract just the binary.
  install(): Promise<unknown> {
    return ipcRenderer.invoke(CHANNELS.OLLAMA_INSTALL);
  },
  // Stop the running server.
  stop(): Promise<unknown> {
    return ipcRenderer.invoke(CHANNELS.OLLAMA_STOP);
  },
  // Subscribe to progress emitted during setup/install/pull. Returns unsubscribe.
  onProgress(cb: (p: unknown) => void): () => void {
    const handler = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on(CHANNELS.OLLAMA_PROGRESS, handler);
    return () => ipcRenderer.removeListener(CHANNELS.OLLAMA_PROGRESS, handler);
  },
  // Subscribe to status changes (broadcast when the engine state changes).
  // Returns unsubscribe.
  onStatusChange(cb: (s: unknown) => void): () => void {
    const handler = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on(CHANNELS.OLLAMA_STATUS_CHANGE, handler);
    return () => ipcRenderer.removeListener(CHANNELS.OLLAMA_STATUS_CHANGE, handler);
  },
} as const;

// Minimal, safe surface exposed to `window.trivioDesktop`.
const api = {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // Open an external URL in the user's default browser.
  openExternal(url: string): void {
    void ipcRenderer.invoke(CHANNELS.OPEN_EXTERNAL, resolveNativeUrl(url));
  },
  // Open a local file/folder in the OS.
  openItem(path: string): Promise<void> {
    return ipcRenderer.invoke(CHANNELS.OPEN_ITEM, path);
  },
  // In-app navigation / deep link.
  navigate(intent: string): void {
    openIntent(intent);
  },
  showMessageBox(options: {
    message: string;
    detail?: string;
    buttons?: string[];
  }): Promise<number> {
    return ipcRenderer.invoke(CHANNELS.SHOW_MESSAGE_BOX, options);
  },
  // Local AI engine (Ollama + Gemma). The renderer drives setup through this
  // only; it never touches the binary or the port directly.
  ollama,
  // Subscribe to trivio:// deep links delivered to this window. Returns an
  // unsubscribe function so the renderer can clean up on unmount.
  onDeepLink(cb: (info: { raw: string; path: string; query: string }) => void): () => void {
    const handler = (_e: unknown, info: { raw: string; path: string; query: string }) => cb(info);
    ipcRenderer.on(CHANNELS.DEEP_LINK, handler);
    return () => ipcRenderer.removeListener(CHANNELS.DEEP_LINK, handler);
  },
};

// Expose the bridge only on the expected global and only in the main frame.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "trivioDesktop", {
    value: Object.freeze(api),
    configurable: false,
    writable: false,
  });
}

// The bridge is intentionally small and frozen; no extra imports are needed.
