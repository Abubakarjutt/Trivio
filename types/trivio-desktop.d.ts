// Ambient type for the desktop IPC bridge that desktop/preload.ts exposes on
// `window.trivioDesktop` via contextBridge. In a plain web build this global is
// absent, so every renderer access is optional-chained through getDesktop().

// Aggregate status of the local Ollama + Gemma engine the desktop app owns.
export interface OllamaStatus {
  binaryInstalled: boolean;
  serverRunning: boolean;
  modelAvailable: boolean;
  models: string[];
  model: string;
  version?: string;
  home: string;
  bin: string;
  port: number;
  ready: boolean;
}

// A single step of the install/start/pull lifecycle.
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
  pct?: number;
  message?: string;
}

// The Ollama sub-API exposed on the bridge.
export interface OllamaBridge {
  // Is the engine installed / running / model present right now?
  status: () => Promise<OllamaStatus>;
  // Full first-time setup: install binary → start server → pull model.
  // Progress is streamed on the ollama:progress channel (see onProgress); this
  // resolves with the final status.
  setup: () => Promise<OllamaStatus>;
  // Start (or ensure running) just the server.
  start: () => Promise<OllamaStatus>;
  // Pull the configured model (starts the server if needed).
  pull: () => Promise<OllamaStatus>;
  // Download + extract just the binary.
  install: () => Promise<OllamaStatus>;
  // Stop the running server.
  stop: () => Promise<OllamaStatus>;
  // Subscribe to progress emitted during setup/install/pull. Returns unsubscribe.
  onProgress: (cb: (p: OllamaProgress) => void) => () => void;
  // Subscribe to status changes (broadcast when the engine state changes).
  // Returns unsubscribe.
  onStatusChange: (cb: (s: OllamaStatus) => void) => () => void;
}

// The full bridge exposed on window.trivioDesktop.
export interface DesktopBridge {
  isDesktop: boolean;
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  openExternal: (url: string) => void;
  openItem: (path: string) => Promise<void>;
  navigate: (intent: string) => void;
  onDeepLink: (cb: (info: { raw: string; path: string; query: string }) => void) => () => void;
  ollama: OllamaBridge;
}

declare global {
  interface Window {
    trivioDesktop?: DesktopBridge;
  }
}
