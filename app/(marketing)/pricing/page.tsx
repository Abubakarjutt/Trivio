import Link from "next/link";
import { Check } from "lucide-react";

const features = [
  "Unlimited AI document extractions",
  "Unlimited transactions",
  "Unlimited invoices & bills",
  "Unlimited contacts",
  "Bank reconciliation",
  "Budgets & goals tracking",
  "Financial reports & CSV export",
  "Unlimited team members",
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[hsl(38,30%,97%)]">
      {/* Hero */}
      <div className="bg-[hsl(222,35%,8%)] px-6 py-20 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-white/40 mb-3">Pricing</p>
        <h1 className="text-4xl font-bold text-white">Free, forever — it&apos;s open source</h1>
        <p className="mt-4 text-lg text-white/60 max-w-xl mx-auto">
          Trivio is open source. Every feature is free, with no account limits.
        </p>
      </div>

      {/* Card */}
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="rounded-2xl border border-border/40 bg-white shadow-card p-8 flex flex-col">
          <p className="text-sm font-semibold text-muted-foreground">Free — Open Source</p>
          <div className="mt-2 flex items-end gap-1">
            <span className="text-4xl font-bold">$0</span>
            <span className="text-sm pb-1 text-muted-foreground">forever</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Everything, unlimited, for everyone.</p>

          <ul className="mt-6 flex flex-col gap-2.5 flex-1">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/register"
            className="mt-6 flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-[hsl(222,35%,8%)] text-white hover:bg-[hsl(222,35%,14%)]"
          >
            Get Started
          </Link>
        </div>
      </div>
    </div>
  );
}
