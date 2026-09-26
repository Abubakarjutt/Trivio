// POST /api/voice/transcribe — the chat's mic button sends a WAV recording,
// the local whisper.cpp engine turns it into text (server/services/voice.service.ts).
// Nothing is stored and nothing leaves the machine.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { chatRateLimiter } from "@/server/middleware/rateLimit";
import {
  MAX_AUDIO_BYTES,
  VOICE_LANGUAGES,
  VoiceError,
  isVoiceModelId,
  transcribe,
  type VoiceLanguage,
} from "@/server/services/voice.service";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      organisationId: true,
      voiceInputEnabled: true,
      voiceModel: true,
      voiceLanguage: true,
    },
  });
  if (!user?.organisationId) return new Response("No organisation", { status: 403 });
  if (!user.voiceInputEnabled) {
    return new Response("Voice input is turned off. Turn it on in Settings.", { status: 403 });
  }

  try {
    await chatRateLimiter(`voice:${user.id}`);
  } catch {
    return new Response("Too many requests. Try again shortly.", { status: 429 });
  }

  if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) {
    return new Response("Recording is too long.", { status: 413 });
  }
  const audio = Buffer.from(await req.arrayBuffer());
  if (audio.length > MAX_AUDIO_BYTES)
    return new Response("Recording is too long.", { status: 413 });

  try {
    const text = await transcribe(audio, {
      model: isVoiceModelId(user.voiceModel) ? user.voiceModel : "small",
      language: (VOICE_LANGUAGES as readonly string[]).includes(user.voiceLanguage)
        ? (user.voiceLanguage as VoiceLanguage)
        : "auto",
    });
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof VoiceError) return new Response(err.message, { status: err.status });
    console.error("[voice] transcription failed", err);
    return new Response("Transcription failed.", { status: 500 });
  }
}
