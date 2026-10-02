// The smallest tar we need: regular files only, POSIX ustar headers (so any
// `tar` can read our archives for support/debugging), and an extractor that
// refuses paths escaping the destination. No dependency.

import { createReadStream, createWriteStream, promises as fsp } from "node:fs";
import { once } from "node:events";
import { dirname, isAbsolute, join } from "node:path";

const BLOCK = 512;

export interface TarEntry {
  name: string; // path inside the archive, "/"-separated
  path: string; // source file on disk
}

function splitName(name: string): { prefix: string; base: string } {
  if (Buffer.byteLength(name) <= 100) return { prefix: "", base: name };
  for (let i = name.lastIndexOf("/"); i > 0; i = name.lastIndexOf("/", i - 1)) {
    const prefix = name.slice(0, i);
    const base = name.slice(i + 1);
    if (base && Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(base) <= 100) {
      return { prefix, base };
    }
  }
  throw new Error(`tar: path too long: ${name}`);
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

export function fileHeader(name: string, size: number, mtime: Date): Buffer {
  const h = Buffer.alloc(BLOCK);
  const { prefix, base } = splitName(name);
  h.write(base, 0, 100, "utf8");
  h.write(octal(0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, "ascii");
  h.write("        ", 148, "ascii"); // checksum placeholder: 8 spaces
  h.write("0", 156, "ascii"); // regular file
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

export async function writeTar(outPath: string, entries: TarEntry[]): Promise<void> {
  const out = createWriteStream(outPath);
  let streamError: Error | null = null;

  // Persistent error listener that records the error
  out.on("error", (err) => {
    streamError = err;
  });

  const write = async (buf: Buffer) => {
    if (streamError) throw streamError;
    if (!out.write(buf)) await once(out, "drain");
    if (streamError) throw streamError;
  };
  try {
    for (const e of entries) {
      const st = await fsp.stat(e.path);
      await write(fileHeader(e.name, st.size, st.mtime));
      let written = 0;
      for await (const chunk of createReadStream(e.path)) {
        await write(chunk as Buffer);
        written += (chunk as Buffer).length;
      }
      if (written !== st.size) throw new Error(`tar: ${e.path} changed while archiving`);
      const pad = (BLOCK - (st.size % BLOCK)) % BLOCK;
      if (pad) await write(Buffer.alloc(pad));
    }
    await write(Buffer.alloc(BLOCK * 2)); // end-of-archive marker
  } finally {
    out.end();
    // Only wait for close if not already closed/destroyed
    if (!out.closed && !out.destroyed) {
      await once(out, "close");
    }
    // Rethrow any stream error that occurred
    if (streamError) throw streamError;
  }
}

function field(h: Buffer, offset: number, length: number): string {
  const raw = h.subarray(offset, offset + length).toString("utf8");
  const nul = raw.indexOf("\0");
  return nul === -1 ? raw : raw.slice(0, nul);
}

function verifyChecksum(h: Buffer): void {
  const stored = parseInt(field(h, 148, 8).trim(), 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  if (sum !== stored) throw new Error("tar: bad header checksum");
}

function safeJoin(root: string, name: string): string {
  const parts = name.split("/");
  if (!name || isAbsolute(name) || name.includes("\\") || parts.some((p) => p === ".." || p === "")) {
    throw new Error(`tar: unsafe path ${name}`);
  }
  return join(root, ...parts);
}

export async function extractTar(tarPath: string, destDir: string): Promise<string[]> {
  const fh = await fsp.open(tarPath, "r");
  const names: string[] = [];
  try {
    const header = Buffer.alloc(BLOCK);
    let pos = 0;
    for (;;) {
      const { bytesRead } = await fh.read(header, 0, BLOCK, pos);
      if (bytesRead < BLOCK) throw new Error("tar: truncated archive");
      if (header.every((b) => b === 0)) break;
      verifyChecksum(header);
      const base = field(header, 0, 100);
      const prefix = field(header, 345, 155);
      const name = prefix ? `${prefix}/${base}` : base;
      const size = parseInt(field(header, 124, 12).trim() || "0", 8);
      const type = field(header, 156, 1) || "0";
      pos += BLOCK;
      if (type === "0") {
        const target = safeJoin(destDir, name);
        await fsp.mkdir(dirname(target), { recursive: true });
        const out = await fsp.open(target, "w");
        try {
          const buf = Buffer.alloc(Math.max(1, Math.min(size, 1 << 20)));
          let left = size;
          let at = pos;
          while (left > 0) {
            const n = Math.min(left, buf.length);
            const r = await fh.read(buf, 0, n, at);
            if (r.bytesRead !== n) throw new Error("tar: truncated archive");
            await out.write(buf, 0, n);
            left -= n;
            at += n;
          }
        } finally {
          await out.close();
        }
        names.push(name);
      } else if (type !== "5") {
        throw new Error(`tar: unsupported entry type "${type}"`);
      }
      pos += Math.ceil(size / BLOCK) * BLOCK;
    }
  } finally {
    await fh.close();
  }
  return names;
}
