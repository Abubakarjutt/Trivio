"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

/** False until the AI status has loaded and says the provider is usable. Disable AI buttons with it. */
export function useAiReady(): boolean {
  const { data } = trpc.outreachSettings.aiStatus.useQuery(undefined, { staleTime: 60_000 });
  return data?.ready === true;
}

/** Says when AI features won't work, and that Gemini sends prospect text to Google (spec §5 Privacy). */
export function AiNotice() {
  const { data } = trpc.outreachSettings.aiStatus.useQuery(undefined, { staleTime: 60_000 });
  if (!data) return null;
  if (!data.ready) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          The AI isn&apos;t ready ({data.provider}, {data.model}), so drafting and extraction
          won&apos;t work. You can still add prospects by hand. Check it in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>
          .
        </span>
      </div>
    );
  }
  if (data.provider === "gemini") {
    return <p className="text-muted-foreground text-xs">Prospect text is sent to Google Gemini.</p>;
  }
  return null;
}
