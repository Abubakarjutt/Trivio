"use client";

// Settings → Voice input: turn the chat's mic on/off, pick the speech model and
// language, and follow the one-time model download. Speech is transcribed on
// this computer (whisper.cpp) — no speech API.

import { Mic } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const LANGUAGES = [
  { id: "auto", label: "Auto-detect" },
  { id: "en", label: "English" },
  { id: "ur", label: "Urdu" },
] as const;

function mb(bytes: number) {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50",
              value === o.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border hover:bg-accent/40"
            )}
          >
            {o.label}
            {o.hint && <span className="text-muted-foreground ml-1.5 text-xs">{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VoiceInputCard() {
  const utils = trpc.useUtils();
  const { data: s } = trpc.voice.status.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.download?.active ? 1000 : false),
  });
  const onSaved = (data: NonNullable<typeof s>) => utils.voice.status.setData(undefined, data);
  const update = trpc.voice.updateSettings.useMutation({
    onSuccess: onSaved,
    onError: (e) => toast.error(e.message),
  });
  const retry = trpc.voice.downloadModel.useMutation({ onSuccess: onSaved });

  const d = s?.download;
  const pct = d?.total ? Math.floor((d.received / d.total) * 100) : 0;

  return (
    <div className="border-border/40 bg-card shadow-card space-y-4 rounded-2xl border p-6">
      <div className="flex items-start gap-3">
        <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <Mic className="text-muted-foreground h-4 w-4" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">Voice input</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Speak to the AI assistant instead of typing. Speech is turned into text on this computer
            — your voice is never sent anywhere.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!s?.enabled}
          aria-label="Voice input"
          disabled={!s || update.isPending}
          onClick={() => update.mutate({ enabled: !s?.enabled })}
          className={cn(
            "relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
            s?.enabled ? "bg-primary" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "bg-background inline-block h-5 w-5 rounded-full shadow transition-transform",
              s?.enabled ? "translate-x-5" : "translate-x-0.5"
            )}
          />
        </button>
      </div>

      {s?.enabled && (
        <div className="border-border/40 space-y-4 border-t pt-4">
          {!s.engineInstalled && (
            <p className="text-sm text-amber-600">
              The voice engine isn&apos;t included in this build, so the mic button won&apos;t work
              here. It ships with the Trivio desktop app.
            </p>
          )}

          <Choice
            label="Speech model"
            value={s.model}
            disabled={update.isPending}
            options={s.models.map((m) => ({
              id: m.id,
              label: m.label,
              hint: `${m.sizeMB} MB${m.id === "small" ? " · best for Urdu" : ""}`,
            }))}
            onChange={(model) => update.mutate({ model })}
          />
          <Choice
            label="Language you'll speak"
            value={s.language}
            disabled={update.isPending}
            options={LANGUAGES}
            onChange={(language) => update.mutate({ language })}
          />

          {s.modelReady ? (
            <p className="text-sm text-emerald-600">
              Ready — use the mic button in the AI assistant.
            </p>
          ) : d?.active ? (
            <div className="space-y-1.5">
              <p className="text-sm">
                Downloading the speech model (one time)…{" "}
                <span className="text-muted-foreground">
                  {d.total ? `${mb(d.received)} of ${mb(d.total)}` : mb(d.received)}
                </span>
              </p>
              <Progress value={pct} className="h-2" aria-label="Model download progress" />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-destructive text-sm">
                {d?.error
                  ? `Download stopped: ${d.error}`
                  : "The speech model hasn't been downloaded yet."}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={retry.isPending}
                onClick={() => retry.mutate()}
              >
                {d?.error ? "Retry" : "Download"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
