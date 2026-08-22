// Trivio — assemble a self-contained app server from the Next.js standalone
// build into ./desktop/dist-server so it can be booted by the desktop shell
// (DESKTOP_MODE=local) or packaged into the .app/.dmg by electron-builder.
//
// `next build` (output: "standalone") produces a runnable Node server plus a
// filtered node_modules, but NOT the static assets or public folder — Next
// expects a sibling static/ and public/ folder next to server.js. We copy those
// in, along with prisma/ (migrations) and a user .env slot.
//
// NOTE: some Next versions nest the standalone output (e.g. .next/standalone/
// projects/<name>/server.js). We locate server.js at any depth so this is
// robust to that.
//
// The app still needs Postgres + Redis reachable at runtime. For production,
// point DATABASE_URL / REDIS_URL at hosted services via ~/.trivio/.env.
//
// Run after `npm run build` (or `npm run next dev` is NOT sufficient — you need
// a production build). Usage: node desktop/assemble-server.mjs

import { cpSync, existsSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const standaloneRoot = join(root, ".next", "standalone");
const out = join(root, "desktop", "dist-server");

function die(msg, hint) {
  console.error(`✗ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

// Recursively find the first server.js under the standalone tree.
function findServer(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "server.js" && e.isFile()) return join(dir, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findServer(join(dir, e.name));
      if (found) return found;
    }
  }
  return null;
}

if (!existsSync(standaloneRoot))
  die(
    `no .next/standale found at ${standaloneRoot}`,
    `run "npm run build" first (package.json sets output: "standalone").`
  );

const serverJs = findServer(standaloneRoot);
if (!serverJs) die("no server.js under .next/standalone", "run npm run build first");

const runDir = dirname(serverJs); // the dir server.js expects as its cwd

// Fresh assemble every time.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

console.log(`→ assembling self-contained app server`);
console.log(`  standalone run dir: ${runDir}`);

// 1. Copy the entire standalone run tree (server.js + filtered node_modules +
//    any inlined app content) into dist-server.
console.log(`  · copying standalone run tree → dist-server`);
cpSync(runDir, out, { recursive: true });

// 2. Static assets. The standalone server's distDir is "./.next" (see
//    required-server-files.json), so it resolves /_next/static/* requests to
//    <cwd>/.next/static — NOT a top-level ./static. Copying there instead
//    silently 404s every CSS/JS/font chunk and the app renders unstyled.
if (existsSync(join(root, ".next", "static"))) {
  console.log(`  · copying .next/static  → dist-server/.next/static`);
  cpSync(join(root, ".next", "static"), join(out, ".next", "static"), {
    recursive: true,
  });
} else {
  console.warn(`  ! no .next/static found (client assets may 404 at runtime)`);
}

// 3. Public folder (if present in the project).
if (existsSync(join(root, "public"))) {
  console.log(`  · copying public/       → dist-server/public`);
  cpSync(join(root, "public"), join(out, "public"), { recursive: true });
}

// 4. Prisma migrations + schema, so `prisma migrate deploy` can run at startup.
if (existsSync(join(root, "prisma"))) {
  console.log(`  · copying prisma/       → dist-server/prisma`);
  cpSync(join(root, "prisma"), join(out, "prisma"), { recursive: true });
}

// 5. Ship a *template* (.env.example), never a real .env, so first-run can seed
//    ~/.trivio/.env (see main.ts buildServerEnv). Real credentials must never be
//    baked into the signed app bundle.
const envExampleDst = join(out, ".env.example");
if (existsSync(join(root, ".env.example"))) {
  cpSync(join(root, ".env.example"), envExampleDst, { force: true });
  console.log("   copied .env.example -> dist-server/.env.example (template only, no secrets)");
} else {
  console.warn("   no .env.example at project root; skipping env template");
}
// Defensive: never let a stray .env leak into the packaged server tree.
const strayEnv = join(out, ".env");
if (existsSync(strayEnv)) {
  rmSync(strayEnv, { force: true });
  console.warn("   removed stray .env from dist-server (do not bundle real credentials)");
}

console.log(`✓ assembled app server at ${out} (${serverJs})`);
console.log(`  run locally:  node desktop/dist-server/server.js   (needs DB/Redis)`);
console.log(`  via shell:    DESKTOP_MODE=local npm run build:desktop`);
