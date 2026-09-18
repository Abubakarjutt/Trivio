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
  realpathSync,
  copyFileSync,
} from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
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
// A Homebrew keg's lib/ is full of convenience symlinks (e.g. libpq.dylib ->
// /opt/homebrew/Cellar/postgresql@16/16.15/lib/libpq.5.dylib) pointing at
// ABSOLUTE paths outside the copied tree. Left as symlinks, they are dangling
// on every machine but the one that built the engine (any other Mac,
// including one with a different/no Homebrew install, or even the same
// machine after a `brew upgrade` changes the Cellar version path). A bundle
// containing dangling symlinks fails `codesign --verify --deep --strict` (and
// therefore Gatekeeper) with a bare "No such file or directory" -- surfacing
// to users as "app is damaged", not a missing-file error.
//
// NOTE: `cpSync(..., { dereference: true })` looks like the fix but is NOT
// sufficient -- Node only dereferences a symlink at the top of the copied
// tree, not ones nested inside it during a recursive directory copy (verified
// empirically against Node's actual behavior, not just docs). So we do the
// plain copy, then walk the copied tree ourselves and replace any surviving
// symlink with a real copy of its fully-resolved target.
function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  dereferenceSymlinksInPlace(dest);
}

function dereferenceSymlinksInPlace(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = realpathSync(p); // fully resolves chained/relative symlinks
      rmSync(p);
      copyFileSync(target, p);
    } else if (entry.isDirectory()) {
      dereferenceSymlinksInPlace(p);
    }
  }
}

// A Homebrew keg's binaries and dylibs hardcode ABSOLUTE paths to their
// dependencies right in the Mach-O load commands (e.g. `postgres` linked
// against `/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib`), not
// @rpath-relative ones. This is a separate, more severe problem than the
// dangling-symlink issue dereferenceSymlinksInPlace() fixes: those absolute
// dependencies are NOT copied into the shipped lib/ at all, so dyld fails
// with "Library not loaded" at process launch on any Mac that doesn't
// happen to have the exact same Homebrew formulae installed at the exact
// same paths -- true even after codesign/Gatekeeper are satisfied.
//
// Fix: walk every Mach-O file under bin/ and lib/, and for each dependency
// that resolves to a Homebrew-style absolute path (/opt/homebrew/... or
// /usr/local/..., i.e. NOT a guaranteed-present macOS system path under
// /usr/lib or /System), copy the real dependency file into lib/ (following
// the recursive closure -- libssl depends on libcrypto, etc.) and rewrite
// the load command to a path relative to the binary itself:
// @executable_path/../lib/<name> from bin/, @loader_path/<name> from lib/
// (siblings). System paths (/usr/lib/*, /System/*) are left alone -- they
// are present on every Mac by definition.
function relocateMachO(binOrigin, libOrigin) {
  if (wantPlatform !== "darwin") return; // otool/install_name_tool are macOS-only

  const HOMEBREW_ABS = /^\/(opt\/homebrew|usr\/local)\//;
  const isSystemPath = (p) => /^\/usr\/lib\//.test(p) || /^\/System\//.test(p);

  function readDeps(file) {
    const out = spawnSync("otool", ["-L", file], { encoding: "utf8" });
    if (out.status !== 0) return null; // not a Mach-O file
    return String(out.stdout)
      .split("\n")
      .slice(1)
      .map((l) => l.trim().match(/^(\S+)\s+\(compatibility/))
      .filter(Boolean)
      .map((m) => m[1]);
  }
  function readOwnId(file) {
    const out = spawnSync("otool", ["-D", file], { encoding: "utf8" });
    if (out.status !== 0) return null;
    const lines = String(out.stdout).trim().split("\n");
    return lines.length > 1 ? lines[1].trim() : null;
  }

  const queue = [];
  for (const dir of [BIN, LIB]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) queue.push(join(dir, name));
  }
  const queued = new Set(queue);
  const touched = new Set(); // files that need a fresh ad-hoc signature afterward
  let changed = false;
  // Which real Homebrew directory each copied file came from, so an
  // already-relative (@loader_path/@rpath) dependency of THAT file -- e.g.
  // icu4c's libicuuc.dylib depending on its own sibling libicudata.dylib --
  // can still be found and copied in, not just absolute-path dependencies.
  const originDir = new Map();
  for (const name of existsSync(BIN) ? readdirSync(BIN) : []) originDir.set(join(BIN, name), binOrigin);
  for (const name of existsSync(LIB) ? readdirSync(LIB) : []) originDir.set(join(LIB, name), libOrigin);

  while (queue.length) {
    const file = queue.shift();
    const deps = readDeps(file);
    if (deps === null) continue; // not a Mach-O file (e.g. a script, a data file)
    spawnSync("chmod", ["u+w", file]); // Cellar copies are read-only

    const ownId = readOwnId(file);
    if (ownId && HOMEBREW_ABS.test(ownId)) {
      const rel = relativeRef(false /* isBin */, basename(ownId));
      const idResult = spawnSync("install_name_tool", ["-id", rel, file]);
      if (idResult.status !== 0) die(`install_name_tool -id failed on ${file}`, idResult.stderr);
      changed = true;
      touched.add(file);
    }

    for (const dep of deps) {
      if (dep === ownId || isSystemPath(dep)) continue;

      // Already relative (@loader_path/<name> or @rpath/<name>): correct once its
      // sibling actually exists next to it in our shipped lib/ -- no install_name_tool
      // rewrite needed, just make sure the sibling got copied in too.
      if (dep.startsWith("@loader_path/") || dep.startsWith("@rpath/")) {
        const libname = basename(dep);
        const destLib = join(LIB, libname);
        if (existsSync(destLib)) continue; // sibling already present -- satisfied as-is
        const origin = originDir.get(file);
        if (!origin) {
          die(
            `Mach-O dependency ${dep} referenced by ${file}, but no known source directory to find its sibling ${libname} in`
          );
        }
        const src = join(origin, libname);
        if (!existsSync(src)) {
          die(
            `Mach-O dependency ${dep} referenced by ${file}: expected sibling at ${src}, but it does not exist`,
            "the Homebrew formula providing it may have been removed/upgraded since the engine was fetched -- re-run `npm run fetch:pg --source=brew --force`"
          );
        }
        copyFileSync(realpathSync(src), destLib);
        spawnSync("chmod", ["u+w", destLib]);
        originDir.set(destLib, dirname(realpathSync(src)));
        if (!queued.has(destLib)) {
          queued.add(destLib);
          queue.push(destLib);
        }
        continue;
      }

      if (dep.startsWith("@") || !HOMEBREW_ABS.test(dep)) continue;

      const libname = basename(dep);
      const destLib = join(LIB, libname);
      if (!existsSync(destLib)) {
        if (!existsSync(dep)) {
          die(
            `Mach-O dependency referenced by ${file} does not exist on disk: ${dep}`,
            "the Homebrew formula providing it may have been removed/upgraded since the engine was fetched -- re-run `npm run fetch:pg --source=brew --force`"
          );
        }
        copyFileSync(realpathSync(dep), destLib);
        spawnSync("chmod", ["u+w", destLib]);
        originDir.set(destLib, dirname(realpathSync(dep)));
        if (!queued.has(destLib)) {
          queued.add(destLib);
          queue.push(destLib);
        }
      }
      const inLibDir = dirname(file) === LIB;
      const newRef = relativeRef(!inLibDir, libname);
      const changeResult = spawnSync("install_name_tool", ["-change", dep, newRef, file]);
      if (changeResult.status !== 0)
        die(`install_name_tool -change failed on ${file}`, changeResult.stderr);
      changed = true;
      touched.add(file);
    }
  }

  // install_name_tool invalidates whatever signature was already on the file, and
  // its own automatic re-sign is NOT reliable enough to trust (verified empirically:
  // it can leave a signature that `codesign --verify` itself rejects as "invalid
  // signature (code or signature have been modified)" -- which the arm64 kernel
  // then enforces at exec time as a silent SIGKILL, not a normal error). Every
  // touched file gets an explicit, fresh ad-hoc signature. This is not the final
  // signature (electron-builder's own afterSign hook re-signs the whole .app when
  // it's packaged) -- it just needs to be valid enough for `postgres --version`
  // to run during this script's own verify() step, immediately below.
  for (const file of touched) {
    const sign = spawnSync("codesign", ["--force", "--sign", "-", file]);
    if (sign.status !== 0) die(`codesign --force --sign - failed on ${file}`, sign.stderr);
  }
  if (changed) log("relocated Homebrew-absolute dylib references to @executable_path/@loader_path.");
}
function relativeRef(isBin, libname) {
  return isBin ? `@executable_path/../lib/${libname}` : `@loader_path/${libname}`;
}

// initdb needs its "share" data dir (postgres.bki, system_views.sql, timezone
// data, …) to create a cluster at all -- this is separate from, and just as
// required as, the dylibs relocateMachO() fixes. A Homebrew keg nests it one
// level further under a version-qualified name (share/postgresql@16); THAT
// exact nesting is what lets the running `postgres` server (which has no CLI
// flag to point it at a share dir, unlike initdb's `-L`) find it again via
// Postgres's own compiled-relative-offset relocation once the engine is
// copied out from under its original Homebrew prefix. A portable EDB archive
// instead puts the input files directly under share/ already.
function findShareSource(binDir) {
  const shareParent = join(dirname(binDir), "share");
  if (!existsSync(shareParent)) return null;
  const pgSub = readdirSync(shareParent).find((n) => n.startsWith("postgresql"));
  return pgSub ? join(shareParent, pgSub) : shareParent;
}

function normalizeEngine(binDir, libDir, source, version) {
  rmSync(BIN, { recursive: true, force: true });
  rmSync(LIB, { recursive: true, force: true });
  copyDir(binDir, BIN);
  // A portable engine carries its own shared libs; copy them as a sibling of bin/.
  const candidateLib = libDir || join(dirname(binDir), "lib");
  if (existsSync(candidateLib)) copyDir(candidateLib, LIB);
  const realBinDir = existsSync(binDir) ? realpathSync(binDir) : binDir;
  const shareSrc = findShareSource(realBinDir);
  let shareDirName = null;
  if (shareSrc) {
    shareDirName = basename(shareSrc) === "share" ? null : basename(shareSrc);
    const shareDest = shareDirName ? join(EMBEDDED, "share", shareDirName) : join(EMBEDDED, "share");
    copyDir(shareSrc, shareDest);
    log(`copied Postgres share dir from ${shareSrc}`);
  }
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
  relocateMachO(realBinDir, existsSync(candidateLib) ? realpathSync(candidateLib) : candidateLib);
  const manifest = {
    source,
    version,
    platform: wantPlatform,
    arch: wantArch,
    binDir: "bin",
    libDir: existsSync(LIB) ? "lib" : null,
    shareDir: shareSrc ? (shareDirName ? `share/${shareDirName}` : "share") : null,
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
    } catch (e) {
      log(`(source ${s} failed: ${e.message})`);
    }
    // A handler either lays the engine down or returns because its source is
    // unavailable on this host. Only stop the chain when the engine actually
    // materialised — otherwise fall through to the next source. The old code
    // broke on *any* return, so the very first "skip" aborted the whole chain.
    if (existsSync(join(BIN, "postgres" + EXE))) {
      log(`'${s}' produced the engine — stopping the source chain.`);
      break;
    }
    log(`'${s}' did not produce an engine — trying next source.`);
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
