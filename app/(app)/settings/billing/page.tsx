"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { trpc as api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Check, Zap } from "lucide-react";
import { toast } from "sonner";
// sonner is already installed as a shadcn/ui dependency
import { Suspense } from "react";

function BillingContent() {
  const searchParams = useSearchParams();
  const { data: status, isLoading } = api.subscription.getStatus.useQuery();
  const checkoutMutation = api.subscription.createCheckoutSession.useMutation();
  const portalMutation = api.subscription.createPortalSession.useMutation();

  useEffect(() => {
    if (searchParams.get("success") === "1") {
      toast.success("Subscription updated! Welcome to Pro.");
    }
  }, [searchParams]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const isPro = status?.tier === "PRO" || status?.tier === "BUSINESS";
  const extractionCount = status?.aiExtractionCount ?? 0;
  const extractionLimit = status?.aiExtractionLimit ?? 5;
  const pct = extractionLimit > 0 ? Math.min(100, Math.round((extractionCount / extractionLimit) * 100)) : 0;

  async function handleCheckout(plan: "pro_monthly" | "pro_annual") {
    try {
      const result = await checkoutMutation.mutateAsync({ plan });
      window.location.href = result.url;
    } catch {
      toast.error("Failed to open checkout. Make sure Stripe is configured.");
    }
  }

  async function handlePortal() {
    try {
      const result = await portalMutation.mutateAsync();
      window.location.href = result.url;
    } catch {
      toast.error("Failed to open billing portal. Make sure Stripe is configured.");
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Current plan */}
      <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Current Plan</h2>
          <span
            className={`text-xs font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded-full ${
              isPro ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {isPro ? "Pro" : "Free"}
          </span>
        </div>

        {!isPro && (
          <div>
            <p className="text-sm text-muted-foreground mb-3">
              AI extractions this month
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${pct >= 100 ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-sm font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                {extractionCount} / {extractionLimit}
              </span>
            </div>
          </div>
        )}

        {isPro && (
          <p className="text-sm text-muted-foreground">
            You have unlimited AI extractions and access to all Pro features.
          </p>
        )}
      </div>

      {/* Upgrade or manage */}
      {isPro ? (
        <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6">
          <h2 className="font-semibold mb-2">Manage Subscription</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Update your payment method, view invoices, or cancel your subscription.
          </p>
          <Button onClick={handlePortal} disabled={portalMutation.isPending}>
            {portalMutation.isPending ? "Opening…" : "Manage Billing"}
          </Button>
        </div>
      ) : (
        <div>
          <h2 className="font-semibold mb-4">Upgrade to Pro</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Pro Monthly */}
            <div className="rounded-2xl border border-border/40 bg-card shadow-card p-5 flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-primary" />
                <span className="font-semibold">Pro Monthly</span>
              </div>
              <p className="text-2xl font-bold mt-2">$29 <span className="text-sm font-normal text-muted-foreground">/ month</span></p>
              <ul className="mt-4 flex flex-col gap-1.5 text-sm text-muted-foreground flex-1">
                {["Unlimited AI extractions", "Up to 5 team members", "Priority support"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button className="mt-4" onClick={() => handleCheckout("pro_monthly")} disabled={checkoutMutation.isPending}>
                Upgrade Monthly
              </Button>
            </div>

            {/* Pro Annual */}
            <div className="rounded-2xl border border-primary/30 bg-primary/5 shadow-card p-5 flex flex-col relative">
              <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                Best Value
              </span>
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-primary" />
                <span className="font-semibold">Pro Annual</span>
              </div>
              <p className="text-2xl font-bold mt-2">$290 <span className="text-sm font-normal text-muted-foreground">/ year</span></p>
              <p className="text-xs text-primary font-medium mt-0.5">Save 2 months vs monthly</p>
              <ul className="mt-4 flex flex-col gap-1.5 text-sm text-muted-foreground flex-1">
                {["Everything in Pro Monthly", "2 months free", "Annual billing"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button className="mt-4" onClick={() => handleCheckout("pro_annual")} disabled={checkoutMutation.isPending}>
                Upgrade Annual
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <div className="flex flex-col min-h-full">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border/40 bg-background/95 backdrop-blur px-8 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Billing &amp; Subscription</h1>
          <p className="text-sm text-muted-foreground">Manage your plan</p>
        </div>
      </header>
      <main className="flex-1 px-8 py-8">
        <Suspense fallback={<div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />}>
          <BillingContent />
        </Suspense>
      </main>
    </div>
  );
}
