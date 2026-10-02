import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_STATE, loadState, saveState } from "../../../desktop/backup/state";
import { FileSecretStore } from "../../../desktop/backup/secret-store";

const scratch = () => mkdtemp(join(tmpdir(), "trivio-state-"));

// Reversible stand-in for Electron's safeStorage.
const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, "utf8").reverse(),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString("utf8"),
};

describe("state", () => {
  it("returns defaults when the file is missing or corrupt", async () => {
    const dir = await scratch();
    expect(await loadState(join(dir, "state.json"))).toEqual(EMPTY_STATE);
    await writeFile(join(dir, "state.json"), "{not json");
    expect(await loadState(join(dir, "state.json"))).toEqual(EMPTY_STATE);
  });

  it("saves atomically and loads back, filling fields added later", async () => {
    const dir = await scratch();
    const file = join(dir, "state.json");
    await saveState(file, { ...EMPTY_STATE, email: "a@b.c", keptCount: 3 });
    expect(await readdir(dir)).toEqual(["state.json"]); // no temp file left
    const { keptCount, ...older } = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify(older));
    const loaded = await loadState(file);
    expect(loaded.email).toBe("a@b.c");
    expect(loaded.keptCount).toBe(0);
    expect(keptCount).toBe(3);
  });
});

describe("FileSecretStore", () => {
  it("round-trips through the codec, never storing plaintext, and clears", async () => {
    const dir = await scratch();
    const store = new FileSecretStore(dir, codec);
    expect(await store.load("key")).toBeNull();
    await store.save("key", "c2VjcmV0");
    expect((await readFile(join(dir, "key.bin"))).toString("utf8")).not.toContain("c2VjcmV0");
    expect(await store.load("key")).toBe("c2VjcmV0");
    await store.clear("key");
    expect(await store.load("key")).toBeNull();
  });

  it("refuses to save when the OS keychain is unavailable", async () => {
    const store = new FileSecretStore(await scratch(), { ...codec, isEncryptionAvailable: () => false });
    await expect(store.save("key", "x")).rejects.toThrow(/keychain/i);
  });
});
