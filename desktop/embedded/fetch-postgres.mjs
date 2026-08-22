// Trivio desktop — fetch a self-contained PostgreSQL engine.
//
// The embedded Postgres lifecycle (desktop/embedded/embedded-db.ts) needs two
// executables — `initdb` and `postgres` — plus the shared libraries they load.
// This tool obtains a *portable* engine for the current platform/arch and lays
// it down under desktop/embedded/ as:
//
//      desktop/embedded/bin/   ← initdb, postgres, pg_ctl, …
//      desktop/embedded/lib/   ← libpq, libicu, … (siblings of bin/)
//      desktop/embedded/VERSION← "postgres X.Y.Z" + provenance
//      desktop/embedded/MANIFEST.json ← machine-readable provenance
//
// The engine is git-ignored (large, platform-specific binary) and produced on
// demand by `npm run fetch:pg`. It is idempotent: if a matching engine is
// already present it is a no-op (unless --force).
//
// Sources, in --source=auto order:
//   1. TRIVIO_PG_BIN           an explicit bin dir (+ sibling lib/) to copy.
//   2. local                   a system Postgres (pg_config / Homebrew keg / PATH).
//   3. brew (macOS)            `brew install postgresql@<ver>` then copy the keg.
//   4. edb                     EnterpriseDB "binaries" archive (portable, shippable).
//
// Usage:
//   npm run fetch:pg                      # auto, current platform/arch
//   node desktop/embedded/fetch-postgres.mjs --source=local --force
//   TRIVIO_PG_BIN=/opt/homebrew/opt/postgresql/bin npm run fetch:pg
//   TRIVIO_PG_VERSION=17 node desktop/embedded/fetch-postgres.mjs --source=edb
//
// `postgres --version` is run after every fetch to prove the engine is real.

import { spawnSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";

const here = dirname(fileURLToPath(import.meta.url)); // desktop/embedded
const EMBEDDED = here;
const BIN = join(EMBEDDED, "bin");
const LIB = join(EMBEDDED, "lib");
const VERSION_FILE = join(EMBEDDED, "VERSION");
const MANIFEST_FILE = join(EMBEDDED, "MANIFEST.json");

// ── Args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name, fallback) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return fallback;
}
const FORCE = argv.includes("--force");
const sourceArg = flag("source", "auto");
const outOverride = flag("out", EMBEDDED);
const archOverride = flag("arch", null);
const versionArg = flag("version", process.env.TRIVIO_PG_VERSION || "16");

const SOURCE = sourceArg;
const wantArch = archOverride || arch(); // "arm64" | "x64"
const wantPlatform = platform(); // "darwin" | "linux" | ...
const PG_VERSION = versionArg;

function log(...a) {
  console.log("[fetch:pg]", ...a);
}
function die(msg, hint) {
  console.error(`✗ ${msg}`);
  if (hint) console.error(`   ${hint}`);
  process.exit(1);
}

// ── Idempotency ──────────────────────────────────────────────────────────────
function installedVersion() {
  if (!existsSync(join(BIN, "postgres"))) return null;
  try {
    const out = spawnSync(join(BIN, "postgres"), ["--version"], { encoding: "utf8" });
    const m = (out.stdout || "").match(/PostgreSQL ([0-9]+\.[0-9]+(?:\.[0-9]+)?)/);
    return m ? m[1] : "unknown";
  } catch {
    return null;
  }
}

if (!FORCE && installedVersion()) {
  const manifest = existsSync(MANIFEST_FILE)
    ? JSON.parse(readFileSync(MANIFEST_FILE, "utf8"))
    : null;
  log(
    `engine already present (postgres ${installedVersion()}, source=${manifest?.source ?? "?"}).`
  );
  log("Re-run with --force to replace it.");
  process.exit(0);
}

// ── Copy helpers ─────────────────────────────────────────────────────────────
function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

function normalizeEngine(binDir, libDir, source, version) {
  rmSync(BIN, { recursive: true, force: true });
  rmSync(LIB, { recursive: true, force: true });
  copyDir(binDir, BIN);
  // A portable engine carries its own shared libs; copy them as a sibling of bin/.
  const candidateLib = libDir || join(dirname(binDir), "lib");
  if (existsSync(candidateLib)) copyDir(candidateLib, LIB);
  for (const exe of ["initdb", "postgres"]) {
    const p = join(BIN, exe);
    if (existsSync(p)) {
      try {
        // Make the executables runnable (keg copies are already +x; copied dirs
        // from npm archives may not be).
        spawnSync("chmod", ["755", p]);
      } catch {}
    }
  }
  const manifest = {
    source,
    version,
    platform: wantPlatform,
    arch: wantArch,
    binDir: "bin",
    libDir: existsSync(LIB) ? "lib" : null,
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(
    VERSION_FILE,
    `postgres ${version}\nsource: ${source}\nplatform: ${wantPlatform}-${wantArch}\n`
  );
  log(`laid out engine at ${EMBEDDED} (source=${source}, v${version})`);
}

// Prove the engine is real by invoking the shipped binaries.
function verify() {
  for (const exe of ["postgres", "initdb"]) {
    const p = join(BIN, exe);
    if (!existsSync(p)) die(`expected ${exe} in ${BIN}`);
    const out = spawnSync(p, ["--version"], { encoding: "utf8" });
    if (out.status !== 0)
      die(`${exe} --version failed (exit ${out.status})`, String(out.stderr || out.stdout).trim());
    log(`✓ ${exe}: ${String(out.stdout).trim()}`);
  }
}

// ── Sources ──────────────────────────────────────────────────────────────────
function detectLocal() {
  // 1. pg_config (any installed client/server toolchain) → bindir + libdir.
  const pgc = spawnSync("pg_config", ["--bindir", "--libdir"], { encoding: "utf8" });
  if (pgc.status === 0) {
    const [bindir, libdir] = String(pgc.stdout).trim().split("\n");
    if (bindir && existsSync(join(bindir, "initdb")) && existsSync(join(bindir, "postgres")))
      return { bindir, libdir, version: PG_VERSION, source: "local:pg_config" };
  }
  // 2. Homebrew keg (macOS). postgresql → symlinks into a versioned keg.
  const kegs = ["/opt/homebrew/opt", "/usr/local/opt"];
  for (const base of kegs) {
    for (const name of ["postgresql", "postgresql@17", "postgresql@16", "postgresql@18"]) {
      const bindir = join(base, name, "bin");
      if (existsSync(join(bindir, "initdb")) && existsSync(join(bindir, "postgres")))
        return {
          bindir,
          libdir: join(base, name, "lib"),
          version: PG_VERSION,
          source: `local:brew:${name}`,
        };
    }
  }
  // 3. On PATH?
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["initdb"], {
    encoding: "utf8",
  });
  if (which.status === 0) {
    const dir = dirname(String(which.stdout).trim().split(/\r?\n/)[0]);
    if (dir && existsSync(join(dir, "postgres")))
      return {
        bindir: dir,
        libdir: join(dir, "..", "lib"),
        version: PG_VERSION,
        source: "local:path",
      };
  }
  return null;
}

function fromLocal() {
  const found = detectLocal();
  if (!found)
    die(
      "no local Postgres found",
      "install one (e.g. `brew install postgresql`) or use --source=edb"
    );
  log(`using local engine at ${found.bindir}`);
  normalizeEngine(found.bindir, found.libdir, found.source, found.version);
}

function fromEnvBin() {
  const dir = process.env.TRIVIO_PG_BIN;
  if (!dir) die("TRIVIO_PG_BIN is not set");
  if (!existsSync(join(dir, "initdb"))) die(`TRIVIO_PG_BIN=${dir} has no initdb`);
  log(`copying engine from TRIVIO_PG_BIN=${dir}`);
  normalizeEngine(
    dir,
    process.env.TRIVIO_PG_LIB || join(dir, "..", "lib"),
    "TRIVIO_PG_BIN",
    PG_VERSION
  );
}

function fromBrew() {
  const brew = spawnSync("which", ["brew"], { encoding: "utf8" });
  if (brew.status !== 0) die("brew not found on PATH");
  const name = "postgresql";
  log(`brew install ${name}…`);
  const install = spawnSync("brew", ["install", name], { stdio: "inherit" });
  if (install.status !== 0) die(`brew install ${name} failed`);
  const found = detectLocal();
  if (!found) die("brew install succeeded but no engine was detected");
  normalizeEngine(found.bindir, found.libdir, "brew", PG_VERSION);
}

// EDB "binaries" archive (portable). The URL is version-stamped; override with
// TRIVIO_PG_DOWNLOAD_URL for a pinned build. Requires `unzip` on the host.
function fromEdb() {
  const archPart = wantArch === "arm64" ? "aarch64" : "x64";
  const osPart = wantPlatform === "darwin" ? "macos13" : "linux";
  const url =
    process.env.TRIVIO_PG_DOWNLOAD_URL ||
    `https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-binaries-${osPart}-${archPart}.zip`;
  log(`downloading EDB engine: ${url}`);
  const tmp = resolve(EMBEDDED, ".dl");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const zipPath = join(tmp, "pg.zip");
  const dl = spawnSync("curl", ["-fL", "-o", zipPath, url], { stdio: "inherit" });
  if (dl.status !== 0)
    die(
      `download failed: ${url}`,
      "set TRIVIO_PG_DOWNLOAD_URL to a pinned EDB archive, or use --source=local/brew"
    );
  const uz = spawnSync("unzip", ["-q", zipPath, "-d", join(tmp, "x")], { stdio: "inherit" });
  if (uz.status !== 0) die("unzip failed (is 'unzip' installed?)");
  // EDB layout: <root>/pgsql/{bin,lib}
  const extracted = readdirSync(join(tmp, "x"), { withFileTypes: true })
    .map((e) => join(tmp, "x", e.name))
    .find(
      (p) => existsSync(join(p, "bin", "initdb")) || existsSync(join(p, "pgsql", "bin", "initdb"))
    );
  if (!extracted) die("could not locate pgsql/bin inside the EDB archive");
  const pgsql = existsSync(join(extracted, "pgsql")) ? join(extracted, "pgsql") : extracted;
  const bindir = join(pgsql, "bin");
  const libdir = join(pgsql, "lib");
  rmSync(tmp, { recursive: true, force: true });
  log(`using EDB engine at ${bindir}`);
  normalizeEngine(bindir, libdir, "edb", PG_VERSION);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
function run() {
  const order =
    SOURCE === "auto"
      ? ["env", "local", "brew", "edb"]
      : SOURCE === "local"
        ? ["local"]
        : SOURCE === "brew"
          ? ["brew"]
          : SOURCE === "edb"
            ? ["edb"]
            : SOURCE === "env"
              ? ["env"]
              : ["auto"];
  log(
    `platform=${wantPlatform} arch=${wantArch} source=${SOURCE} version=${PG_VERSION}${FORCE ? " force" : ""}`
  );
  const handlers = { env: fromEnvBin, local: fromLocal, brew: fromBrew, edb: fromEdb };
  for (const s of order) {
    try {
      handlers[s]();
      break;
    } catch (e) {
      log(`(source ${s} failed: ${e.message})`);
    }
  }
  if (!existsSync(join(BIN, "postgres")))
    die(
      "no Postgres engine could be obtained",
      "try: --source=local (install one first), --source=brew (macOS), or --source=edb (network)"
    );
  verify();
  log(`✓ embedded PostgreSQL ready at ${EMBEDDED}`);
  log("  run:  npm run dev:desktop:local   ·   build:  npm run build:desktop");
}

run();
