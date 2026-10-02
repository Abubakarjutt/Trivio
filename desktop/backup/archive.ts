// A Trivio backup file: a 60-byte plaintext header (format version, scrypt
// parameters, salts, nonce) followed by an AES-256-GCM encrypted tar of
// manifest.json + db.dump + attachments/, then the 16-byte GCM tag. The header
// is the GCM "additional data", so editing any byte of it fails decryption just
// like a wrong password does. See docs/superpowers/specs/2026-10-02-google-drive-backup-design.md §3.

import { createReadStream, promises as fsp } from "node:fs";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { BackupError } from "./errors";
import { deriveFileKey, type ScryptParams } from "./keys";
import { extractTar, writeTar } from "./tar";

export const MAGIC = Buffer.from("TRIVIOBK", "ascii");
export const FORMAT_VERSION = 1;
export const HEADER_LEN = 60;
export const TAG_LEN = 16;

export interface BackupHeader {
  params: ScryptParams;
  pwSalt: Buffer;
  fileSalt: Buffer;
  nonce: Buffer;
}

export interface KeyMaterial {
  pwKey: Buffer;
  pwSalt: Buffer;
  params: ScryptParams;
}

export interface Manifest {
  formatVersion: 1;
  appVersion: string;
  latestMigration: string;
  createdAt: string;
  attachmentCount: number;
  dbDumpSha256: string;
}

export function encodeHeader(h: BackupHeader): Buffer {
  const b = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(b, 0);
  b.writeUInt8(FORMAT_VERSION, 8);
  b.writeUInt32BE(h.params.N, 9);
  b.writeUInt8(h.params.r, 13);
  b.writeUInt8(h.params.p, 14);
  h.pwSalt.copy(b, 15);
  h.fileSalt.copy(b, 31);
  h.nonce.copy(b, 47);
  // byte 59 reserved (0)
  return b;
}

export function decodeHeader(b: Buffer): BackupHeader {
  if (b.length < HEADER_LEN || !b.subarray(0, 8).equals(MAGIC)) throw new BackupError("BAD_FORMAT");
  const version = b.readUInt8(8);
  if (version > FORMAT_VERSION) throw new BackupError("NEWER_BACKUP");
  if (version !== FORMAT_VERSION) throw new BackupError("BAD_FORMAT");
  const params = { N: b.readUInt32BE(9), r: b.readUInt8(13), p: b.readUInt8(14) };
  // The header is untrusted until the tag verifies — bound the work it can ask for.
  const powerOfTwo = (params.N & (params.N - 1)) === 0;
  if (!powerOfTwo || params.N < 2 ** 10 || params.N > 2 ** 20 || params.r < 1 || params.r > 32 || params.p < 1 || params.p > 4) {
    throw new BackupError("BAD_FORMAT");
  }
  // Enforce memory bound compatible with derivePwKey (256 MiB max = 128·N·r bytes)
  if (128 * params.N * params.r > 256 * 1024 * 1024) {
    throw new BackupError("BAD_FORMAT");
  }
  return {
    params,
    pwSalt: Buffer.from(b.subarray(15, 31)),
    fileSalt: Buffer.from(b.subarray(31, 47)),
    nonce: Buffer.from(b.subarray(47, 59)),
  };
}

export async function encryptFile(src: string, dest: string, key: KeyMaterial): Promise<void> {
  const header: BackupHeader = {
    params: key.params,
    pwSalt: key.pwSalt,
    fileSalt: randomBytes(16),
    nonce: randomBytes(12),
  };
  const hb = encodeHeader(header);
  const cipher = createCipheriv("aes-256-gcm", deriveFileKey(key.pwKey, header.fileSalt), header.nonce);
  cipher.setAAD(hb);
  const out = await fsp.open(dest, "w");
  try {
    await out.write(hb);
    for await (const chunk of createReadStream(src)) await out.write(cipher.update(chunk as Buffer));
    await out.write(cipher.final());
    await out.write(cipher.getAuthTag());
  } finally {
    await out.close();
  }
}

export async function decryptFile(
  src: string,
  dest: string,
  getPwKey: (h: BackupHeader) => Promise<Buffer>,
): Promise<{ header: BackupHeader; pwKey: Buffer }> {
  const fh = await fsp.open(src, "r");
  try {
    const { size } = await fh.stat();
    if (size < HEADER_LEN + TAG_LEN) throw new BackupError("BAD_FORMAT");
    const hb = Buffer.alloc(HEADER_LEN);
    await fh.read(hb, 0, HEADER_LEN, 0);
    const header = decodeHeader(hb);
    const tag = Buffer.alloc(TAG_LEN);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
    const pwKey = await getPwKey(header);
    const d = createDecipheriv("aes-256-gcm", deriveFileKey(pwKey, header.fileSalt), header.nonce);
    d.setAAD(hb);
    d.setAuthTag(tag);
    const out = await fsp.open(dest, "w");
    try {
      const buf = Buffer.alloc(1 << 20);
      const end = size - TAG_LEN;
      for (let at = HEADER_LEN; at < end; ) {
        const n = Math.min(buf.length, end - at);
        await fh.read(buf, 0, n, at);
        await out.write(d.update(buf.subarray(0, n)));
        at += n;
      }
      try {
        await out.write(d.final());
      } catch {
        throw new BackupError("WRONG_PASSWORD");
      }
    } catch (err) {
      await out.close();
      await fsp.rm(dest, { force: true }); // never leave unauthenticated plaintext
      throw err;
    }
    await out.close();
    return { header, pwKey };
  } finally {
    await fh.close();
  }
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

// Cheap "did the uploads change?" check: names, sizes and modification times.
export async function attachmentsFingerprint(dir: string): Promise<string> {
  const h = createHash("sha256");
  for (const rel of await listFiles(dir)) {
    const st = await fsp.stat(join(dir, ...rel.split("/")));
    h.update(`${rel}\t${st.size}\t${Math.floor(st.mtimeMs)}\n`);
  }
  return h.digest("hex");
}

export function backupFileName(now: Date): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  return `trivio-${iso}.trivio-backup`;
}

export async function packBackup(o: {
  workDir: string;
  dumpPath: string;
  attachmentsDir: string;
  appVersion: string;
  latestMigration: string;
  now: Date;
  key: KeyMaterial;
  outPath: string;
}): Promise<Manifest> {
  const files = await listFiles(o.attachmentsDir);
  const manifest: Manifest = {
    formatVersion: 1,
    appVersion: o.appVersion,
    latestMigration: o.latestMigration,
    createdAt: o.now.toISOString(),
    attachmentCount: files.length,
    dbDumpSha256: await sha256File(o.dumpPath),
  };
  const manifestPath = join(o.workDir, "manifest.json");
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const tarPath = join(o.workDir, "body.tar");
  await writeTar(tarPath, [
    { name: "manifest.json", path: manifestPath },
    { name: "db.dump", path: o.dumpPath },
    ...files.map((f) => ({ name: `attachments/${f}`, path: join(o.attachmentsDir, ...f.split("/")) })),
  ]);
  try {
    await encryptFile(tarPath, o.outPath, o.key);
  } finally {
    await fsp.rm(tarPath, { force: true });
  }
  return manifest;
}

export async function unpackBackup(o: {
  srcPath: string;
  workDir: string;
  getPwKey: (h: BackupHeader) => Promise<Buffer>;
}): Promise<{
  manifest: Manifest;
  dumpPath: string;
  attachmentsDir: string;
  pwKey: Buffer;
  pwSalt: Buffer;
  params: ScryptParams;
}> {
  const tarPath = join(o.workDir, "body.tar");
  const { header, pwKey } = await decryptFile(o.srcPath, tarPath, o.getPwKey);
  const outDir = join(o.workDir, "restore");
  await fsp.rm(outDir, { recursive: true, force: true });
  try {
    await extractTar(tarPath, outDir);
  } catch (err) {
    throw new BackupError("BAD_FORMAT", err instanceof Error ? err.message : String(err));
  } finally {
    await fsp.rm(tarPath, { force: true });
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(join(outDir, "manifest.json"), "utf8"));
  } catch {
    throw new BackupError("BAD_FORMAT");
  }
  if (manifest.formatVersion !== 1) throw new BackupError("NEWER_BACKUP");
  const dumpPath = join(outDir, "db.dump");
  const actual = await sha256File(dumpPath).catch(() => "");
  if (actual !== manifest.dbDumpSha256) throw new BackupError("BAD_FORMAT");
  const attachmentsDir = join(outDir, "attachments");
  await fsp.mkdir(attachmentsDir, { recursive: true });
  return { manifest, dumpPath, attachmentsDir, pwKey, pwSalt: header.pwSalt, params: header.params };
}
