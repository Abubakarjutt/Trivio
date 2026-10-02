import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  packBackup,
  unpackBackup,
  encodeHeader,
  decodeHeader,
  attachmentsFingerprint,
  backupFileName,
  HEADER_LEN,
  type KeyMaterial,
} from "../../../desktop/backup/archive";
import { derivePwKey } from "../../../desktop/backup/keys";

const FAST = { N: 1024, r: 8, p: 1 };

async function setup(password = "pw-12345678") {
  const dir = await mkdtemp(join(tmpdir(), "trivio-archive-"));
  const dump = join(dir, "db.dump");
  await writeFile(dump, randomBytes(5000));
  const att = join(dir, "attachments");
  await mkdir(join(att, "org1"), { recursive: true });
  await writeFile(join(att, "org1", "r.pdf"), "receipt");
  const pwSalt = randomBytes(16);
  const key: KeyMaterial = {
    pwKey: await derivePwKey(password, pwSalt, FAST),
    pwSalt,
    params: FAST,
  };
  const out = join(dir, "b.trivio-backup");
  await mkdir(join(dir, "work"));
  const manifest = await packBackup({
    workDir: join(dir, "work"),
    dumpPath: dump,
    attachmentsDir: att,
    appVersion: "0.1.25",
    latestMigration: "20260101000000_init",
    now: new Date("2026-10-02T14:30:00.123Z"),
    key,
    outPath: out,
  });
  return { dir, dump, att, out, manifest };
}

const withPassword = (pw: string) => (h: { pwSalt: Buffer; params: typeof FAST }) =>
  derivePwKey(pw, h.pwSalt, h.params);

describe("archive", () => {
  it("names files trivio-<UTC, colons→dashes, no ms>.trivio-backup", () => {
    expect(backupFileName(new Date("2026-10-02T14:30:00.123Z"))).toBe(
      "trivio-2026-10-02T14-30-00Z.trivio-backup"
    );
  });

  it("header round-trips and is exactly 60 bytes", () => {
    const h = {
      params: FAST,
      pwSalt: randomBytes(16),
      fileSalt: randomBytes(16),
      nonce: randomBytes(12),
    };
    const b = encodeHeader(h);
    expect(b).toHaveLength(HEADER_LEN);
    expect(b.subarray(0, 8).toString()).toBe("TRIVIOBK");
    const d = decodeHeader(b);
    expect(d.params).toEqual(FAST);
    expect(
      d.pwSalt.equals(h.pwSalt) && d.fileSalt.equals(h.fileSalt) && d.nonce.equals(h.nonce)
    ).toBe(true);
  });

  it("round-trips dump + attachments with the right password", async () => {
    const { dir, dump, out, manifest } = await setup();
    expect(manifest.attachmentCount).toBe(1);
    await mkdir(join(dir, "w2"));
    const r = await unpackBackup({
      srcPath: out,
      workDir: join(dir, "w2"),
      getPwKey: withPassword("pw-12345678"),
    });
    expect((await readFile(r.dumpPath)).equals(await readFile(dump))).toBe(true);
    expect(await readFile(join(r.attachmentsDir, "org1", "r.pdf"), "utf8")).toBe("receipt");
    expect(r.manifest.latestMigration).toBe("20260101000000_init");
    expect(r.manifest.appVersion).toBe("0.1.25");
  });

  it("rejects a wrong password with WRONG_PASSWORD and leaves no plaintext behind", async () => {
    const { dir, out } = await setup();
    await mkdir(join(dir, "w2"));
    await expect(
      unpackBackup({
        srcPath: out,
        workDir: join(dir, "w2"),
        getPwKey: withPassword("nope-nope-nope"),
      })
    ).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(readFile(join(dir, "w2", "body.tar"))).rejects.toThrow();
  });

  it.each([
    ["the header (scrypt salt)", 20],
    ["the reserved header byte (AAD only)", 59],
    ["the body", HEADER_LEN + 10],
    ["the tag", -1],
  ])("rejects a flipped byte in %s", async (_label, offset) => {
    const { dir, out } = await setup();
    const buf = await readFile(out);
    const at = offset < 0 ? buf.length + offset : offset;
    buf[at] ^= 0x01;
    await writeFile(out, buf);
    await mkdir(join(dir, "w2"));
    await expect(
      unpackBackup({
        srcPath: out,
        workDir: join(dir, "w2"),
        getPwKey: withPassword("pw-12345678"),
      })
    ).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
  });

  it("rejects a non-backup file with BAD_FORMAT and a future format version with NEWER_BACKUP", async () => {
    const { dir, out } = await setup();
    await writeFile(join(dir, "junk"), randomBytes(200));
    await mkdir(join(dir, "w2"));
    await expect(
      unpackBackup({
        srcPath: join(dir, "junk"),
        workDir: join(dir, "w2"),
        getPwKey: withPassword("x"),
      })
    ).rejects.toMatchObject({ code: "BAD_FORMAT" });
    const buf = await readFile(out);
    buf[8] = 2;
    await writeFile(out, buf);
    await expect(
      unpackBackup({
        srcPath: out,
        workDir: join(dir, "w2"),
        getPwKey: withPassword("pw-12345678"),
      })
    ).rejects.toMatchObject({ code: "NEWER_BACKUP" });
  });

  it("refuses absurd scrypt parameters from an untrusted header", () => {
    const b = encodeHeader({
      params: FAST,
      pwSalt: randomBytes(16),
      fileSalt: randomBytes(16),
      nonce: randomBytes(12),
    });
    b.writeUInt32BE(2 ** 30, 9);
    expect(() => decodeHeader(b)).toThrow(/isn't a Trivio backup/);
  });

  it("refuses scrypt parameters that exceed memory bounds", () => {
    const b = encodeHeader({
      params: FAST,
      pwSalt: randomBytes(16),
      fileSalt: randomBytes(16),
      nonce: randomBytes(12),
    });
    b.writeUInt32BE(2 ** 20, 9);
    b.writeUInt8(8, 13);
    expect(() => decodeHeader(b)).toThrow(/isn't a Trivio backup/);
  });

  it("attachments fingerprint changes when a file is added or modified, not otherwise", async () => {
    const { att } = await setup();
    const a = await attachmentsFingerprint(att);
    expect(await attachmentsFingerprint(att)).toBe(a);
    await utimes(join(att, "org1", "r.pdf"), new Date(), new Date(Date.now() + 5000));
    const b = await attachmentsFingerprint(att);
    expect(b).not.toBe(a);
    await writeFile(join(att, "org1", "s.pdf"), "x");
    expect(await attachmentsFingerprint(att)).not.toBe(b);
    expect(await attachmentsFingerprint(join(att, "missing"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
