// Trivio — macOS app icon generator (no external deps, macOS only).
//
// Renders a 1024×1024 RGBA master, downscales through macOS `sips` into a
// .iconset via `iconutil`, and writes desktop/build/icon.icns.
//
// Placeholder identity: a rounded-square brand tile with a vertical gradient and
// a subtle centered check mark (accounting = reconciliation / matched). Replace
// desktop/build/icon.icns with the real brand mark for production.

import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const buildDir = join(dirname(fileURLToPath(import.meta.url)));
const outIcns = join(buildDir, "icon.icns");
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

// ── Image synthesis ──────────────────────────────────────────────────────────

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
    const inRect =
      px >= inX0 && px <= inX1 && py >= inY0 && py <= inY1;
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
        distToSeg(x + 0.5, y + 0.5, mx, my, ex, ey));
      const cap = Math.min(
        Math.hypot(x + 0.5 - ax, y + 0.5 - ay),
        Math.hypot(x + 0.5 - ex, y + 0.5 - ey));
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
  const png = encodePng(MASTER, MASTER, makeMaster(MASTER));

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
    console.error(`icon build failed: ${err && err.message ? err.message : err}`);
    console.error(
      "  `sips`/`iconutil` are macOS-only; a 1024×1024 PNG was saved to build/icon-1024.png",
      );
    writeFileSync(join(buildDir, "icon-1024.png"), png);
    process.exitCode = 1;
    } finally {
    rmSync(tmp, { recursive: true, force: true });
    }
}

main();
