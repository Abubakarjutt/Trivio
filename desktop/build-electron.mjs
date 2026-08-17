// Trivio — compile the Electron shell (main + preload) to CommonJS.
//
// The main process is plain Electron + Node built-ins, so the bundle only needs
// `electron` marked external. The Next.js server is a separate process (booted
// from desktop/dist-server in local mode, or `next dev` in dev mode), so its
// heavy deps never enter the shell bundle.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

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

await Promise.all([
  build({
    entryPoints: [resolve(root, "desktop", "main.ts")],
    outfile: resolve(dist, "main.cjs"),
    ...common,
  }),
  build({
    entryPoints: [resolve(root, "desktop", "preload.ts")],
    outfile: resolve(dist, "preload.cjs"),
    ...common,
  }),
]);

console.log("✓ compiled desktop shell → desktop/dist/{main,preload}.cjs");
