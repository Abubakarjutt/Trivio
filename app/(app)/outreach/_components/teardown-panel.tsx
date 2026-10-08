"use client";

import { Loader2, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeardownPrep } from "@/server/services/outreach/schemas";
import type { ProspectDetail } from "./types";

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ol>
    </div>
  );
}

export function TeardownPanel({ data }: { data: ProspectDetail }) {
  const id = data.prospect.id;
  const utils = trpc.useUtils();
  const prep = data.docs.teardown as (TeardownPrep & { offerId: string | null }) | null;
  const run = trpc.outreachDocs.teardown.useMutation({
    onSuccess: () => utils.outreachProspects.get.invalidate({ id }),
  });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Teardown prep</CardTitle>
        <Button
          size="sm"
          variant="outline"
          disabled={run.isPending}
          onClick={() => run.mutate({ id })}
        >
          {run.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wrench className="mr-1 h-3.5 w-3.5" />
          )}
          {run.isPending ? "Preparing…" : prep ? "Prepare again" : "Prepare"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {run.error && <p className="text-destructive text-sm">{run.error.message}</p>}
        {!prep ? (
          <p className="text-muted-foreground text-sm">
            Prepare notes for the 15-minute teardown call.
          </p>
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap">
              <span className="font-semibold">Likely setup: </span>
              {prep.likelySetup}
            </p>
            <List title="Where it probably fails" items={prep.failurePoints} />
            <List title="Questions to ask" items={prep.questions} />
            <List title="Quick wins" items={prep.quickWins} />
            <p className="text-sm">
              <span className="font-semibold">Offer to suggest: </span>
              {prep.offer}
              {!prep.offerId && <span className="text-amber-700"> (not one of your offers)</span>}
              <span className="text-muted-foreground block">{prep.offerReason}</span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
