// QA: voice input in the AI chat — the Settings switch, model + language
// choice, the one-time model download, and the real /api/voice/transcribe
// route against the real database. A local HTTP server stands in for the
// model host and a fake whisper-cli for the engine (the real engine is
// covered by tests/ai/voice.ai.test.ts).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { callerFor, newUser, type QaUser } from "./harness";
import { encodeWav } from "@/lib/audio/wav";
import { downloadModel, modelPath } from "@/server/services/voice.service";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

const MODEL = Buffer.from("m".repeat(32 * 1024));
let server: Server;
let requests = 0;
const home = mkdtempSync(join(tmpdir(), "voice-qa-"));
process.env.WHISPER_HOME = home;
process.env.WHISPER_BIN = resolve("tests/fixtures/fake-whisper.mjs");
process.env.FAKE_WHISPER_LOG = join(home, "calls.log");

const { auth } = await import("@/lib/auth");
const route = await import("@/app/api/voice/transcribe/route");

let u: QaUser;

beforeAll(async () => {
  server = createServer((_req, res) => {
    requests++;
    res.writeHead(200, { "Content-Length": MODEL.length });
    res.end(MODEL);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  process.env.WHISPER_MODEL_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  u = await newUser();
});
afterAll(() => server.close());

// A tone stands in for speech (silence is dropped before the engine runs).
const speech = () =>
  new Blob([encodeWav(Float32Array.from({ length: 16000 }, (_, i) => 0.2 * Math.sin(i / 5)))], {
    type: "audio/wav",
  });
const silence = () => new Blob([encodeWav(new Float32Array(16000))], { type: "audio/wav" });

async function speak(as: string | null, body: Blob | string = speech()) {
  vi.mocked(auth).mockResolvedValue((as ? { user: { id: as } } : null) as never);
  const res = await route.POST(
    new Request("http://app/api/voice/transcribe", { method: "POST", body }) as never
  );
  return {
    status: res.status,
    body: res.ok ? ((await res.json()) as { text: string }) : await res.text(),
  };
}

async function waitForModel(api: QaUser["api"]) {
  for (let i = 0; i < 100; i++) {
    const s = await api.voice.status();
    if (s.modelReady || s.download?.error) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("model download never finished");
}

describe("voice input settings", () => {
  it("is off for a new user, with no mic and nothing downloaded", async () => {
    const s = await u.api.voice.status();
    expect(s).toMatchObject({
      enabled: false,
      model: "small",
      language: "auto",
      modelReady: false,
      download: null,
    });
    expect(s.engineInstalled).toBe(true);
    expect(s.models.map((m) => m.id)).toEqual(["base", "small"]);
    expect(requests).toBe(0);
  });

  it("turning it on downloads the chosen model once, then the mic works", async () => {
    const on = await u.api.voice.updateSettings({ enabled: true, model: "base" });
    expect(on).toMatchObject({ enabled: true, model: "base" });
    const s = await waitForModel(u.api);
    expect(s).toMatchObject({ modelReady: true, download: { error: null, active: false } });
    expect(readFileSync(modelPath("base")).equals(MODEL)).toBe(true);
    expect(requests).toBe(1);

    // Retrying when it's already there doesn't download again.
    await u.api.voice.downloadModel();
    expect(requests).toBe(1);

    process.env.FAKE_WHISPER_TEXT = "I spent 25 at the bakery";
    expect(await speak(u.userId)).toEqual({
      status: 200,
      body: { text: "I spent 25 at the bakery" },
    });
  });

  it("speaks in the language the user picked", async () => {
    await u.api.voice.updateSettings({ language: "ur" });
    await speak(u.userId);
    const calls = readFileSync(process.env.FAKE_WHISPER_LOG!, "utf8").trim().split("\n");
    const args = JSON.parse(calls.at(-1)!) as string[];
    expect(args[args.indexOf("-l") + 1]).toBe("ur");
    expect(args[args.indexOf("-m") + 1]).toBe(modelPath("base"));
  });

  it("switching models downloads the new model too", async () => {
    await u.api.voice.updateSettings({ model: "small" });
    // The download started by the switch finishes in the background.
    await downloadModel("small");
    expect(existsSync(modelPath("small"))).toBe(true);
    expect((await u.api.voice.status()).modelReady).toBe(true);
  });

  it("turning it off turns the mic off", async () => {
    await u.api.voice.updateSettings({ enabled: false });
    expect((await u.api.voice.status()).enabled).toBe(false);
    const res = await speak(u.userId);
    expect(res.status).toBe(403);
    expect(res.body).toMatch(/turned off/);
  });

  it("rejects bad settings", async () => {
    await expect(u.api.voice.updateSettings({ model: "huge" as never })).rejects.toThrow();
    await expect(u.api.voice.updateSettings({ language: "fr" as never })).rejects.toThrow();
  });

  it("each person's switch is their own, and signed-out callers get nothing", async () => {
    const other = await newUser();
    await u.api.voice.updateSettings({ enabled: true });
    expect((await other.api.voice.status()).enabled).toBe(false);
    expect((await speak(other.userId)).status).toBe(403);
    expect((await speak(null)).status).toBe(401);
    await expect(callerFor(null).voice.status()).rejects.toThrow();
    await expect(callerFor(null).voice.updateSettings({ enabled: true })).rejects.toThrow();
    await expect(callerFor(null).voice.downloadModel()).rejects.toThrow();
  });
});

describe("the transcribe route", () => {
  it("turns silence into nothing, and refuses things that aren't a recording", async () => {
    process.env.FAKE_WHISPER_TEXT = "Thank you.";
    // Whisper would "hear" words in silence — silence must come back empty.
    expect(await speak(u.userId, silence())).toEqual({ status: 200, body: { text: "" } });
    delete process.env.FAKE_WHISPER_TEXT;
    expect(await speak(u.userId)).toEqual({ status: 200, body: { text: "" } });
    const notAudio = await speak(u.userId, "hello");
    expect(notAudio.status).toBe(400);
  });

  it("refuses a recording that's too long", async () => {
    const big = new Blob([new Uint8Array(5 * 1024 * 1024)]);
    expect((await speak(u.userId, big)).status).toBe(413);
  });

  it("reports an engine crash as an error, not as empty text", async () => {
    process.env.FAKE_WHISPER_FAIL = "1";
    try {
      const res = await speak(u.userId);
      expect(res.status).toBe(500);
      expect(res.body).toMatch(/failed to load model/);
    } finally {
      delete process.env.FAKE_WHISPER_FAIL;
    }
  });
});
