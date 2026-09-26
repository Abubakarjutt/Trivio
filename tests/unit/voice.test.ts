// Voice input: the WAV the chat sends, the model download (fresh, resumed,
// interrupted, corrupted) and transcription through the engine — with a local
// HTTP server standing in for the model host and a fake whisper-cli.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodeWav } from "@/lib/audio/wav";
import {
  VOICE_MODELS,
  cleanTranscript,
  isSilent,
  downloadModel,
  getVoiceStatus,
  isWav,
  modelPath,
  modelUrl,
  transcribe,
  whisperArgs,
  whisperBin,
  type VoiceEnv,
} from "@/server/services/voice.service";

const FAKE_BIN = resolve("tests/fixtures/fake-whisper.mjs");
/** A tone loud enough to count as speech. */
const tone = (n = 1600, amp = 0.2) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 5));
const wav = () => Buffer.from(encodeWav(tone()));

describe("encodeWav", () => {
  it("writes a 16 kHz mono 16-bit PCM WAV whisper can read", () => {
    const buf = Buffer.from(encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2])));
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.readUInt32LE(4)).toBe(buf.length - 8);
    expect(buf.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(buf.readUInt16LE(20)).toBe(1); // PCM
    expect(buf.readUInt16LE(22)).toBe(1); // mono
    expect(buf.readUInt32LE(24)).toBe(16000);
    expect(buf.readUInt16LE(34)).toBe(16);
    expect(buf.toString("ascii", 36, 40)).toBe("data");
    expect(buf.readUInt32LE(40)).toBe(7 * 2);
    const samples = Array.from({ length: 7 }, (_, i) => buf.readInt16LE(44 + i * 2));
    // Out-of-range input is clipped, not wrapped around.
    expect(samples).toEqual([0, 16383, -16384, 32767, -32768, 32767, -32768]);
    expect(isWav(buf)).toBe(true);
  });

  it("rejects anything that isn't a WAV", () => {
    expect(isWav(Buffer.from("OggS".padEnd(64, "\0")))).toBe(false);
    expect(isWav(Buffer.alloc(10))).toBe(false);
  });
});

describe("cleanTranscript", () => {
  it("drops non-speech markers and joins lines", () => {
    expect(cleanTranscript("\n [BLANK_AUDIO]\n")).toBe("");
    expect(cleanTranscript(" I spent 1500 at Imtiaz (music)\n yesterday [Laughter] *coughs*")).toBe(
      "I spent 1500 at Imtiaz yesterday"
    );
    expect(cleanTranscript(" میں نے امتیاز پر 1500 خرچ کیے")).toBe("میں نے امتیاز پر 1500 خرچ کیے");
  });
});

describe("isSilent", () => {
  it("tells silence and room hiss from speech", () => {
    expect(isSilent(Buffer.from(encodeWav(new Float32Array(16000))))).toBe(true);
    expect(isSilent(Buffer.from(encodeWav(tone(16000, 0.002))))).toBe(true); // faint hiss
    expect(isSilent(Buffer.from(encodeWav(tone(16000, 0.05))))).toBe(false);
  });

  it("finds the audio after extra chunks (macOS writes a FLLR chunk first)", () => {
    const plain = Buffer.from(encodeWav(tone(16000, 0.05)));
    const filler = Buffer.alloc(8 + 12);
    filler.write("FLLR", 0, "ascii");
    filler.writeUInt32LE(12, 4);
    const withFiller = Buffer.concat([plain.subarray(0, 36), filler, plain.subarray(36)]);
    expect(isSilent(withFiller)).toBe(false);
  });
});

describe("whisperArgs", () => {
  it("names the model, file and language, with no timestamps or log noise", () => {
    const args = whisperArgs("/m.bin", "/a.wav", "ur");
    expect(args.slice(0, 8)).toEqual(["-m", "/m.bin", "-f", "/a.wav", "-l", "ur", "-nt", "-np"]);
    expect(Number(args[9])).toBeGreaterThanOrEqual(1);
  });
});

// ── Download ─────────────────────────────────────────────────────────────────

const MODEL = Buffer.from("x".repeat(64 * 1024));
let server: Server;
let base = "";
let mode: "range" | "no-range" | "fail" | "drop" = "range";
const ranges: (string | undefined)[] = [];

server = createServer((req, res) => {
  ranges.push(req.headers.range);
  if (mode === "fail") {
    res.statusCode = 503;
    return res.end();
  }
  const m = /bytes=(\d+)-/.exec(req.headers.range ?? "");
  if (m && mode === "range") {
    const from = Number(m[1]);
    res.writeHead(206, { "Content-Length": MODEL.length - from });
    return res.end(MODEL.subarray(from));
  }
  res.writeHead(200, { "Content-Length": MODEL.length });
  if (mode === "drop") {
    // Half the file, then the connection dies.
    res.write(MODEL.subarray(0, MODEL.length / 2));
    return setTimeout(() => res.destroy(), 20);
  }
  res.end(MODEL);
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
afterAll(() => server.close());

function freshEnv(): VoiceEnv {
  return { WHISPER_HOME: mkdtempSync(join(tmpdir(), "voice-")), WHISPER_MODEL_BASE_URL: base };
}

beforeEach(() => {
  mode = "range";
  ranges.length = 0;
});

describe("downloadModel", () => {
  it("downloads the model once, reporting progress, then it's ready", async () => {
    const env = freshEnv();
    expect(getVoiceStatus("base", env)).toMatchObject({ modelReady: false, download: null });
    const p = downloadModel("base", env);
    expect(downloadModel("base", env)).toBe(p); // a second click joins the same download
    expect(getVoiceStatus("base", env).download?.active).toBe(true);
    await p;
    const s = getVoiceStatus("base", env);
    expect(s.modelReady).toBe(true);
    expect(s.download).toMatchObject({
      received: MODEL.length,
      total: MODEL.length,
      active: false,
      error: null,
    });
    expect(readFileSync(modelPath("base", env)).equals(MODEL)).toBe(true);
    await downloadModel("base", env); // already there — no request
    expect(ranges).toHaveLength(1);
  });

  it("resumes an interrupted download where it stopped", async () => {
    const env = freshEnv();
    mode = "drop";
    await downloadModel("small", env);
    const failed = getVoiceStatus("small", env);
    expect(failed.modelReady).toBe(false);
    expect(failed.download?.error).toBeTruthy();
    const partSize = readFileSync(`${modelPath("small", env)}.part`).length;
    expect(partSize).toBeGreaterThan(0);

    mode = "range";
    await downloadModel("small", env);
    expect(ranges.at(-1)).toBe(`bytes=${partSize}-`);
    expect(readFileSync(modelPath("small", env)).equals(MODEL)).toBe(true);
    expect(existsSync(`${modelPath("small", env)}.part`)).toBe(false);
  });

  it("starts over when the server ignores the Range request", async () => {
    const env = freshEnv();
    mkdirSync(join(env.WHISPER_HOME!, "models"), { recursive: true });
    writeFileSync(`${modelPath("base", env)}.part`, "garbage");
    mode = "no-range";
    await downloadModel("base", env);
    expect(readFileSync(modelPath("base", env)).equals(MODEL)).toBe(true);
  });

  it("reports a failed download and can be retried", async () => {
    const env = freshEnv();
    mode = "fail";
    await downloadModel("base", env);
    expect(getVoiceStatus("base", env).download?.error).toMatch(/HTTP 503/);
    mode = "range";
    await downloadModel("base", env);
    expect(getVoiceStatus("base", env)).toMatchObject({
      modelReady: true,
      download: { error: null },
    });
  });

  it("throws away a model whose checksum doesn't match the pinned one", async () => {
    const env: VoiceEnv = { WHISPER_HOME: mkdtempSync(join(tmpdir(), "voice-")) };
    expect(modelUrl("base", env)).toBe(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${VOICE_MODELS.base.file}`
    );
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (_u: string, init?: RequestInit) => real(base, init));
    try {
      await downloadModel("base", env);
    } finally {
      vi.stubGlobal("fetch", real);
    }
    expect(getVoiceStatus("base", env)).toMatchObject({
      modelReady: false,
      download: { error: expect.stringMatching(/corrupted/) },
    });
    expect(existsSync(`${modelPath("base", env)}.part`)).toBe(false);
  });
});

// ── Transcription ────────────────────────────────────────────────────────────

describe("transcribe", () => {
  function readyEnv(): VoiceEnv {
    const env: VoiceEnv = { ...process.env, ...freshEnv(), WHISPER_BIN: FAKE_BIN };
    mkdirSync(join(env.WHISPER_HOME!, "models"), { recursive: true });
    writeFileSync(modelPath("small", env), "model");
    return env;
  }

  it("runs the engine on the recording and returns clean text", async () => {
    const env: VoiceEnv = {
      ...readyEnv(),
      FAKE_WHISPER_TEXT: "I spent 1500 at Imtiaz [BLANK_AUDIO]",
    };
    const log = (env.FAKE_WHISPER_LOG = join(env.WHISPER_HOME!, "calls.log"));
    expect(await transcribe(wav(), { model: "small", language: "ur", env })).toBe(
      "I spent 1500 at Imtiaz"
    );
    // A silent recording never reaches the engine.
    const calls = readFileSync(log, "utf8");
    expect(
      await transcribe(Buffer.from(encodeWav(new Float32Array(16000))), {
        model: "small",
        language: "ur",
        env,
      })
    ).toBe("");
    expect(readFileSync(log, "utf8")).toBe(calls);
    const args = JSON.parse(calls.trim()) as string[];
    expect(args[args.indexOf("-l") + 1]).toBe("ur");
    expect(args[args.indexOf("-m") + 1]).toBe(modelPath("small", env));
    // The temporary recording is deleted afterwards.
    expect(existsSync(args[args.indexOf("-f") + 1])).toBe(false);
  });

  it("explains what's missing instead of failing mysteriously", async () => {
    const env = readyEnv();
    await expect(
      transcribe(Buffer.from("not audio"), { model: "small", language: "auto", env })
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(transcribe(wav(), { model: "base", language: "auto", env })).rejects.toMatchObject(
      {
        status: 409,
        message: expect.stringMatching(/hasn't finished downloading/),
      }
    );
    // No engine anywhere (run from a folder without a dev build of it).
    const cwd = process.cwd();
    process.chdir(mkdtempSync(join(tmpdir(), "voice-cwd-")));
    try {
      await expect(
        transcribe(wav(), {
          model: "small",
          language: "auto",
          env: { ...env, WHISPER_BIN: "/nope" },
        })
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      process.chdir(cwd);
    }
    await expect(
      transcribe(wav(), {
        model: "small",
        language: "auto",
        env: { ...env, FAKE_WHISPER_FAIL: "1" },
      })
    ).rejects.toMatchObject({
      status: 500,
      message: expect.stringMatching(/failed to load model/),
    });
  });

  it("runs one recording at a time, and a failure doesn't block the next", async () => {
    const env = { ...readyEnv(), FAKE_WHISPER_TEXT: "hello" };
    const results = await Promise.allSettled([
      transcribe(wav(), {
        model: "small",
        language: "en",
        env: { ...env, FAKE_WHISPER_FAIL: "1" },
      }),
      transcribe(wav(), { model: "small", language: "en", env }),
      transcribe(wav(), { model: "small", language: "en", env }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
  });

  it("finds the engine from WHISPER_BIN only when it exists", () => {
    expect(whisperBin({ WHISPER_BIN: FAKE_BIN })).toBe(FAKE_BIN);
    const cwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), "voice-cwd-"));
    process.chdir(dir);
    try {
      expect(whisperBin({ WHISPER_BIN: "/definitely/missing" })).toBeNull();
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
