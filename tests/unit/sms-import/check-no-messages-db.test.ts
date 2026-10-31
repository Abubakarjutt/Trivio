import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMessagesDbInBuild } from "../../../scripts/check-no-messages-db.mjs";

let nextDir: string;
const put = (rel: string, body = "") => {
  const p = join(nextDir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
  return p;
};

beforeEach(() => {
  nextDir = join(mkdtempSync(join(tmpdir(), "nextcheck-")), ".next");
  put("standalone/server.js");
  put("server/app/page.js.nft.json", JSON.stringify({ version: 1, files: ["../../node_modules/x/index.js"] }));
});
afterEach(() => rmSync(join(nextDir, ".."), { recursive: true, force: true }));

describe("findMessagesDbInBuild", () => {
  it("passes a clean build", () => {
    expect(findMessagesDbInBuild(nextDir)).toEqual([]);
  });

  it("flags a copied chat.db (and its WAL) under standalone", () => {
    put("standalone/Users/me/Library/Messages/chat.db");
    put("standalone/somewhere/chat.db-wal");
    const hits = findMessagesDbInBuild(nextDir) as string[];
    expect(hits).toHaveLength(2);
  });

  it("flags a trace file that lists the Messages database", () => {
    put("server/chunks/x.nft.json", JSON.stringify({ version: 1, files: ["../../../../Library/Messages/chat.db"] }));
    expect(findMessagesDbInBuild(nextDir)).toEqual([
      `${join(nextDir, "server/chunks/x.nft.json")}: ../../../../Library/Messages/chat.db`,
    ]);
  });

  it("ignores the build cache", () => {
    put("cache/x.nft.json", JSON.stringify({ files: ["/Users/me/Library/Messages/chat.db"] }));
    expect(findMessagesDbInBuild(nextDir)).toEqual([]);
  });
});
