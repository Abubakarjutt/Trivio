// Opt-in live check of voice input with the REAL engine and model: speech
// made by macOS `say` goes through voice.service.ts → whisper-cli, exactly as
// a recording from the chat's mic button does. Needs:
//   npm run fetch:whisper                      (desktop/whisper/bin/whisper-cli)
//   the model in .whisper/models (turn voice on in Settings under `npm run dev`)
// Skips itself when either is missing, or off macOS.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  modelPath,
  transcribe,
  whisperBin,
  type VoiceLanguage,
} from "@/server/services/voice.service";

const env = { ...process.env, WHISPER_HOME: join(process.cwd(), ".whisper") };
const ready =
  process.platform === "darwin" && !!whisperBin(env) && existsSync(modelPath("small", env));

/** macOS text-to-speech → the 16 kHz mono WAV the chat sends. */
function say(text: string, voice?: string): Buffer {
  const file = join(mkdtempSync(join(tmpdir(), "say-")), "speech.wav");
  execFileSync("say", [
    ...(voice ? ["-v", voice] : []),
    "--file-format=WAVE",
    "--data-format=LEI16@16000",
    "-o",
    file,
    text,
  ]);
  return readFileSync(file);
}

async function hear(audio: Buffer, language: VoiceLanguage) {
  const started = Date.now();
  const text = await transcribe(audio, { model: "small", language, env });
  console.log(`[voice] (${language}, ${Date.now() - started} ms) ${text}`);
  return { text, ms: Date.now() - started };
}

describe.skipIf(!ready)("voice input with the real whisper engine", () => {
  it("hears an English expense well enough for the assistant to record it", async () => {
    const { text, ms } = await hear(
      say("I spent fifteen hundred rupees at Imtiaz supermarket yesterday"),
      "en"
    );
    expect(text).toMatch(/(1,?500|fifteen hundred)/i);
    expect(text).toMatch(/supermarket/i);
    expect(text).toMatch(/yesterday/i);
    expect(ms).toBeLessThan(20_000);
  });

  it("with Urdu selected, Hindustani speech comes back in Urdu script, not Devanagari", async () => {
    const { text } = await hear(say("मैंने बाज़ार में पाँच सौ रुपये खर्च किए", "Lekha"), "ur");
    expect(text).toMatch(/[؀-ۿ]/); // Arabic/Urdu script
    expect(text).not.toMatch(/[ऀ-ॿ]/); // no Devanagari
  });

  it("silence gives no text rather than a made-up sentence", async () => {
    const silence = say("[[slnc 2000]]");
    const { text } = await hear(silence, "en");
    expect(text).toBe("");
  });
});
