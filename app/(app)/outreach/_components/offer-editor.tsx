"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRICE,
  PRICE_MESSAGE,
  SIGNAL_NAMES,
  type SignalName,
} from "@/server/services/outreach/types";
import { SIGNAL_LABEL } from "./labels";
import type { Outputs } from "./types";

type Offer = Outputs["outreachSettings"]["get"]["offers"][number];

export function OfferEditor({ offer, onDone }: { offer?: Offer; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: offer?.name ?? "",
    description: offer?.description ?? "",
    // Price stays a string end to end; empty means "no price yet".
    price: offer?.price ?? "",
    fittingSignals: (offer?.fittingSignals ?? []) as SignalName[],
  });
  const done = () => {
    void utils.outreachSettings.get.invalidate();
    onDone();
  };
  const create = trpc.outreachSettings.offerCreate.useMutation({ onSuccess: done });
  const update = trpc.outreachSettings.offerUpdate.useMutation({ onSuccess: done });
  const busy = create.isPending || update.isPending;
  const [priceError, setPriceError] = useState<string | null>(null);
  const serverError = create.error ?? update.error;
  // Zod failures arrive as a JSON string in `message`: never show that raw.
  const fieldPrice = serverError?.data?.zodError?.fieldErrors?.price?.[0];
  const serverMessage = serverError?.message.startsWith("[")
    ? (fieldPrice ?? "Couldn't save the offer.")
    : (fieldPrice ?? serverError?.message);
  const error = priceError ?? serverMessage;
  const submit = () => {
    if (form.price !== "" && !PRICE.test(form.price)) {
      setPriceError(PRICE_MESSAGE);
      return;
    }
    setPriceError(null);
    if (offer) update.mutate({ id: offer.id, ...form });
    else create.mutate(form);
  };
  const toggle = (s: SignalName) =>
    setForm((f) => ({
      ...f,
      fittingSignals: f.fittingSignals.includes(s)
        ? f.fittingSignals.filter((x) => x !== s)
        : [...f.fittingSignals, s],
    }));

  return (
    <div className="border-border/60 space-y-3 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={form.name}
            maxLength={120}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Price</Label>
          <Input
            inputMode="decimal"
            placeholder="Leave empty for [price]"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value.trim() }))}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Input
          value={form.description}
          maxLength={2000}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Fits prospects with</Label>
        <div className="flex flex-wrap gap-3">
          {SIGNAL_NAMES.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.fittingSignals.includes(s)}
                onChange={() => toggle(s)}
              />
              {SIGNAL_LABEL[s]}
            </label>
          ))}
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !form.name.trim()} onClick={submit}>
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {offer ? "Save offer" : "Add offer"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
