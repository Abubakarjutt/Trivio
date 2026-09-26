// Trivio desktop — build the local speech-to-text engine (whisper.cpp).
//
// Voice input in the AI chat is transcribed on the user's machine by
// whisper.cpp's `whisper-cli` — no speech API. whisper.cpp publishes no
// prebuilt binaries, so this compiles a pinned release from source and lays
// the engine down as:
//
//      desktop/whisper/bin/whisper-cli(.exe)   the engine, GPU-enabled
//      desktop/whisper/bin/default.metallib    macOS: its GPU code, precompiled
//      desktop/whisper/bin/whisper-cli-cpu.exe Windows: CPU-only fallback
//      desktop/whisper/VERSION
//
// electron-builder ships that tree as <resources>/whisper (see
// electron-builder.yml); main.ts points the server at it via WHISPER_BIN.
// The speech MODEL is not bundled — it is downloaded when the user turns voice
// input on (server/services/voice.service.ts).
//
// GPU:
//  - macOS: Metal. The shaders are precompiled into default.metallib here;
//    otherwise every new build compiles them from source on the user's Mac on
//    first use (~15 s). Needs Xcode's Metal compiler — without it (Xcode 26+
//    ships it as a separate download: `xcodebuild -downloadComponent
//    MetalToolchain`) the shaders are embedded as source instead.
//  - Windows: Vulkan, which every current NVIDIA / AMD / Intel driver provides.
//    A Vulkan build won't start on a PC without a Vulkan driver, so a CPU-only
//    build ships beside it and the server falls back to it. Needs the Vulkan
//    SDK (VULKAN_SDK); without it only the CPU build is made.
//  TRIVIO_WHISPER_GPU=required (set in CI) makes a missing GPU toolchain an
//  error, so a release never silently ships without GPU support.
//
// The build is portable: static (no shared libs), GGML_NATIVE=OFF so it runs on
// any CPU of the target arch, static MSVC runtime on Windows. Idempotent: a
// matching VERSION is a no-op unless --force.
//
// Usage:
//   npm run fetch:whisper
//   node desktop/embedded/fetch-whisper.mjs --force
//   TRIVIO_WHISPER_VERSION=v1.9.4 npm run fetch:whisper
//
// Needs cmake + a C/C++ toolchain (Xcode / MSVC). Each engine's `--help` is run
// afterwards to prove it is real; desktop/embedded/check-whisper.mjs then runs a
// real transcription.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "whisper");
const binDir = join(root, "bin");
const version = process.env.TRIVIO_WHISPER_VERSION || "v1.9.4";
const force = process.argv.includes("--force");
const gpuRequired = process.env.TRIVIO_WHISPER_GPU === "required";
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const ext = isWin ? ".exe" : "";

function run(cmd, args, opts = {}) {
  console.log(`[whisper] $ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed (exit ${r.status ?? r.signal})`);
}

function noGpu(why) {
  if (gpuRequired) throw new Error(`GPU build required but ${why}`);
  console.warn(`[whisper] WARNING: ${why} — building without it.`);
}

// Which GPU build this machine can make.
let gpu = "none";
if (isMac) {
  const metal = spawnSync("xcrun", ["-sdk", "macosx", "metal", "--version"], { encoding: "utf8" });
  if (metal.status === 0) gpu = "metal-precompiled";
  else {
    noGpu(
      "Xcode's Metal compiler isn't installed (xcodebuild -downloadComponent MetalToolchain), " +
        "so the GPU shaders will compile on each Mac's first use"
    );
    gpu = "metal-source";
  }
} else if (isWin) {
  if (process.env.VULKAN_SDK) gpu = "vulkan";
  else noGpu("the Vulkan SDK isn't installed (VULKAN_SDK is unset)");
}

const stamp = `whisper.cpp ${version} ${process.platform}-${process.arch} gpu:${gpu}`;
const versionFile = join(root, "VERSION");
if (
  !force &&
  existsSync(join(binDir, `whisper-cli${ext}`)) &&
  existsSync(versionFile) &&
  readFileSync(versionFile, "utf8").trim() === stamp
) {
  console.log(`[whisper] ${stamp} already built — skipping (use --force to rebuild)`);
  process.exit(0);
}

const work = join(root, ".build");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const url = `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${version}.tar.gz`;
console.log(`[whisper] downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
writeFileSync(join(work, "src.tar.gz"), Buffer.from(await res.arrayBuffer()));
// Relative path + cwd: Git Bash's GNU tar reads "C:\..." as a remote host.
run("tar", ["-xzf", "src.tar.gz"], { cwd: work });
const src = join(work, `whisper.cpp-${version.replace(/^v/, "")}`);

const common = [
  "-DCMAKE_BUILD_TYPE=Release",
  "-DBUILD_SHARED_LIBS=OFF",
  "-DGGML_NATIVE=OFF",
  "-DWHISPER_BUILD_TESTS=OFF",
  "-DWHISPER_BUILD_SERVER=OFF",
  "-DWHISPER_SDL2=OFF",
];
if (isMac) common.push("-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0");
// CMP0091=NEW makes CMake honour CMAKE_MSVC_RUNTIME_LIBRARY (static CRT, no vcruntime DLLs).
if (isWin)
  common.push("-DCMAKE_POLICY_DEFAULT_CMP0091=NEW", "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded");

/** Configure + build `targets` in work/<name>; returns its output folder. */
function build(name, flags, targets) {
  const dir = join(work, name);
  run("cmake", ["-S", src, "-B", dir, ...common, ...flags]);
  run("cmake", [
    "--build",
    dir,
    "--config",
    "Release",
    "-j",
    String(cpus().length),
    "--target",
    ...targets,
  ]);
  const out = [join(dir, "bin", "Release"), join(dir, "bin")].find((p) =>
    existsSync(join(p, `whisper-cli${ext}`))
  );
  if (!out) throw new Error(`build finished but whisper-cli${ext} was not found under ${dir}/bin`);
  return out;
}

// Start from an empty bin/ so nothing from an earlier variant lingers.
rmSync(binDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });
const shipped = [];
function ship(from, name, as = name) {
  copyFileSync(join(from, name), join(binDir, as));
  if (!isWin) chmodSync(join(binDir, as), 0o755);
  shipped.push(as);
}

if (gpu === "metal-precompiled") {
  const out = build(
    "metal",
    ["-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=OFF"],
    ["whisper-cli", "ggml-metal-lib"]
  );
  ship(out, "whisper-cli");
  // ggml looks for these next to the running binary.
  ship(out, "default.metallib");
  if (existsSync(join(out, "ggml-tensor.metallib"))) ship(out, "ggml-tensor.metallib");
} else if (gpu === "metal-source") {
  ship(
    build("metal", ["-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON"], ["whisper-cli"]),
    "whisper-cli"
  );
} else if (gpu === "vulkan") {
  ship(build("vulkan", ["-DGGML_VULKAN=ON"], ["whisper-cli"]), `whisper-cli${ext}`);
  ship(build("cpu", [], ["whisper-cli"]), `whisper-cli${ext}`, `whisper-cli-cpu${ext}`);
} else {
  ship(build("cpu", [], ["whisper-cli"]), `whisper-cli${ext}`);
}
rmSync(work, { recursive: true, force: true });

for (const exe of shipped.filter((f) => f.startsWith("whisper-cli"))) {
  const check = spawnSync(join(binDir, exe), ["--help"], { encoding: "utf8" });
  if (`${check.stdout}${check.stderr}`.includes("usage")) continue;
  // The Vulkan engine needs a Vulkan driver just to start; a build machine
  // without a GPU may lack one. The server falls back to the CPU engine then.
  if (gpu === "vulkan" && exe === `whisper-cli${ext}`) {
    console.warn(
      `[whisper] note: ${exe} doesn't start here (no Vulkan driver?) — the CPU engine covers that.`
    );
    continue;
  }
  throw new Error(`built ${exe} does not run: ${check.stderr || check.error}`);
}
writeFileSync(versionFile, `${stamp}\n`);
console.log(`[whisper] ready (${gpu}): ${shipped.map((f) => join(binDir, f)).join(", ")}`);
