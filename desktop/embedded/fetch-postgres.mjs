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
//   TRIVIO_PG_SOURCE=edb npm run fetch:pg                    # force a source (env or --source=)
//   TRIVIO_PG_DOWNLOAD_URL=https://.../pg.zip npm run fetch:pg # pin one EDB archive
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
const sourceArg = flag("source", process.env.TRIVIO_PG_SOURCE || "auto");
const outOverride = flag("out", EMBEDDED);
const archOverride = flag("arch", null);
const versionArg = flag("version", process.env.TRIVIO_PG_VERSION || "16");

const SOURCE = sourceArg;
const wantArch = archOverride || arch(); // "arm64" | "x64"
const wantPlatform = platform(); // "darwin" | "linux" | "win32"
const EXE = wantPlatform === "win32" ? ".exe" : ""; // Windows executables
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
  if (!existsSync(join(BIN, "postgres" + EXE))) return null;
  try {
    const out = spawnSync(join(BIN, "postgres" + EXE), ["--version"], { encoding: "utf8" });
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
    const p = join(BIN, exe + EXE);
    if (existsSync(p) && wantPlatform !== "win32") {
      try {
        // Make the executables runnable (keg copies are already +x; copied dirs
        // from npm archives may not be). No-op on Windows (no chmod, .exe are already runnable).
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
    const p = join(BIN, exe + EXE);
    if (!existsSync(p)) die(`expected ${exe}${EXE} in ${BIN}`);
    const out = spawnSync(p, ["--version"], { encoding: "utf8" });
    if (out.status !== 0)
      die(
        `${exe}${EXE} --version failed (exit ${out.status})`,
        String(out.stderr || out.stdout).trim()
      );
    log(`✓ ${exe}${EXE}: ${String(out.stdout).trim()}`);
  }
}

// ── Sources ──────────────────────────────────────────────────────────────────
function detectLocal() {
  // 1. pg_config (any installed client/server toolchain) → bindir + libdir.
  const pgc = spawnSync("pg_config", ["--bindir", "--libdir"], { encoding: "utf8" });
  if (pgc.status === 0) {
    const [bindir, libdir] = String(pgc.stdout).trim().split("\n");
    if (
      bindir &&
      existsSync(join(bindir, "initdb" + EXE)) &&
      existsSync(join(bindir, "postgres" + EXE))
    )
      return { bindir, libdir, version: PG_VERSION, source: "local:pg_config" };
  }
  // 2. Homebrew keg (macOS). postgresql → symlinks into a versioned keg.
  const kegs = ["/opt/homebrew/opt", "/usr/local/opt"];
  for (const base of kegs) {
    for (const name of ["postgresql", "postgresql@17", "postgresql@16", "postgresql@18"]) {
      const bindir = join(base, name, "bin");
      if (existsSync(join(bindir, "initdb" + EXE)) && existsSync(join(bindir, "postgres" + EXE)))
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
    if (dir && existsSync(join(dir, "postgres" + EXE)))
      return {
        bindir: dir,
        libdir: join(dir, "..", "lib"),
        version: PG_VERSION,
        source: "local:path",
      };
  }
  return null;
}

// ── Source handlers ───────────────────────────────────────────────────────────
// Each handler EITHER lays the engine down (and the dispatch loop breaks) OR the
// source is not available on this host, in which case it RETURNS so the loop can
// try the next source. A hard die() happens only at the end of run(), once no
// source produced an engine — never inside a handler: a handler calling
// process.exit() (which die() does) kills the whole auto-fallback chain, so the
// very first "not available" source would abort the rest.

// 1. TRIVIO_PG_BIN — an explicit bin dir (+ sibling lib/). Unset ⇒ skip.
function fromEnvBin() {
  const dir = process.env.TRIVIO_PG_BIN;
  if (!dir) {
    log("TRIVIO_PG_BIN is not set — skipping 'env' source.");
    return;
  }
  if (!existsSync(join(dir, "initdb" + EXE))) {
    log(`TRIVIO_PG_BIN=${dir} has no initdb${EXE} — skipping 'env' source.`);
    return;
  }
  log(`copying engine from TRIVIO_PG_BIN=${dir}`);
  normalizeEngine(
    dir,
    process.env.TRIVIO_PG_LIB || join(dir, "..", "lib"),
    "TRIVIO_PG_BIN",
    PG_VERSION
  );
}

// 2. local — a system Postgres (pg_config / Homebrew keg / PATH). None ⇒ skip.
function fromLocal() {
  const found = detectLocal();
  if (!found) {
    log("no local Postgres found — skipping 'local' source.");
    return;
  }
  log(`using local engine at ${found.bindir}`);
  normalizeEngine(found.bindir, found.libdir, found.source, found.version);
}

// 3. brew (macOS) — `brew install postgresql@<ver>` then copy the keg. Not
// available (no brew / install fails / nothing detected) ⇒ skip.
function fromBrew() {
  const brew = spawnSync("which", ["brew"], { encoding: "utf8" });
  if (brew.status !== 0) {
    log("brew not found on PATH — skipping 'brew' source.");
    return;
  }
  // Pin to the requested major so the engine matches PG_VERSION: the default
  // `postgresql` formula now tracks a newer major than the app targets.
  const name = `postgresql@${PG_VERSION}`;
  log(`brew install ${name} ...`);
  const install = spawnSync("brew", ["install", name], { stdio: "inherit" });
  if (install.status !== 0) {
    log(`brew install ${name} failed — skipping 'brew' source.`);
    return;
  }
  const found = detectLocal();
  if (!found) {
    log("brew install succeeded but no engine was detected — skipping 'brew' source.");
    return;
  }
  normalizeEngine(found.bindir, found.libdir, "brew", PG_VERSION);
}

// 4. edb — EnterpriseDB "binaries" archive (portable, shippable). EDB has renamed
// its archives several times, so we try a matrix of current + legacy URL shapes
// (and the full installerVersion, e.g. 16.15, not just the bare major "16").
// TRIVIO_PG_DOWNLOAD_URL pins one exact archive (tried first). Any download or
// extract failure ⇒ skip; the loop + final guard in run() report the real cause.
// Requires `curl` plus (`unzip` on POSIX / `tar` on Windows 10+).
function candidateEdbUrls() {
  const base = "https://get.enterprisedb.com/postgresql/postgresql-";
  // EDB's "binaries" archives are named by installerVersion (16.15, 17.11, ...);
  // when the caller gave a bare major, also try the latest known minor.
  const known = {
    16: "16.15",
    17: "17.11",
    18: "18.6",
    15: "15.19",
    14: "14.24",
    13: "13.23",
  };
  const versions = new Set([PG_VERSION, PG_VERSION.split(".")[0]]);
  const minor = known[PG_VERSION];
  if (minor) versions.add(minor);

  // Per-platform OS/Arch tokens. macOS: macos13+arch, or universal "osx" (newer
  // EDB builds carry no arch suffix). Windows is x64-only; Linux uses x64/aarch64.
  const arch = wantArch === "arm64" ? "aarch64" : "x64";
  let tokens = [];
  if (wantPlatform === "darwin") {
    tokens = [
      { os: "macos13", arch },
      { os: "osx", arch: "" },
    ];
  } else if (wantPlatform === "win32") {
    tokens = [{ os: "windows", arch: "x64" }];
  } else {
    tokens = [{ os: "linux", arch }];
  }

  const urls = [];
  for (const v of versions) {
    for (const { os, arch: a } of tokens) {
      // Current shape: postgresql-<ver>-<os>[-<arch>]-binaries.zip
      urls.push(a ? `${base}${v}-${os}-${a}-binaries.zip` : `${base}${v}-${os}-binaries.zip`);
      // Legacy shape: postgresql-<ver>-binaries-<os>[-<arch>].zip
      urls.push(a ? `${base}${v}-binaries-${os}-${a}.zip` : `${base}${v}-binaries-${os}.zip`);
    }
  }
  // A pinned URL always wins (tried first, exactly once).
  const pinned = process.env.TRIVIO_PG_DOWNLOAD_URL;
  return pinned ? [pinned, ...urls] : urls;
}

// Recursively find the directory holding initdb[.exe] (the bindir). EDB archives
// extract to <root>/pgsql/{bin,lib} (newer) or a flat bin/ (older); a shallow DFS
// covers both without hard-coding the layout.
function findBindir(root) {
  let found = null;
  const walk = (dir, depth) => {
    if (found || depth > 4) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found) return;
      if (e.isFile() && e.name === "initdb" + EXE) {
        found = dir;
        return;
      }
    }
    for (const e of entries) {
      if (found || !e.isDirectory()) continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

function fromEdb() {
  const tmp = resolve(EMBEDDED, ".dl");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const xDir = join(tmp, "x");
  const zipPath = join(tmp, "pg.zip");

  for (const url of candidateEdbUrls()) {
    log(`trying EDB engine: ${url}`);
    const dl = spawnSync("curl", ["-fL", "-o", zipPath, url], { stdio: "inherit" });
    if (dl.status !== 0) {
      log(`  download failed (exit ${dl.status}) — trying next URL.`);
      continue;
    }
    // Windows 10+ ships `tar` (libarchive) which extracts .zip; POSIX uses unzip.
    const uz =
      wantPlatform === "win32"
        ? spawnSync("tar", ["-xf", zipPath, "-C", xDir], { stdio: "inherit" })
        : spawnSync("unzip", ["-q", zipPath, "-d", xDir], { stdio: "inherit" });
    if (uz.status !== 0) {
      log("  extraction failed — trying next URL.");
      continue;
    }
    // Windows keeps its DLLs under bin/ (self-contained), so a sibling lib/ may be
    // absent — that is fine. A portable engine finds libs via a sibling lib/ on
    // POSIX (the rpath/LD_LIBRARY_PATH in embedded-db.ts handles the rest).
    const bindir = findBindir(xDir);
    if (!bindir) {
      log("  could not locate initdb inside the archive — trying next URL.");
      continue;
    }
    const libdir = existsSync(join(bindir, "..", "lib")) ? join(bindir, "..", "lib") : undefined;
    rmSync(tmp, { recursive: true, force: true });
    log(`using EDB engine at ${bindir} (${url})`);
    normalizeEngine(bindir, libdir, "edb", PG_VERSION);
    return;
  }
  log("no EDB archive could be downloaded/extracted — skipping 'edb' source.");
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
  if (!existsSync(join(BIN, "postgres" + EXE)))
    die(
      "no Postgres engine could be obtained",
      "try --source=local, --source=brew (macOS), or --source=edb (needs a working EDB URL — pin one with TRIVIO_PG_DOWNLOAD_URL, or set TRIVIO_PG_BIN to a local engine)"
    );
  verify();
  log(`✓ embedded PostgreSQL ready at ${EMBEDDED}`);
  log("  run:  npm run dev:desktop:local   ·   build:  npm run build:desktop");
}

run();
