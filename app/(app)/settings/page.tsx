import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CreditCard, User, Building2, ChevronRight, Download, Globe, Send } from "lucide-react";
import { EmailImportCard } from "./_components/email-import-card";
import { PrivacyTab } from "./_components/privacy-tab";
import { JurisdictionPicker } from "./_components/jurisdiction-picker";
import { CurrencyPicker } from "./_components/currency-picker";
import { TaxRegimePicker } from "./_components/tax-regime-picker";
import { VoiceInputCard } from "./_components/voice-input-card";
import { BackupCard } from "./_components/backup-card";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { organisation: true },
  });

  if (!user?.organisationId) redirect("/onboarding");

  const emailImportToken = user.organisation?.emailImportToken ?? "";

  // Trivio is open-source — every account is on the free, fully-featured plan.
  const tierLabel = "Free";
  const tierColor = "bg-muted text-muted-foreground";

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <header className="border-border/40 sticky top-0 z-10 flex items-center justify-between gap-4 border-b px-8 py-4 backdrop-blur">
        <div>
          <h1 className="text-foreground font-serif text-2xl leading-tight font-medium">
            Settings
          </h1>
          <p className="text-muted-foreground text-xs">Manage your account and organisation</p>
        </div>
      </header>

      <main className="max-w-2xl flex-1 px-8 py-8">
        <div className="flex flex-col gap-4">
          {/* Profile */}
          <div className="border-border/40 bg-card shadow-card rounded-2xl border p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-lg">
                <User className="text-muted-foreground h-4 w-4" />
              </div>
              <h2 className="font-semibold">Profile</h2>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground mb-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
                  Name
                </dt>
                <dd className="text-foreground">{user.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
                  Email
                </dt>
                <dd className="text-foreground">{user.email}</dd>
              </div>
            </dl>
          </div>

          {/* Organisation */}
          <div className="border-border/40 bg-card shadow-card rounded-2xl border p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-lg">
                <Building2 className="text-muted-foreground h-4 w-4" />
              </div>
              <h2 className="font-semibold">Organisation</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground mb-0.5 text-[10px] font-bold tracking-[0.08em] uppercase">
                  Name
                </dt>
                <dd className="text-foreground">{user.organisation?.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-1.5 text-[10px] font-bold tracking-[0.08em] uppercase">
                  Currency
                </dt>
                <CurrencyPicker />
              </div>
              <div>
                <dt className="text-muted-foreground mb-1.5 text-[10px] font-bold tracking-[0.08em] uppercase">
                  Tax Regime
                </dt>
                <TaxRegimePicker />
              </div>
            </div>
          </div>

          {/* Tax Jurisdiction */}
          <div className="border-border/40 bg-card shadow-card rounded-2xl border p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-lg">
                <Globe className="text-muted-foreground h-4 w-4" />
              </div>
              <div>
                <h2 className="font-semibold">Tax Jurisdiction</h2>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Used to categorise transactions by the correct tax sections in the Tax Report.
                </p>
              </div>
            </div>
            <JurisdictionPicker />
          </div>

          {/* Billing */}
          <Link
            href="/settings/billing"
            className="border-border/40 bg-card shadow-card hover:bg-accent/30 group flex items-center gap-4 rounded-2xl border p-6 transition-colors"
          >
            <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-lg">
              <CreditCard className="text-muted-foreground h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Billing &amp; Subscription</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.06em] uppercase ${tierColor}`}
                >
                  {tierLabel}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-sm">Manage your plan and usage</p>
            </div>
            <ChevronRight className="text-muted-foreground group-hover:text-foreground h-4 w-4 transition-colors" />
          </Link>

          {/* Data Export */}
          <div className="border-border/40 bg-card shadow-card rounded-2xl border p-6">
            <div className="flex items-start gap-4">
              <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <Download className="text-muted-foreground h-4 w-4" />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold">Data Export</h2>
                <p className="text-muted-foreground mt-0.5 mb-4 text-sm">
                  Download all your data (invoices, bills, contacts, journal entries) as a ZIP of
                  CSV files.
                </p>
                <a
                  href="/api/export"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export all data
                </a>
              </div>
            </div>
          </div>

          {/* Voice input for the AI assistant */}
          <VoiceInputCard />
          {/* Encrypted backups to the user's Google Drive (desktop app) */}
          <BackupCard />

          {/* LinkedIn outreach assistant */}
          <Link
            href="/outreach/settings"
            className="border-border/40 bg-card shadow-card hover:bg-accent/30 group flex items-center gap-4 rounded-2xl border p-6 transition-colors"
          >
            <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-lg">
              <Send className="text-muted-foreground h-4 w-4" />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold">Outreach</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Seller profile, offers, signal weights and daily limits
              </p>
            </div>
            <ChevronRight className="text-muted-foreground group-hover:text-foreground h-4 w-4 transition-colors" />
          </Link>

          {/* Email Import */}
          {emailImportToken && <EmailImportCard initialToken={emailImportToken} />}

          {/* Privacy & Data (GDPR) */}
          <div className="border-border bg-card space-y-4 rounded-xl border p-6">
            <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
              Privacy & Data
            </h2>
            <PrivacyTab />
          </div>
        </div>
      </main>
    </div>
  );
}
