"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAiReady } from "./ai-notice";
import { CopyButton } from "./copy-button";
import { Textarea } from "./textarea";
import type { ProspectDetail } from "./types";

export function ProposalPanel({ data }: { data: ProspectDetail }) {
  const id = data.prospect.id;
  const utils = trpc.useUtils();
  const settings = trpc.outreachSettings.get.useQuery();
  const offers = (settings.data?.offers ?? []).filter((o) => !o.archived);
  const teardownOffer = (data.docs.teardown as { offerId?: string | null } | null)?.offerId ?? null;
  const saved = data.docs.proposal as { offerId: string; offerName: string; text: string } | null;
  const [picked, setPicked] = useState<string | null>(saved?.offerId ?? teardownOffer);
  const [notes, setNotes] = useState("");
  const aiReady = useAiReady();
  const run = trpc.outreachDocs.proposal.useMutation({
    onSuccess: () => {
      void utils.outreachProspects.get.invalidate({ id });
    },
  });
  // A remembered offer may have been archived since; fall back to the first active one.
  const offerId = offers.find((o) => o.id === picked)?.id ?? offers[0]?.id ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pilot proposal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.isError ? (
          <div className="space-y-2">
            <p className="text-destructive text-sm">Couldn&apos;t load your offers.</p>
            <Button size="sm" variant="outline" onClick={() => settings.refetch()}>
              Retry
            </Button>
          </div>
        ) : settings.isLoading ? (
          <div className="bg-muted h-20 animate-pulse rounded-lg" />
        ) : offers.length === 0 || !offerId ? (
          <p className="text-muted-foreground text-sm">
            Add an offer in{" "}
            <Link href="/outreach/settings" className="underline">
              Outreach settings
            </Link>{" "}
            first.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Offer</Label>
              <Select value={offerId} onValueChange={setPicked}>
                <SelectTrigger className="w-full sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {offers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                      {o.price ? "" : " (no price yet)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="call-notes">What you learned on the call</Label>
              <Textarea
                id="call-notes"
                maxLength={20_000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {run.error && <p className="text-destructive text-sm">{run.error.message}</p>}
            <Button
              size="sm"
              variant="outline"
              disabled={!aiReady || run.isPending}
              onClick={() => run.mutate({ id, offerId, callNotes: notes })}
            >
              {run.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="mr-1 h-3.5 w-3.5" />
              )}
              {run.isPending ? "Drafting…" : saved ? "Draft again" : "Draft proposal"}
            </Button>
          </>
        )}
        {saved && (
          <div className="border-border/60 space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">{saved.offerName}</span>
              <CopyButton text={saved.text} />
            </div>
            <p className="text-sm whitespace-pre-wrap">{saved.text}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
