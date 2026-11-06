import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import afterPack, { shouldKeepUpdateFeed } from "../../desktop/after-pack.mjs";

describe("shouldKeepUpdateFeed", () => {
  it("keeps the feed only in the release workflow or when asked", () => {
    expect(shouldKeepUpdateFeed({})).toBe(false);
    expect(shouldKeepUpdateFeed({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(shouldKeepUpdateFeed({ TRIVIO_KEEP_UPDATE_FEED: "1" })).toBe(true);
  });
});

describe("afterPack", () => {
  let dir: string;
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  function packContext() {
    dir = mkdtempSync(join(tmpdir(), "trivio-afterpack-"));
    const resources = join(dir, "Resources");
    mkdirSync(resources);
    const feed = join(resources, "app-update.yml");
    writeFileSync(feed, "provider: github\n");
    const context = { appOutDir: dir, packager: { getResourcesDir: () => resources } };
    return { context, feed };
  }

  it("removes app-update.yml from a local build so its updater never runs", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "");
    vi.stubEnv("TRIVIO_KEEP_UPDATE_FEED", "");
    const { context, feed } = packContext();
    await afterPack(context);
    expect(existsSync(feed)).toBe(false);
  });

  it("leaves the feed in a release-workflow build", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const { context, feed } = packContext();
    await afterPack(context);
    expect(existsSync(feed)).toBe(true);
  });
});
