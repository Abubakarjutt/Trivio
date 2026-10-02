import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeTar, extractTar, fileHeader } from "../../../desktop/backup/tar";

async function scratch() {
  return mkdtemp(join(tmpdir(), "trivio-tar-"));
}

describe("tar", () => {
  it("round-trips files byte for byte, including sizes that aren't multiples of 512", async () => {
    const dir = await scratch();
    const a = join(dir, "a.bin");
    const b = join(dir, "b.txt");
    const bytes = randomBytes(70_001);
    await writeFile(a, bytes);
    await writeFile(b, "");
    const tar = join(dir, "x.tar");
    await writeTar(tar, [
      { name: "db.dump", path: a },
      { name: "attachments/org1/empty.txt", path: b },
    ]);
    const out = join(dir, "out");
    const names = await extractTar(tar, out);
    expect(names).toEqual(["db.dump", "attachments/org1/empty.txt"]);
    expect((await readFile(join(out, "db.dump"))).equals(bytes)).toBe(true);
    expect(await readFile(join(out, "attachments", "org1", "empty.txt"), "utf8")).toBe("");
  });

  it("stores long paths (>100 bytes) using the ustar prefix field", async () => {
    const dir = await scratch();
    const f = join(dir, "f");
    await writeFile(f, "x");
    const long = `attachments/${"o".repeat(60)}/${"n".repeat(80)}.pdf`;
    const tar = join(dir, "x.tar");
    await writeTar(tar, [{ name: long, path: f }]);
    expect(await extractTar(tar, join(dir, "out"))).toEqual([long]);
  });

  it.skipIf(process.platform === "win32")("is readable by the system tar", async () => {
    const dir = await scratch();
    const f = join(dir, "f");
    await writeFile(f, "hello");
    const tar = join(dir, "x.tar");
    await writeTar(tar, [{ name: "attachments/org1/f.txt", path: f }]);
    expect(execFileSync("tar", ["-tf", tar], { encoding: "utf8" }).trim()).toBe("attachments/org1/f.txt");
  });

  it("refuses entries that would escape the destination", async () => {
    const dir = await scratch();
    const tar = join(dir, "evil.tar");
    const h = fileHeader("../evil.txt", 1, new Date());
    await writeFile(tar, Buffer.concat([h, Buffer.alloc(512), Buffer.alloc(1024)]));
    await expect(extractTar(tar, join(dir, "out"))).rejects.toThrow(/unsafe path/);
  });

  it("rejects a corrupted header", async () => {
    const dir = await scratch();
    const f = join(dir, "f");
    await writeFile(f, "x");
    const tar = join(dir, "x.tar");
    await writeTar(tar, [{ name: "f", path: f }]);
    const buf = await readFile(tar);
    buf[0] ^= 0xff;
    await writeFile(tar, buf);
    await mkdir(join(dir, "out"));
    await expect(extractTar(tar, join(dir, "out"))).rejects.toThrow(/checksum/);
  });
});
