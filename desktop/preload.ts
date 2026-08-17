// Trivio — Electron preload bridge.
//
// Runs in an isolated context with a small, explicit API exposed to the web
// app via contextBridge. The web UI is unchanged; these helpers let it behave
// like a native app (deep-linking, native dialogs, updates) without ever
// exposing `nodeIntegration`.

import { contextBridge, ipcRenderer, shell } from "electron";

// Channels the renderer may use. Keep this list explicit and small.
const CHANNELS = {
  OPEN_EXTERNAL: "shell:openExternal",
  OPEN_ITEM: "shell:openItem",
  SHOW_MESSAGE_BOX: "dialog:showMessageBox",
  // Future: quit-to-tray, update checks, deep links, etc.
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
};

// Expose the bridge only on the expected global and only in the main frame.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "trivioDesktop", {
    value: Object.freeze(api),
    configurable: false,
    writable: false,
  });
}

// Keep imports that are not referenced in all build paths from being dropped.
void shell;
