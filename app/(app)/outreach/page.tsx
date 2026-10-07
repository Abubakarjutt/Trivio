"use client";

import Link from "next/link";
import { Plus, Settings } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AiNotice } from "./_components/ai-notice";
import { OutreachGate } from "./_components/outreach-gate";
import { TodayCard } from "./_components/today-card";

export default function OutreachTodayPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Today"
        description="Work top to bottom. Copy a draft, send it from Sales Navigator, then mark it done."
        action={
          <div className="flex gap-2">
            <Button size="sm" asChild>
              <Link href="/outreach/prospects/new">
                <Plus className="mr-1 h-4 w-4" /> Add prospect
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild aria-label="Outreach settings">
              <Link href="/outreach/settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        }
      />
      <OutreachGate>
        <TodayBody />
      </OutreachGate>
    </div>
  );
}

function TodayBody() {
  const { data, isLoading, isError, refetch } = trpc.outreachToday.get.useQuery();
  if (isError) {
    return (
      <div className="border-border/60 space-y-3 rounded-xl border p-4">
        <p className="text-destructive text-sm">Couldn&apos;t load today&apos;s list.</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="bg-muted h-16 animate-pulse rounded-xl" />
        <div className="bg-muted h-48 animate-pulse rounded-xl" />
        <div className="bg-muted h-48 animate-pulse rounded-xl" />
      </div>
    );
  }
  if (!data.configured) return null; // OutreachGate shows the setup card

  const { caps, buckets } = data;
  const full = buckets.filter((b) => b.items.length > 0);
  const idle = buckets.filter((b) => b.items.length === 0).map((b) => b.title);

  return (
    <div className="space-y-6">
      <AiNotice />
      <div className="border-border/60 space-y-2 rounded-xl border p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Connection requests</span>
          <span className="text-muted-foreground tabular-nums">
            {caps.today}/{caps.dailyCap} today · {caps.week}/{caps.weeklyCap} this week
          </span>
        </div>
        <Progress
          value={caps.dailyCap ? Math.min(100, (caps.today / caps.dailyCap) * 100) : 0}
          aria-label="Requests sent today"
        />
      </div>

      {full.length === 0 ? (
        <div className="border-border space-y-3 rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">Nothing is due.</p>
          <p className="text-muted-foreground text-sm">
            Find someone in Sales Navigator and add them to start a new thread.
          </p>
          <Button size="sm" asChild>
            <Link href="/outreach/prospects/new">Add prospect</Link>
          </Button>
        </div>
      ) : (
        full.map((b) => (
          <section key={b.title} className="space-y-3">
            <h2 className="text-muted-foreground text-sm font-semibold">
              {b.title} <span className="tabular-nums">({b.items.length})</span>
            </h2>
            {b.items.map((item) => (
              <TodayCard key={`${item.prospect.id}-${item.action.kind}`} item={item} />
            ))}
          </section>
        ))
      )}
      {full.length > 0 && idle.length > 0 && (
        <p className="text-muted-foreground text-xs">Nothing in {idle.join(" · ")}</p>
      )}
    </div>
  );
}
