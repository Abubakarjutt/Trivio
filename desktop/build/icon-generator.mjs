// Trivio — cross-platform app icon generator (no external image deps).
//
// Renders a single 1024x1024 RGBA master, then derives every target from it:
//
//    desktop/build/icon-1024.png   the source of truth (always written)
//    desktop/build/icon.ico        Windows multi-resolution icon (pure JS, cross-OS)
//    desktop/build/icon.icns       macOS iconset (macOS only, via sips/iconutil)
//
// The Windows .ico is produced in pure JavaScript so the build never depends on a
// native image tool (sharp/sips): it runs identically on mac, Windows, and Linux
// CI. Small sizes are classic 32-bit DIB (max compatibility); the 256px frame is
// PNG-in-ICO (Windows Vista+) for a crisp large icon without a 256x256 DIB.
//
// Placeholder identity: a rounded-square brand tile with a vertical gradient and
// a subtle centered check mark (accounting = reconciliation / matched). Replace
// makeMaster() with the real brand mark for production.

import { writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const buildDir = join(dirname(fileURLToPath(import.meta.url)));
const outIcns = join(buildDir, "icon.icns");
const outIco = join(buildDir, "icon.ico");
const outMasterPng = join(buildDir, "icon-1024.png");
const MASTER = 1024;

// ── PNG encoder ──────────────────────────────────────────────────────────────

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// rgba: Uint8Array, width*height*4, row-major (RGBA). Filter-0 PNG scanlines.
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    const src = Buffer.from(rgba.buffer, y * stride, stride);
    src.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Downscaling (pure-JS area-average) ───────────────────────────────────────

// Box-filter downscale of a square RGBA image. srcSize x srcSize -> dstSize x
// dstSize. Accumulates source pixels per destination pixel and averages RGBA so
// edges stay crisp.
function downscale(master, srcSize, dstSize) {
  const out = new Uint8Array(dstSize * dstSize * 4);
  const stride = 4;
  for (let dy = 0; dy < dstSize; dy++) {
    const y0 = Math.floor((dy * srcSize) / dstSize);
    const y1 = Math.max(y0 + 1, Math.ceil(((dy + 1) * srcSize) / dstSize));
    for (let dx = 0; dx < dstSize; dx++) {
      const x0 = Math.floor((dx * srcSize) / dstSize);
      const x1 = Math.max(x0 + 1, Math.ceil(((dx + 1) * srcSize) / dstSize));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * srcSize * stride;
        for (let x = x0; x < x1; x++) {
          const i = row + x * stride;
          r += master[i];
          g += master[i + 1];
          b += master[i + 2];
          a += master[i + 3];
          n++;
        }
      }
      const o = (dy * dstSize + dx) * stride;
      if (n > 0) {
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = Math.round(a / n);
      }
    }
  }
  return out;
}

// ── Windows .ico encoder ─────────────────────────────────────────────────────

// 32bpp bottom-up DIB (BGRA, opaque AND mask = all zero). The classic, most
// compatible .ico payload (works on every Windows since XP).
function encodeBmp32(rgba, size) {
  const rowBytes = size * 4;
  const biSize = 40;
  const pixelData = Buffer.alloc(rowBytes * size);
  // DIB rows are bottom-up; ours are top-down, so copy reversed.
  for (let y = 0; y < size; y++) {
    const srcRow = rgba.buffer.byteOffset + y * rowBytes;
    const dstRow = (size - 1 - y) * rowBytes;
    Buffer.from(rgba.buffer, srcRow, rowBytes).copy(pixelData, dstRow);
  }
  // Prepend a zero AND mask (1bpp, row-padded to 4 bytes) so transparency is
  // honoured by every icon renderer.
  const andMaskRow = Math.ceil(size / 8) + ((4 - (Math.ceil(size / 8) % 4)) % 4);
  const andMask = Buffer.alloc(andMaskRow * size, 0);

  const header = Buffer.alloc(14 + biSize + pixelData.length + andMask.length);
  header.writeUInt16LE(0, 0); // type
  header.writeUInt16LE(1, 2); // count
  header.writeUInt16LE(size, 4); // width
  header.writeUInt16LE(size, 6); // height
  header.writeUInt8(1, 12); // bit count (used by some readers)
  header.writeUInt16LE(1, 14); // planes
  header.writeUInt32LE(32, 16); // bit count
  header.writeUInt32LE(0, 20); // compression
  header.writeUInt32LE(pixelData.length, 24); // image size
  header.writeUInt32LE(0, 28); // x ppm
  header.writeUInt32LE(0, 32); // y ppm
  header.writeUInt32LE(0, 36); // clr used
  header.writeUInt32LE(0, 40); // clr important
  pixelData.copy(header, 14 + biSize);
  andMask.copy(header, 14 + biSize + pixelData.length);
  return header;
}

// Build a multi-resolution .ico from the 1024 master. Small frames are 32-bit
// DIB; the 256px frame is a PNG (Vista+) for a crisp large icon.
function encodeIco(master) {
  const frames = [];
  // Small frames as BMP (DIB); the large 256px frame as PNG.
  for (const s of [16, 32, 48, 64, 128]) {
    frames.push({ size: s, data: encodeBmp32(downscale(master, MASTER, s), s) });
  }
  frames.push({ size: 256, data: encodePng(256, 256, downscale(master, MASTER, 256)) });

  const count = frames.length;
  // Layout (per the .ico spec): a 6-byte ICONDIR, then N contiguous 16-byte
  // ICONDIRENTRY records, THEN all image payloads. Each entry's offset points
  // into the payload region, so the directory must be fully contiguous first.
  const header = Buffer.alloc(6); // ICONDIR only; entries go in the array below
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4); // count

  const entries = [];
  const payloads = [];
  let offset = 6 + 16 * count;
  for (const f of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(f.size === 256 ? 0 : f.size, 0); // 0 encodes 256
    entry.writeUInt8(f.size === 256 ? 0 : f.size, 1);
    entry.writeUInt8(0, 2); // color count (0 = 32bpp)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(f.data.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset into the payload region
    entries.push(entry);
    payloads.push(f.data);
    offset += f.data.length;
  }
  return Buffer.concat([header, ...entries, ...payloads]);
}

// ── Image synthesis (the brand master) ───────────────────────────────────────

function distToSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby || 1e-6;
  let t = ((px - ax) * abx + (py - ay) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

function makeMaster(size) {
  const rgba = new Uint8Array(size * size * 4);
  const top = { r: 0x1b, g: 0x27, b: 0x33 };
  const bot = { r: 0x0b, g: 0x0d, b: 0x10 };
  const accent = { r: 0x3f, g: 0x8f, b: 0x7a };

  const pad = size * 0.09;
  const inX0 = pad;
  const inY0 = pad;
  const inX1 = size - pad;
  const inY1 = size - pad;
  const rc = size * 0.2237;
  const cX0 = inX0 + rc;
  const cX1 = inX1 - rc;
  const cY0 = inY0 + rc;
  const cY1 = inY1 - rc;

  function inside(px, py) {
    const clx = Math.min(Math.max(px, cX0), cX1);
    const cly = Math.min(Math.max(py, cY0), cY1);
    const inRect = px >= inX0 && px <= inX1 && py >= inY0 && py <= inY1;
    return inRect && Math.hypot(px - clx, py - cly) <= rc + 0.5;
  }

  const ax = size * 0.31,
    ay = size * 0.49,
    mx = size * 0.5,
    my = size * 0.48,
    ex = size * 0.69,
    ey = size * 0.29;
  const strokeHalf = size * 0.045;

  for (let y = 0; y < size; y++) {
    const t = y / size;
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      if (!inside(x + 0.5, y + 0.5)) {
        rgba[idx + 3] = 0;
        continue;
      }

      const r0 = top.r + (bot.r - top.r) * t;
      const g0 = top.g + (bot.g - top.g) * t;
      const b0 = top.b + (bot.b - top.b) * t;

      const gx = (x - size * 0.5) / size;
      const gy = (y - size * 0.5) / size;
      const glow = Math.max(0, 1 - (gx * gx + gy * gy) * 13);

      const seg = Math.min(
        distToSeg(x + 0.5, y + 0.5, ax, ay, mx, my),
        distToSeg(x + 0.5, y + 0.5, mx, my, ex, ey)
      );
      const cap = Math.min(
        Math.hypot(x + 0.5 - ax, y + 0.5 - ay),
        Math.hypot(x + 0.5 - ex, y + 0.5 - ey)
      );
      const dMark = Math.min(seg, cap);
      const onMark = dMark <= strokeHalf;
      const edge = Math.max(0, 1 - (strokeHalf - dMark) / (size * 0.012));

      if (onMark) {
        rgba[idx] = 255;
        rgba[idx + 1] = 255;
        rgba[idx + 2] = 255;
      } else {
        rgba[idx] = r0 + (accent.r - r0) * glow * 0.35;
        rgba[idx + 1] = g0 + (accent.g - g0) * glow * 0.35;
        rgba[idx + 2] = b0 + (accent.b - b0) * glow * 0.35;
      }
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

// ── Build ────────────────────────────────────────────────────────────────────

function main() {
  const master = makeMaster(MASTER);
  const png = encodePng(MASTER, MASTER, master);

  // 1. The master PNG is the cross-platform source of truth.
  writeFileSync(outMasterPng, png);
  console.log(`✓ wrote ${outMasterPng}`);

  // 2. Windows .ico — pure JS, so it works on mac/Windows/Linux CI.
  writeFileSync(outIco, encodeIco(master));
  console.log(`✓ wrote ${outIco} (16/32/48/64/128 DIB + 256 PNG)`);

  // 3. macOS .icns — only when the sips/iconutil tools exist (a macOS host).
  if (process.platform === "darwin") {
    const tmp = mkdtempSync(join(tmpdir(), "trivio-icon-"));
    const masterPng = join(tmp, "icon-1024.png");
    const iconset = join(tmp, "Icon.iconset");
    try {
      writeFileSync(masterPng, png);
      mkdirSync(iconset, { recursive: true });

      for (const [name, px] of [
        ["icon_16x16.png", 16],
        ["icon_16x16@2x.png", 32],
        ["icon_32x32.png", 32],
        ["icon_32x32@2x.png", 64],
        ["icon_128x128.png", 128],
        ["icon_128x128@2x.png", 256],
        ["icon_256x256.png", 256],
        ["icon_256x256@2x.png", 512],
        ["icon_512x512.png", 512],
        ["icon_512x512@2x.png", 1024],
      ]) {
        execFileSync("sips", [
          "-z",
          String(px),
          String(px),
          masterPng,
          "--out",
          join(iconset, name),
        ]);
      }

      execFileSync("iconutil", ["-c", "icns", iconset, "-o", outIcns]);
      console.log(`✓ wrote ${outIcns}`);
    } catch (err) {
      // iconutil can be unavailable/blocked on some hosts (VMs/sandboxes/TCC).
      // A committed build/icon.icns (when present) stays valid, so keep it and
      // avoid failing the whole gen:icon step (which would break the mac build).
      const kept = existsSync(outIcns);
      console.warn(
        "    iconutil could not (re)build icon.icns: " +
          (err && err.message ? err.message : String(err))
      );
      console.warn(
        kept
          ? "    keeping existing build/icon.icns (iconutil unavailable on this host)."
          : "    no build/icon.icns to keep; build it on a real macOS host (sips/iconutil)."
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    console.log(
      `    (skipping .icns — not macOS; run on a macOS host for icon.icns${
        existsSync(outIcns) ? " (stale .icns left in place)" : ""
      })`
    );
  }
}

main();
