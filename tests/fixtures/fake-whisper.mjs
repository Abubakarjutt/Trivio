#!/usr/bin/env node
// Stand-in for whisper.cpp's `whisper-cli` in QA / e2e tests: checks it was
// called the way voice.service.ts calls the real engine, then prints a
// scripted transcript. The real engine is exercised by tests/ai/voice.ai.test.ts.
//   FAKE_WHISPER_TEXT  what to "hear" (default: silence)
//   FAKE_WHISPER_LOG   append each call's args (JSON) to this file
//   FAKE_WHISPER_FAIL  exit 1 like a crashed engine
//   FAKE_WHISPER_GPU_FAIL  crash unless told to use the CPU (-ng), like a broken GPU driver
// Without -np it logs, like the real engine, which device it picked.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (flag) => args[args.indexOf(flag) + 1];

if (process.env.FAKE_WHISPER_LOG)
  appendFileSync(process.env.FAKE_WHISPER_LOG, `${JSON.stringify(args)}\n`);
if (process.env.FAKE_WHISPER_FAIL) {
  console.error("whisper_init_from_file: failed to load model");
  process.exit(1);
}
const gpu = !args.includes("-ng");
if (gpu && process.env.FAKE_WHISPER_GPU_FAIL) {
  console.error("ggml_vulkan: device lost on Vulkan0");
  process.exit(1);
}
if (!args.includes("-np")) {
  console.error(
    gpu
      ? "whisper_backend_init_gpu: using MTL0 backend\nggml_metal_init: found device: Fake M1"
      : "whisper_backend_init_gpu: no GPU found"
  );
}
if (!existsSync(opt("-m"))) {
  console.error(`model not found: ${opt("-m")}`);
  process.exit(1);
}
const wav = readFileSync(opt("-f"));
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
  console.error("not a WAV file");
  process.exit(1);
}
process.stdout.write(`\n ${process.env.FAKE_WHISPER_TEXT ?? "[BLANK_AUDIO]"}\n`);
