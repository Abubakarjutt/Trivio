"use client";

import type { ReactNode } from "react";
import { trpc } from "@/lib/trpc/client";
import { SetupCard } from "./setup-card";

/** Every Outreach page shows the setup card until the organisation has OutreachSettings (spec §3 First run). */
export function OutreachGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = trpc.outreachSettings.get.useQuery();
  if (isLoading) return <div className="bg-muted h-40 animate-pulse rounded-xl" />;
  if (!data?.settings) return <SetupCard />;
  return <>{children}</>;
}
