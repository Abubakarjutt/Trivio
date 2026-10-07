"use client";

import { Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OutreachGate } from "../_components/outreach-gate";

const KIND_LABEL: Record<string, string> = {
  seed: "From seller.md",
  request_sent: "Connection note",
  message_sent: "Message",
  light_touch: "Light touch",
};

export default function VoicePage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Voice"
        description="What you actually sent, names removed. Drafts copy this tone and length."
      />
      <OutreachGate>
        <VoiceList />
      </OutreachGate>
    </div>
  );
}

function VoiceList() {
  const utils = trpc.useUtils();
  const { data = [], isLoading, isError, error, refetch } = trpc.outreachVoice.list.useQuery();
  const del = trpc.outreachVoice.delete.useMutation({
    onSuccess: () => utils.outreachVoice.list.invalidate(),
    // The example may already be gone (another window): refresh so the list is truthful.
    onError: () => void utils.outreachVoice.list.invalidate(),
  });

  if (isLoading) return <div className="bg-muted h-64 animate-pulse rounded-xl" />;
  if (isError) {
    return (
      <div className="border-border/60 max-w-3xl space-y-3 rounded-xl border p-4">
        <p className="text-destructive text-sm">
          Couldn&apos;t load your voice examples: {error.message}
        </p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="space-y-3">
        {del.error && <p className="text-destructive text-sm">{del.error.message}</p>}
        <p className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          No voice examples yet. When you mark a message done, use &ldquo;I changed the
          wording&rdquo; to save what you really sent.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-3xl space-y-3">
      {del.error && (
        <p className="text-destructive text-sm">Couldn&apos;t delete it: {del.error.message}</p>
      )}
      {data.map((v) => (
        <Card key={v.id}>
          <CardContent className="flex items-start gap-3 p-4">
            <div className="flex-1 space-y-1">
              <p className="text-muted-foreground text-xs">
                {KIND_LABEL[v.kind] ?? v.kind} · {new Date(v.createdAt).toLocaleDateString()}
              </p>
              <p className="text-sm whitespace-pre-wrap">{v.body}</p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Delete voice example"
              disabled={del.isPending}
              onClick={() => del.mutate({ id: v.id })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
