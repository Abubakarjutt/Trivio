import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CreditCard, User, Building2, ChevronRight, Download, Globe } from "lucide-react";
import { EmailImportCard } from "./_components/email-import-card";
import { PrivacyTab } from "./_components/privacy-tab";
import { JurisdictionPicker } from "./_components/jurisdiction-picker";
import { CurrencyPicker } from "./_components/currency-picker";
import { TaxRegimePicker } from "./_components/tax-regime-picker";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { organisation: true },
  });

  if (!user?.organisationId) redirect("/onboarding");

  const emailImportToken = user.organisation?.emailImportToken ?? "";

  const tierLabel = user.organisation?.subscriptionTier === "PRO" ? "Pro" : "Free";
  const tierColor = user.organisation?.subscriptionTier === "PRO"
    ? "bg-primary/10 text-primary"
    : "bg-muted text-muted-foreground";

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border/40 backdrop-blur px-8 py-4">
        <div>
          <h1 className="font-serif text-2xl font-medium text-foreground leading-tight">Settings</h1>
          <p className="text-xs text-muted-foreground">Manage your account and organisation</p>
        </div>
      </header>

      <main className="flex-1 px-8 py-8 max-w-2xl">
        <div className="flex flex-col gap-4">
          {/* Profile */}
          <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="font-semibold">Profile</h2>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-0.5">Name</dt>
                <dd className="text-foreground">{user.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-0.5">Email</dt>
                <dd className="text-foreground">{user.email}</dd>
              </div>
            </dl>
          </div>

          {/* Organisation */}
          <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="font-semibold">Organisation</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 text-sm">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-0.5">Name</dt>
                <dd className="text-foreground">{user.organisation?.name}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-1.5">Currency</dt>
                <CurrencyPicker />
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-1.5">Tax Regime</dt>
                <TaxRegimePicker />
              </div>
            </div>
          </div>

          {/* Tax Jurisdiction */}
          <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                <Globe className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <h2 className="font-semibold">Tax Jurisdiction</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Used to categorise transactions by the correct tax sections in the Tax Report.</p>
              </div>
            </div>
            <JurisdictionPicker />
          </div>

          {/* Billing */}
          <Link
            href="/settings/billing"
            className="rounded-2xl border border-border/40 bg-card shadow-card p-6 flex items-center gap-4 hover:bg-accent/30 transition-colors group"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Billing &amp; Subscription</h2>
                <span className={`text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full ${tierColor}`}>
                  {tierLabel}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">Manage your plan and usage</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </Link>

          {/* Data Export */}
          <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Download className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold">Data Export</h2>
                <p className="text-sm text-muted-foreground mt-0.5 mb-4">
                  Download all your data (invoices, bills, contacts, journal entries) as a ZIP of CSV files.
                </p>
                <a
                  href="/api/export"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export all data
                </a>
              </div>
            </div>
          </div>

          {/* Email Import */}
          {emailImportToken && (
            <EmailImportCard initialToken={emailImportToken} />
          )}

          {/* Privacy & Data (GDPR) */}
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Privacy & Data
            </h2>
            <PrivacyTab />
          </div>
        </div>
      </main>
    </div>
  );
}
