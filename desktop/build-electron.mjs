// Trivio — compile the Electron shell (main + preload) to CommonJS.
//
// The main process is plain Electron + Node built-ins, so the bundle only needs
// `electron` marked external. The Next.js server is a separate process (booted
// from desktop/dist-server in local mode, or `next dev` in dev mode), so its
// heavy deps never enter the shell bundle.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "desktop", "dist");
mkdirSync(dist, { recursive: true });

const common = {
  platform: "node",
  target: "node20",
  format: "cjs",
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  minify: false,
  // Electron runs its own Node runtime; don't try to bundle it.
  external: ["electron"],
};

// Google OAuth client for Drive backup (desktop/backup/wire.ts). Release builds
// get it from GitHub secrets; local builds may put it in .env.local. Missing →
// empty strings → the backup card says "not configured".
function readEnvLocal() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
const envLocal = readEnvLocal();
const googleDefine = Object.fromEntries(
  ["TRIVIO_GOOGLE_CLIENT_ID", "TRIVIO_GOOGLE_CLIENT_SECRET"].map((k) => [
    `process.env.${k}`,
    JSON.stringify(process.env[k] ?? envLocal[k] ?? ""),
  ])
);

await Promise.all([
  build({
    entryPoints: [resolve(root, "desktop", "main.ts")],
    outfile: resolve(dist, "main.cjs"),
    define: googleDefine,
    ...common,
  }),
  build({
    entryPoints: [resolve(root, "desktop", "preload.ts")],
    outfile: resolve(dist, "preload.cjs"),
    ...common,
  }),
]);

console.log("✓ compiled desktop shell → desktop/dist/{main,preload}.cjs");
