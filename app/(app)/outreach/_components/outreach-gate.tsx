"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { SetupCard } from "./setup-card";

/** Every Outreach page shows the setup card until the organisation has OutreachSettings (spec §3 First run). */
export function OutreachGate({ children }: { children: ReactNode }) {
  const { data, isLoading, isError, refetch } = trpc.outreachSettings.get.useQuery();
  if (isLoading) return <div className="bg-muted h-40 animate-pulse rounded-xl" />;
  // Never show SetupCard on a failed load: saving it would overwrite the real settings with defaults.
  if (isError) {
    return (
      <div className="border-border/60 space-y-3 rounded-xl border p-4">
        <p className="text-destructive text-sm">Couldn&apos;t load your Outreach settings.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!data?.settings) return <SetupCard />;
  return <>{children}</>;
}
