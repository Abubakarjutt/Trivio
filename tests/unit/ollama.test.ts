// Unit tests for the embedded Ollama engine lifecycle (desktop/embedded/ollama.ts).
//
// Every *decision* is a pure function, so the install path is exercised without a
// real Ollama binary, network, or GUI — we inject fakes for spawnSync / fs. These
// tests lock in the Windows embeddable-zip behaviour: the desktop ships the
// portable ollama-windows-<arch>.zip (NOT the NSIS installer) and extracts it with
// the `tar` that ships with Windows 10+.
import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ollamaDownloadUrl,
  archiveKind,
  ollamaBinaryCandidates,
  ensureBinary,
  type OllamaLayout,
} from "../../desktop/embedded/ollama";

function layout(home: string): OllamaLayout {
  return {
    home,
    binDir: join(home, "bin"),
    bin: join(home, "bin", "ollama.exe"),
    modelsDir: join(home, "models"),
    versionFile: join(home, "VERSION"),
  };
}

// ── Download asset selection ───────────────────────────────────────────────────

describe("ollamaDownloadUrl", () => {
  it("returns the embeddable Windows zip (amd64) for x64 — never the installer", () => {
    const url = ollamaDownloadUrl({}, "win32", "x64");
    expect(url).toContain("/ollama-windows-amd64.zip");
    expect(url).not.toMatch(/\.exe$/);
    expect(url).not.toContain("Setup");
  });

  it("returns the embeddable Windows zip (arm64) for arm64", () => {
    const url = ollamaDownloadUrl({}, "win32", "arm64");
    expect(url).toContain("/ollama-windows-arm64.zip");
  });

  it("returns the macOS zip for the matching arch", () => {
    expect(ollamaDownloadUrl({}, "darwin", "arm64")).toContain("/Ollama-darwin.zip");
    expect(ollamaDownloadUrl({}, "darwin", "x64")).toContain("/Ollama-darwin-amd64.zip");
  });

  it("returns the linux tgz", () => {
    expect(ollamaDownloadUrl({}, "linux", "x64")).toContain("/ollama-linux-amd64.tgz");
    expect(ollamaDownloadUrl({}, "linux", "arm64")).toContain("/ollama-linux-arm64.tgz");
  });

  it("honours the OLLAMA_DOWNLOAD_URL override", () => {
    expect(ollamaDownloadUrl({ OLLAMA_DOWNLOAD_URL: "https://x/y.zip" }, "win32", "x64")).toBe(
      "https://x/y.zip"
    );
  });

  it("honours a pinned OLLAMA_VERSION", () => {
    expect(ollamaDownloadUrl({ OLLAMA_VERSION: "v9.9.9" }, "win32", "x64")).toContain("/v9.9.9/");
  });
});

// ── Archive format detection ────────────────────────────────────────────────────

describe("archiveKind", () => {
  it("detects a zip (the Windows embeddable asset)", () => {
    expect(archiveKind("win32", "https://x/ollama-windows-amd64.zip")).toBe("zip");
  });
  it("detects a tgz", () => {
    expect(archiveKind("linux", "https://x/ollama-linux-amd64.tgz")).toBe("tgz");
  });
  it("detects an installer", () => {
    expect(archiveKind("win32", "https://x/OllamaSetup.exe")).toBe("exe");
  });
});

// ── Binary location candidates ──────────────────────────────────────────────────

describe("ollamaBinaryCandidates", () => {
  it("win32 resolves ollama.exe at the archive root (no installer candidate)", () => {
    const c = ollamaBinaryCandidates("/x", "win32");
    expect(c).toEqual([join("/x", "ollama.exe")]);
    expect(c.some((p) => p.toLowerCase().includes("setup"))).toBe(false);
  });

  it("darwin checks the .app bundle first", () => {
    const c = ollamaBinaryCandidates("/x", "darwin");
    expect(c[0]).toContain(join("Ollama.app", "Contents"));
  });

  it("linux checks bin/ollama", () => {
    expect(ollamaBinaryCandidates("/x", "linux")).toContain(join("/x", "bin", "ollama"));
  });
});

// ── Install lifecycle (injected spawnSync + fs) ──────────────────────────────────

describe("ensureBinary", () => {
  const noFs = {
    existsSyncImpl: (() => false) as typeof import("node:fs").existsSync,
    mkdirSyncImpl: (() => {}) as any,
    chmodSyncImpl: (() => {}) as any,
    rmSyncImpl: (() => {}) as any,
    log: () => {},
  };

  it("rejects an installer (.exe) URL with actionable guidance", async () => {
    const home = join(tmpdir(), "trivio-ollama-reject");
    await expect(
      ensureBinary(
        layout(home),
        { OLLAMA_DOWNLOAD_URL: "https://x/OllamaSetup.exe" },
        "win32",
        "x64",
        {
          ...noFs,
          spawnSyncImpl: vi.fn(() => ({ status: 0 })) as any,
        }
      )
    ).rejects.toThrow(/embeddable zip/);
  });

  it("extracts the Windows zip with tar (not unzip) and locates ollama.exe", async () => {
    const home = join(
      tmpdir(),
      "trivio-ollama-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
    const lay = layout(home);
    const extractDir = join(home, ".dl", "x");
    mkdirSync(extractDir, { recursive: true });
    writeFileSync(join(extractDir, "ollama.exe"), "x");
    mkdirSync(lay.binDir, { recursive: true });

    try {
      const calls: Array<{ cmd: string; args: string[] }> = [];
      const spawnSyncImpl = vi.fn((cmd: string, args: string[]) => {
        calls.push({ cmd, args });
        return { status: 0 };
      }) as any;
      // Let existsSync use the real fs: the extracted ollama.exe exists on
      // disk (we created it) and cpSync creates bin/ollama.exe, so the
      // "already installed?" check is false up front and true post-copy.
      const result = await ensureBinary(lay, {}, "win32", "x64", {
        mkdirSyncImpl: () => {},
        chmodSyncImpl: () => {},
        rmSyncImpl: () => {},
        spawnSyncImpl,
        log: () => {},
      });

      // It must invoke the Windows tar (libarchive) — never `unzip`.
      expect(calls.some((c) => c.cmd === "tar" && c.args.includes("-xf"))).toBe(true);
      expect(calls.some((c) => c.cmd === "unzip")).toBe(false);
      // And it resolves to the canonical ollama.exe path.
      expect(result).toBe(lay.bin);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
