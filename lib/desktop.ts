// Renderer-side accessor for the desktop IPC bridge.
//
// desktop/preload.ts exposes a frozen, contextIsolation-safe `window.trivioDesktop`
// inside the Electron shell. A plain web build has no such global, so every
// helper here is optional-chained: on the web they report "not a desktop app"
// instead of throwing, letting the same UI code run in both environments.
//
// The Ollama sub-API is how the renderer drives the local AI engine: check
// status, run the (skippable) first-time setup, and get progress back.

import type {
  DesktopBridge,
  OllamaBridge,
  OllamaProgress,
  OllamaStatus,
} from "@/types/trivio-desktop";

export type { DesktopBridge, OllamaBridge, OllamaProgress, OllamaStatus };

// The desktop bridge, or undefined in a web build (and during SSR).
export function getDesktop(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.trivioDesktop;
}

// The Ollama sub-API, or undefined when there's no desktop bridge.
export function getOllama(): OllamaBridge | undefined {
  return getDesktop()?.ollama;
}

// True when the desktop shell is running this page.
export function isDesktop(): boolean {
  return getDesktop() !== undefined;
}

// Is the local Ollama + Gemma engine ready to serve a turn right now?
// False on the web (no bridge) and when the engine isn't installed/running.
export async function isOllamaReady(
  ollama?: OllamaBridge | null,
): Promise<boolean> {
  const b = ollama ?? getOllama();
  if (!b) return false;
  try {
    const s = await b.status();
    return s.ready;
   } catch {
    return false;
   }
}

// Run the full first-time setup (install → start → pull), streaming progress to
// `onProgress`. Resolves with the final status, or null on the web (no bridge).
// The caller is free to cancel by unmounting; the underlying install continues
// in the main process and the next open will pick up where it left off.
export async function runOllamaSetup(
  onProgress?: (p: OllamaProgress) => void,
  ollama?: OllamaBridge | null,
): Promise<OllamaStatus | null> {
  const b = ollama ?? getOllama();
  if (!b) return null;
  const off = onProgress ? b.onProgress(onProgress) : undefined;
  try {
    return await b.setup();
   } finally {
    off?.();
   }
}

// Convenience for "prompt to complete setup": report the current status, and if
// it isn't ready yet, run the full setup (streaming progress). Returns the final
// status, or null on the web.
export async function ensureOllamaReady(
  onProgress?: (p: OllamaProgress) => void,
  ollama?: OllamaBridge | null,
): Promise<OllamaStatus | null> {
  const b = ollama ?? getOllama();
  if (!b) return null;
  try {
    const status = await b.status();
    if (status.ready) return status;
   } catch {
    // Fall through to setup — the engine may be partially configured.
   }
  return runOllamaSetup(onProgress, b);
}
