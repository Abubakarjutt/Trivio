// Trivio desktop — build the local speech-to-text engine (whisper.cpp).
//
// Voice input in the AI chat is transcribed on the user's machine by
// whisper.cpp's `whisper-cli` — no speech API. whisper.cpp publishes no
// prebuilt binaries, so this compiles a pinned release from source and lays
// the executable down as:
//
//      desktop/whisper/bin/whisper-cli(.exe)
//      desktop/whisper/VERSION
//
// electron-builder ships that tree as <resources>/whisper (see
// electron-builder.yml); main.ts points the server at it via WHISPER_BIN.
// The speech MODEL is not bundled — it is downloaded when the user turns voice
// input on (server/services/voice.service.ts).
//
// The build is portable: static (no shared libs), GGML_NATIVE=OFF so it runs on
// any CPU of the target arch, Metal shaders embedded on macOS, static MSVC
// runtime on Windows. Idempotent: a matching VERSION is a no-op unless --force.
//
// Usage:
//   npm run fetch:whisper
//   node desktop/embedded/fetch-whisper.mjs --force
//   TRIVIO_WHISPER_VERSION=v1.9.4 npm run fetch:whisper
//
// Needs cmake + a C/C++ toolchain (Xcode CLT / MSVC). `whisper-cli --help` is
// run afterwards to prove the binary is real.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "whisper");
const version = process.env.TRIVIO_WHISPER_VERSION || "v1.9.4";
const force = process.argv.includes("--force");
const isWin = process.platform === "win32";
const exe = isWin ? "whisper-cli.exe" : "whisper-cli";
const out = join(root, "bin", exe);
const stamp = `whisper.cpp ${version} ${process.platform}-${process.arch}`;

function run(cmd, args, opts = {}) {
  console.log(`[whisper] $ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed (exit ${r.status ?? r.signal})`);
}

const versionFile = join(root, "VERSION");
if (!force && existsSync(out) && existsSync(versionFile) && readFileSync(versionFile, "utf8").trim() === stamp) {
  console.log(`[whisper] ${stamp} already built — skipping (use --force to rebuild)`);
  process.exit(0);
}

const work = join(root, ".build");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const tarball = join(work, "src.tar.gz");
const url = `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${version}.tar.gz`;
console.log(`[whisper] downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
// Relative path + cwd: Git Bash's GNU tar reads "C:\..." as a remote host.
run("tar", ["-xzf", "src.tar.gz"], { cwd: work });
const src = join(work, `whisper.cpp-${version.replace(/^v/, "")}`);

const flags = [
  "-DCMAKE_BUILD_TYPE=Release",
  "-DBUILD_SHARED_LIBS=OFF",
  "-DGGML_NATIVE=OFF",
  "-DWHISPER_BUILD_TESTS=OFF",
  "-DWHISPER_BUILD_SERVER=OFF",
  "-DWHISPER_SDL2=OFF",
];
if (process.platform === "darwin") {
  flags.push("-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON", "-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0");
}
// CMP0091=NEW makes CMake honour CMAKE_MSVC_RUNTIME_LIBRARY (static CRT, no vcruntime DLLs).
if (isWin) flags.push("-DCMAKE_POLICY_DEFAULT_CMP0091=NEW", "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded");

const build = join(work, "build");
run("cmake", ["-S", src, "-B", build, ...flags]);
run("cmake", ["--build", build, "--config", "Release", "--target", "whisper-cli", "-j", String(cpus().length)]);

const built = [join(build, "bin", exe), join(build, "bin", "Release", exe)].find((p) => existsSync(p));
if (!built) throw new Error(`build finished but ${exe} was not found under ${build}/bin`);

mkdirSync(dirname(out), { recursive: true });
copyFileSync(built, out);
if (!isWin) chmodSync(out, 0o755);
rmSync(work, { recursive: true, force: true });

const check = spawnSync(out, ["--help"], { encoding: "utf8" });
if (!`${check.stdout}${check.stderr}`.includes("usage")) {
  throw new Error(`built ${exe} does not run: ${check.stderr || check.error}`);
}
writeFileSync(versionFile, `${stamp}\n`);
console.log(`[whisper] ready: ${out}`);
