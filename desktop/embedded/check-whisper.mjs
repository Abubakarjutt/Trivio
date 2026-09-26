// Trivio desktop — prove the built speech engine really transcribes, and on
// what. Runs after fetch-whisper.mjs (in CI, before packaging).
//
// For each engine in desktop/whisper/bin it transcribes whisper.cpp's JFK
// sample with the tiny model, twice (a first run, then a warm one), and reports
// the device and times. It fails when an engine that must work doesn't:
//  - macOS: when the GPU is used, its precompiled shaders (default.metallib)
//    must load — compiling them from source is what made first use slow.
//  - Windows: the CPU engine must work (it's the fallback); the Vulkan one is
//    reported, and may not start on a build machine without a GPU driver.
//
// Usage: node desktop/embedded/check-whisper.mjs
//   TRIVIO_WHISPER_CHECK_MODEL=/path/to/ggml-*.bin  use a model already on disk

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "whisper");
const cache = join(root, ".cache");
const ext = process.platform === "win32" ? ".exe" : "";
const version = process.env.TRIVIO_WHISPER_VERSION || "v1.9.4";

async function fetchTo(url, path) {
  if (existsSync(path)) return path;
  console.log(`[check] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${url}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

mkdirSync(cache, { recursive: true });
const model =
  process.env.TRIVIO_WHISPER_CHECK_MODEL ||
  (await fetchTo(
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin",
    join(cache, "ggml-tiny-q5_1.bin")
  ));
const audio = await fetchTo(
  `https://raw.githubusercontent.com/ggml-org/whisper.cpp/${version}/samples/jfk.wav`,
  join(cache, "jfk.wav")
);

function transcribe(bin) {
  const t0 = Date.now();
  const r = spawnSync(bin, ["-m", model, "-f", audio, "-l", "en", "-nt"], { encoding: "utf8" });
  const log = r.stderr ?? "";
  return {
    ok: r.status === 0,
    ms: Date.now() - t0,
    text: (r.stdout ?? "").trim(),
    log,
    device: /using (\S+) backend/.exec(log)?.[1] ?? (log.includes("no GPU found") ? "CPU" : "?"),
    error: r.error?.message || log.trim().split("\n").at(-1) || `exit ${r.status}`,
  };
}

let failed = false;
function fail(msg) {
  console.error(`[check] FAIL: ${msg}`);
  failed = true;
}

for (const name of [`whisper-cli${ext}`, `whisper-cli-cpu${ext}`]) {
  const bin = join(root, "bin", name);
  if (!existsSync(bin)) continue;
  const first = transcribe(bin);
  const second = first.ok ? transcribe(bin) : first;
  console.log(
    `[check] ${name}: ${first.ok ? "ok" : "FAILED"} on ${first.device} — first run ${first.ms} ms, ` +
      `second ${second.ms} ms — "${first.text || first.error}"`
  );

  const isVulkanEngine = process.platform === "win32" && name === `whisper-cli${ext}`;
  if (!first.ok) {
    if (isVulkanEngine)
      console.log("[check] (no Vulkan driver here — the CPU engine is the fallback)");
    else fail(`${name} didn't run: ${first.error}`);
    continue;
  }
  if (!/country/i.test(first.text)) fail(`${name} transcribed the sample wrong: "${first.text}"`);

  if (process.platform === "darwin") {
    if (!first.device.startsWith("MTL")) {
      console.warn(
        "[check] WARNING: Metal isn't available on this machine — the GPU path wasn't exercised."
      );
    } else if (existsSync(join(root, "bin", "default.metallib"))) {
      if (!/loading '.*default\.metallib'/.test(first.log))
        fail("the precompiled default.metallib wasn't used — shaders were compiled from source");
    }
  }
}

if (failed) process.exit(1);
console.log("[check] speech engine OK");
