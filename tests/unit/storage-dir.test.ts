import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveLegacyAttachments } from "../../desktop/storage-dir";

async function scratch() {
  return mkdtemp(join(tmpdir(), "trivio-storage-"));
}

describe("moveLegacyAttachments", () => {
  it("returns 0 when there is nothing to move", async () => {
    const dir = await scratch();
    expect(await moveLegacyAttachments(join(dir, "nope"), join(dir, "to"))).toBe(0);
  });

  it("moves files into the new folder and removes the old one", async () => {
    const dir = await scratch();
    const from = join(dir, "bundle", "attachments");
    await mkdir(join(from, "org1"), { recursive: true });
    await writeFile(join(from, "org1", "a.pdf"), "A");
    const to = join(dir, "userData", "attachments");
    expect(await moveLegacyAttachments(from, to)).toBe(1);
    expect(await readFile(join(to, "org1", "a.pdf"), "utf8")).toBe("A");
    expect(existsSync(from)).toBe(false);
  });

  it("never overwrites a file that already exists in the new folder", async () => {
    const dir = await scratch();
    const from = join(dir, "from");
    const to = join(dir, "to");
    await mkdir(join(from, "org1"), { recursive: true });
    await mkdir(join(to, "org1"), { recursive: true });
    await writeFile(join(from, "org1", "a.pdf"), "OLD");
    await writeFile(join(to, "org1", "a.pdf"), "NEW");
    await moveLegacyAttachments(from, to);
    expect(await readFile(join(to, "org1", "a.pdf"), "utf8")).toBe("NEW");
  });
});
