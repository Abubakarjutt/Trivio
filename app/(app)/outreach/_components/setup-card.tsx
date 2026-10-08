"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_CADENCE,
  DEFAULT_HIRING_KEYWORDS,
  DEFAULT_WEIGHTS,
} from "@/server/services/outreach/types";
import { Textarea } from "./textarea";

/** First run: no OutreachSettings yet. Saves the seller profile and one offer, then opens Today. */
export function SetupCard() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [profile, setProfile] = useState("");
  const [offer, setOffer] = useState({ name: "", description: "", price: "" });
  const [error, setError] = useState<string | null>(null);
  const upsert = trpc.outreachSettings.upsert.useMutation();
  const createOffer = trpc.outreachSettings.offerCreate.useMutation();
  const busy = upsert.isPending || createOffer.isPending;

  async function save() {
    setError(null);
    try {
      await upsert.mutateAsync({
        sellerProfile: profile,
        signalWeights: DEFAULT_WEIGHTS,
        cadence: DEFAULT_CADENCE,
        dailyCap: 20,
        weeklyCap: 100,
        hiringKeywords: DEFAULT_HIRING_KEYWORDS,
      });
      if (offer.name.trim()) await createOffer.mutateAsync({ ...offer, fittingSignals: [] });
      await Promise.all([
        utils.outreachSettings.get.invalidate(),
        utils.outreachToday.get.invalidate(),
      ]);
      router.push("/outreach");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Set up Outreach</CardTitle>
        <CardDescription>
          Describe what you sell and add one offer. Drafts, scoring and proposals all start from
          this. Trivio never sends anything on LinkedIn: you copy each message and send it yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="seller">What you sell (Markdown)</Label>
          <Textarea
            id="seller"
            className="min-h-[200px] font-mono text-xs"
            maxLength={50_000}
            value={profile}
            placeholder={"# Who I am\n…\n\n# Offer\n…\n\n# Voice\n…"}
            onChange={(e) => setProfile(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="offer-name">First offer</Label>
            <Input
              id="offer-name"
              value={offer.name}
              placeholder="RAG Audit + Eval Harness"
              onChange={(e) => setOffer((o) => ({ ...o, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="offer-price">Price (optional)</Label>
            <Input
              id="offer-price"
              inputMode="decimal"
              value={offer.price}
              placeholder="4000"
              onChange={(e) => setOffer((o) => ({ ...o, price: e.target.value.trim() }))}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offer-desc">Offer description</Label>
          <Input
            id="offer-desc"
            value={offer.description}
            onChange={(e) => setOffer((o) => ({ ...o, description: e.target.value }))}
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button onClick={save} disabled={busy || !profile.trim()}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save and open Today
        </Button>
      </CardContent>
    </Card>
  );
}
