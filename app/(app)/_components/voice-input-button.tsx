"use client";

// The chat's mic button: record → local whisper.cpp → text in the message box.
// Hidden unless voice input is turned on in Settings. The transcript is put in
// the input for the user to check and send — never sent on its own.

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { recordingToWav } from "@/lib/audio/wav";

const MAX_SECONDS = 60;

type Phase = "idle" | "recording" | "transcribing";

export function VoiceInputButton({
  active,
  disabled,
  onTranscript,
}: {
  active: boolean; // the chat panel is open
  disabled?: boolean;
  onTranscript: (text: string) => void;
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);

  const { data: status } = trpc.voice.status.useQuery(undefined, {
    enabled: active,
    retry: false,
    // Follow the model download while it runs.
    refetchInterval: (q) => (q.state.data?.download?.active ? 2000 : false),
  });

  // Tick the timer and stop at the limit.
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === "recording" && seconds >= MAX_SECONDS) recorder.current?.stop();
  }, [phase, seconds]);

  // Release the mic if the panel closes mid-recording.
  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    []
  );

  if (!status?.enabled) return null;

  const ready = status.engineInstalled && status.modelReady;
  const pct =
    status.download?.total && status.download.total > 0
      ? Math.floor((status.download.received / status.download.total) * 100)
      : null;
  const notReadyReason = !status.engineInstalled
    ? "Voice input isn't available in this build"
    : status.download?.active
      ? `Downloading the voice model${pct !== null ? ` — ${pct}%` : "…"}`
      : "The voice model isn't downloaded yet — see Settings";

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast({
        title: "Microphone blocked",
        description: "Allow Trivio to use the microphone in your system settings, then try again.",
        variant: "destructive",
      });
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setPhase("transcribing");
      try {
        const wav = await recordingToWav(new Blob(chunks, { type: rec.mimeType }));
        const res = await fetch("/api/voice/transcribe", {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: wav,
        });
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const { text } = (await res.json()) as { text: string };
        if (text) onTranscript(text);
        else toast({ title: "Didn't catch that", description: "No speech was heard — try again." });
      } catch (err) {
        toast({
          title: "Couldn't transcribe",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setPhase("idle");
      }
    };
    recorder.current = rec;
    setSeconds(0);
    rec.start();
    setPhase("recording");
  }

  if (phase === "recording") {
    return (
      <Button
        type="button"
        size="icon"
        variant="destructive"
        className="relative shrink-0"
        onClick={() => recorder.current?.stop()}
        aria-label={`Stop recording (${seconds}s)`}
        title={`Recording — ${seconds}s. Click to stop.`}
      >
        <Square className="h-3.5 w-3.5 fill-current" />
        <span className="absolute -top-1 -right-1 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="shrink-0"
      disabled={disabled || !ready || phase === "transcribing"}
      onClick={() => void start()}
      aria-label={phase === "transcribing" ? "Transcribing" : "Speak your message"}
      title={
        !ready ? notReadyReason : phase === "transcribing" ? "Transcribing…" : "Speak your message"
      }
    >
      {phase === "transcribing" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
