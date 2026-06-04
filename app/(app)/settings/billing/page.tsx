"use client";

import { trpc } from "@/lib/trpc/client";
import { buildCheckoutUrl } from "@/lib/lemonsqueezy";
import { useSession } from "next-auth/react";

const FREE_AI_LIMIT = 2;
const FREE_TX_LIMIT = 50;

const FEATURES = [
  "Unlimited AI statement extractions",
  "Unlimited transaction imports",
  "Budget & Goals tracking",
  "Full reports & CSV export",
];

export default function BillingPage() {
  const { data: session } = useSession();
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

  const isPro = org.plan === "PRO";
  const checkoutUrl =
    session?.user?.email && org.id
      ? buildCheckoutUrl(session.user.email, org.id)
      : "#";

  const aiUsed = org.aiExtractionsUsed ?? 0;
  const txUsed = org.transactionsUsed ?? 0;

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
            <p className="text-lg font-semibold">{isPro ? "Pro" : "Free"}</p>
            {isPro && org.lsSubscriptionStatus === "cancelled" && (
              <p className="text-xs text-amber-600 mt-1">
                Cancelled — access until end of billing period
              </p>
            )}
          </div>
          <span
            className="px-3 py-1 rounded-full text-xs font-bold"
            style={{
              background: isPro ? "#EBF5F0" : "hsl(var(--muted))",
              color: isPro ? "#1A6644" : "hsl(var(--muted-foreground))",
            }}
          >
            {isPro ? "PRO" : "FREE"}
          </span>
        </div>

        {/* Usage stats — Free only */}
        {!isPro && (
          <div className="rounded-xl border border-border/40 bg-card p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              This month&apos;s usage
            </p>

            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">AI statement extractions</span>
                <span className="font-semibold">{aiUsed} / {FREE_AI_LIMIT}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min((aiUsed / FREE_AI_LIMIT) * 100, 100)}%`,
                    background: aiUsed >= FREE_AI_LIMIT ? "#EF4444" : "#1A6644",
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Transactions imported</span>
                <span className="font-semibold">{txUsed} / {FREE_TX_LIMIT}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min((txUsed / FREE_TX_LIMIT) * 100, 100)}%`,
                    background: txUsed >= FREE_TX_LIMIT ? "#EF4444" : "#1A6644",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* CTA */}
        {isPro ? (
          <a
            href="https://app.lemonsqueezy.com/my-orders"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-full h-11 rounded-xl text-sm font-semibold border border-border/40 text-foreground hover:border-border transition-colors"
          >
            Manage subscription →
          </a>
        ) : (
          <div className="space-y-3">
            <a
              href={checkoutUrl}
              className="inline-flex items-center justify-center w-full h-11 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "#1A6644" }}
            >
              Upgrade to Pro — $9/month
            </a>
            <ul className="space-y-1.5">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-green-600">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
