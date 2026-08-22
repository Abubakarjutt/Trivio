"use client";

import { trpc } from "@/lib/trpc/client";

const FEATURES = [
  "Unlimited AI statement extractions",
  "Unlimited transaction imports",
  "Budget & Goals tracking",
  "Full reports & CSV export",
];

export default function BillingPage() {
  const { data: org } = trpc.org.get.useQuery();

  if (!org) {
    return (
      <div className="flex flex-col min-h-full">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border/40 bg-background/95 backdrop-blur px-8 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Billing &amp; Subscription</h1>
            <p className="text-sm text-muted-foreground">Manage your plan</p>
          </div>
        </header>
        <main className="flex-1 px-8 py-8">
          <div className="text-sm text-muted-foreground">Loading...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border/40 bg-background/95 backdrop-blur px-8 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Billing &amp; Subscription</h1>
          <p className="text-sm text-muted-foreground">Manage your plan</p>
        </div>
      </header>

      <main className="flex-1 px-8 py-8 max-w-lg space-y-4">

        {/* Plan badge */}
        <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Current plan
            </p>
            <p className="text-lg font-semibold">Free — Open Source</p>
            <p className="text-xs text-muted-foreground mt-1">
              Trivio is open source. Every feature below is free, no account limits.
            </p>
          </div>
          <span
            className="px-3 py-1 rounded-full text-xs font-bold"
            style={{ background: "#EBF5F0", color: "#1A6644" }}
          >
            FREE
          </span>
        </div>

        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Included, unlimited
          </p>
          <ul className="space-y-1.5">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="text-green-600">✓</span> {f}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
