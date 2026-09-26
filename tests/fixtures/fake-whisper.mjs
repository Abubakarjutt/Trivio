#!/usr/bin/env node
// Stand-in for whisper.cpp's `whisper-cli` in QA / e2e tests: checks it was
// called the way voice.service.ts calls the real engine, then prints a
// scripted transcript. The real engine is exercised by tests/ai/voice.ai.test.ts.
//   FAKE_WHISPER_TEXT  what to "hear" (default: silence)
//   FAKE_WHISPER_LOG   append each call's args (JSON) to this file
//   FAKE_WHISPER_FAIL  exit 1 like a crashed engine
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (flag) => args[args.indexOf(flag) + 1];

if (process.env.FAKE_WHISPER_LOG) appendFileSync(process.env.FAKE_WHISPER_LOG, `${JSON.stringify(args)}\n`);
if (process.env.FAKE_WHISPER_FAIL) {
  console.error("whisper_init_from_file: failed to load model");
  process.exit(1);
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
