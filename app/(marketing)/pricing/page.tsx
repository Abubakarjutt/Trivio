import Link from "next/link";
import { Check } from "lucide-react";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Perfect for getting started",
    cta: "Get Started",
    ctaHref: "/register",
    ctaVariant: "outline" as const,
    highlighted: false,
    features: [
      "3 AI extractions / month",
      "Unlimited transactions",
      "Unlimited invoices & bills",
      "Unlimited contacts",
      "Bank reconciliation",
      "Financial reports",
      "1 user",
    ],
  },
  {
    name: "Pro Monthly",
    price: "$15",
    period: "per month",
    description: "For growing businesses",
    cta: "Upgrade Now",
    ctaHref: "/settings/billing",
    ctaVariant: "primary" as const,
    highlighted: true,
    badge: "Most Popular",
    features: [
      "Unlimited AI extractions",
      "Unlimited invoices & bills",
      "Unlimited contacts",
      "Bank reconciliation",
      "Financial reports",
      "Up to 5 team members",
      "Priority support",
    ],
  },
  {
    name: "Pro Annual",
    price: "$150",
    period: "per year",
    description: "Save 2 months vs monthly",
    cta: "Upgrade Now",
    ctaHref: "/settings/billing",
    ctaVariant: "outline" as const,
    highlighted: false,
    badge: "Best Value",
    features: [
      "Everything in Pro Monthly",
      "2 months free",
      "Unlimited AI extractions",
      "Up to 5 team members",
      "Priority support",
      "Annual billing",
    ],
  },
];

const comparisonFeatures = [
  { feature: "AI document extractions", free: "3 / month", pro: "Unlimited" },
  { feature: "Transactions", free: "Unlimited", pro: "Unlimited" },
  { feature: "Invoices & bills", free: "Unlimited", pro: "Unlimited" },
  { feature: "Contacts", free: "Unlimited", pro: "Unlimited" },
  { feature: "Bank reconciliation", free: "✓", pro: "✓" },
  { feature: "Financial reports", free: "✓", pro: "✓" },
  { feature: "PDF export", free: "✓", pro: "✓" },
  { feature: "Team members", free: "1", pro: "Up to 5" },
  { feature: "Priority support", free: "—", pro: "✓" },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[hsl(38,30%,97%)]">
      {/* Hero */}
      <div className="bg-[hsl(222,35%,8%)] px-6 py-20 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-white/40 mb-3">Pricing</p>
        <h1 className="text-4xl font-bold text-white">Simple, transparent pricing</h1>
        <p className="mt-4 text-lg text-white/60 max-w-xl mx-auto">
          Start free, upgrade when you&apos;re ready. No hidden fees.
        </p>
      </div>

      {/* Cards */}
      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-6 flex flex-col ${
                plan.highlighted
                  ? "bg-[hsl(222,35%,8%)] border-[hsl(222,35%,20%)] text-white shadow-xl scale-[1.03]"
                  : "bg-white border-border/40 shadow-card"
              }`}
            >
              {plan.badge && (
                <span
                  className={`self-start text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1 rounded-full mb-4 ${
                    plan.highlighted ? "bg-white/10 text-white" : "bg-primary/10 text-primary"
                  }`}
                >
                  {plan.badge}
                </span>
              )}
              <p className={`text-sm font-semibold ${plan.highlighted ? "text-white/60" : "text-muted-foreground"}`}>
                {plan.name}
              </p>
              <div className="mt-2 flex items-end gap-1">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className={`text-sm pb-1 ${plan.highlighted ? "text-white/50" : "text-muted-foreground"}`}>
                  {plan.period}
                </span>
              </div>
              <p className={`mt-2 text-sm ${plan.highlighted ? "text-white/60" : "text-muted-foreground"}`}>
                {plan.description}
              </p>

              <ul className="mt-6 flex flex-col gap-2.5 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check
                      className={`h-4 w-4 mt-0.5 shrink-0 ${plan.highlighted ? "text-white/70" : "text-primary"}`}
                    />
                    <span className={plan.highlighted ? "text-white/80" : ""}>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.ctaHref}
                className={`mt-6 flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                  plan.highlighted
                    ? "bg-white text-[hsl(222,35%,8%)] hover:bg-white/90"
                    : "bg-[hsl(222,35%,8%)] text-white hover:bg-[hsl(222,35%,14%)]"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        <div className="mt-20">
          <h2 className="text-2xl font-bold text-center mb-8">Feature comparison</h2>
          <div className="rounded-2xl border border-border/40 bg-white shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  <th className="text-left px-6 py-3 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    Feature
                  </th>
                  <th className="text-center px-6 py-3 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    Free
                  </th>
                  <th className="text-center px-6 py-3 text-[10px] font-bold uppercase tracking-[0.08em] text-primary">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonFeatures.map((row, i) => (
                  <tr key={row.feature} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                    <td className="px-6 py-3 text-foreground">{row.feature}</td>
                    <td className="px-6 py-3 text-center text-muted-foreground">{row.free}</td>
                    <td className="px-6 py-3 text-center font-medium text-primary">{row.pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
