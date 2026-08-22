import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  BarChart3,
  FileText,
  Zap,
  Shield,
  ArrowRight,
  Check,
  Receipt,
  Users,
  RefreshCw,
  Upload,
  Bot,
  MousePointerClick,
  Star,
} from "lucide-react";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen" style={{ background: "hsl(38 30% 97%)" }}>
      {/* ── Navbar ─────────────────────────────────────────────── */}
      <nav
        className="fixed inset-x-0 top-0 z-50 border-b"
        style={{
          background: "hsl(222 35% 8% / 0.92)",
          borderColor: "hsl(222 35% 15%)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                background: "hsl(221 78% 38% / 0.2)",
                boxShadow: "0 0 0 1px hsl(221 78% 38% / 0.3)",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 3h12M2 8h8M2 13h5"
                  stroke="hsl(221 78% 70%)"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="11" r="3" stroke="hsl(221 78% 70%)" strokeWidth="1.5" />
                <path
                  d="M12 9.5v1.5l.75.75"
                  stroke="hsl(221 78% 70%)"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span
              className="text-sm font-semibold tracking-wide"
              style={{ color: "hsl(220 20% 92%)" }}
            >
              Trivio
            </span>
          </div>

          <div className="hidden items-center gap-7 md:flex">
            {[
              { label: "Features", href: "#features" },
              { label: "How it works", href: "#how-it-works" },
              { label: "Pricing", href: "/pricing" },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="text-sm transition-colors hover:text-white"
                style={{ color: "hsl(220 20% 55%)" }}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium"
              style={{ color: "hsl(220 20% 55%)" }}
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all hover:opacity-90"
              style={{
                background: "hsl(221 78% 38%)",
                color: "#fff",
                boxShadow: "0 0 0 1px hsl(221 78% 30%)",
              }}
            >
              Get started free
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-14" style={{ background: "hsl(222 35% 8%)" }}>
        {/* Grid overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(hsl(220 20% 80% / 0.04) 1px, transparent 1px), linear-gradient(90deg, hsl(220 20% 80% / 0.04) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        {/* Ambient glows */}
        <div
          className="pointer-events-none absolute -top-32 -left-32 h-[500px] w-[500px] rounded-full blur-3xl"
          style={{ background: "hsl(221 78% 38% / 0.13)" }}
        />
        <div
          className="pointer-events-none absolute top-1/3 right-0 h-80 w-80 rounded-full blur-3xl"
          style={{ background: "hsl(262 78% 58% / 0.06)" }}
        />
        <div
          className="pointer-events-none absolute bottom-16 left-1/2 h-56 w-[700px] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: "hsl(221 78% 38% / 0.07)" }}
        />

        <div className="relative mx-auto max-w-5xl px-6 pt-28 pb-20 text-center">
          {/* Badge */}
          <div
            className="hero-animate hero-animate-1 mb-8 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide"
            style={{
              background: "hsl(221 78% 38% / 0.12)",
              color: "hsl(221 78% 72%)",
              boxShadow: "0 0 0 1px hsl(221 78% 38% / 0.25)",
            }}
          >
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: "hsl(221 78% 62%)" }}
            />
            Now with AI document extraction
          </div>

          {/* Headline */}
          <h1
            className="hero-animate hero-animate-2 font-serif leading-[1.04] tracking-tight"
            style={{ color: "hsl(220 20% 96%)", fontSize: "clamp(2.75rem, 7vw, 5.5rem)" }}
          >
            Accounting that actually
            <br />
            <span style={{ color: "hsl(221 78% 62%)" }}>makes sense.</span>
          </h1>

          <p
            className="hero-animate hero-animate-3 mx-auto mt-6 max-w-2xl text-lg leading-relaxed md:text-xl"
            style={{ color: "hsl(220 20% 48%)" }}
          >
            Double-entry bookkeeping, AI-powered receipt scanning, invoicing, and financial reports
            — built for freelancers and small businesses, not accountants.
          </p>

          <div className="hero-animate hero-animate-4 mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                background: "hsl(221 78% 38%)",
                color: "#fff",
                boxShadow: "0 4px 24px hsl(221 78% 38% / 0.4), 0 0 0 1px hsl(221 78% 30%)",
              }}
            >
              Start free — no credit card
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-medium transition-all hover:border-white/20"
              style={{
                color: "hsl(220 20% 58%)",
                boxShadow: "0 0 0 1px hsl(222 35% 22%)",
              }}
            >
              View pricing
            </Link>
          </div>

          <p
            className="hero-animate hero-animate-5 mt-8 text-xs"
            style={{ color: "hsl(220 20% 32%)" }}
          >
            Trusted by 2,400+ freelancers and small businesses
          </p>
        </div>

        {/* Dashboard preview + floating toasts */}
        <div className="relative mx-auto max-w-5xl px-6 pb-0">
          {/* Floating toast — top left */}
          <div
            className="toast-in toast-in-1 absolute top-8 -left-2 z-10 hidden items-center gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg lg:flex"
            style={{
              background: "hsl(222 35% 11%)",
              borderColor: "hsl(222 35% 20%)",
              boxShadow: "0 8px 24px hsl(0 0% 0% / 0.4), 0 0 0 1px hsl(222 35% 20%)",
            }}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "hsl(142 60% 45% / 0.15)" }}
            >
              <Check className="h-3.5 w-3.5" style={{ color: "hsl(142 60% 52%)" }} />
            </div>
            <div>
              <p className="text-[11px] font-semibold" style={{ color: "hsl(220 20% 88%)" }}>
                Invoice #42 paid
              </p>
              <p className="text-[10px]" style={{ color: "hsl(220 15% 45%)" }}>
                +$3,200 · Business Chequing
              </p>
            </div>
          </div>

          {/* Floating toast — top right */}
          <div
            className="toast-in toast-in-2 absolute top-6 -right-2 z-10 hidden items-center gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg lg:flex"
            style={{
              background: "hsl(222 35% 11%)",
              borderColor: "hsl(222 35% 20%)",
              boxShadow: "0 8px 24px hsl(0 0% 0% / 0.4), 0 0 0 1px hsl(222 35% 20%)",
            }}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "hsl(221 78% 38% / 0.15)" }}
            >
              <Zap className="h-3.5 w-3.5" style={{ color: "hsl(221 78% 65%)" }} />
            </div>
            <div>
              <p className="text-[11px] font-semibold" style={{ color: "hsl(220 20% 88%)" }}>
                AI extracted 5 receipts
              </p>
              <p className="text-[10px]" style={{ color: "hsl(220 15% 45%)" }}>
                Processed in 2.1s · awaiting review
              </p>
            </div>
          </div>

          {/* Floating toast — bottom right */}
          <div
            className="toast-in toast-in-3 absolute -right-4 bottom-20 z-10 hidden items-center gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg lg:flex"
            style={{
              background: "hsl(222 35% 11%)",
              borderColor: "hsl(222 35% 20%)",
              boxShadow: "0 8px 24px hsl(0 0% 0% / 0.4), 0 0 0 1px hsl(222 35% 20%)",
            }}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "hsl(142 60% 45% / 0.15)" }}
            >
              <RefreshCw className="h-3.5 w-3.5" style={{ color: "hsl(142 60% 52%)" }} />
            </div>
            <div>
              <p className="text-[11px] font-semibold" style={{ color: "hsl(220 20% 88%)" }}>
                Bank reconciled
              </p>
              <p className="text-[10px]" style={{ color: "hsl(220 15% 45%)" }}>
                0 discrepancies · books balanced
              </p>
            </div>
          </div>

          {/* Dashboard card */}
          <div
            className="hero-animate hero-animate-6 overflow-hidden rounded-t-2xl border-x border-t"
            style={{
              borderColor: "hsl(222 35% 18%)",
              background: "hsl(222 35% 6%)",
              boxShadow: "0 -8px 40px hsl(221 78% 38% / 0.06)",
            }}
          >
            {/* Browser chrome */}
            <div
              className="flex items-center gap-2 border-b px-4 py-3"
              style={{ borderColor: "hsl(222 35% 13%)" }}
            >
              <div className="flex gap-1.5">
                {["hsl(0 70% 60%)", "hsl(38 80% 60%)", "hsl(142 60% 52%)"].map((c, i) => (
                  <div
                    key={i}
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: c, opacity: 0.65 }}
                  />
                ))}
              </div>
              <div
                className="mx-4 flex h-6 flex-1 items-center rounded-md px-3"
                style={{ background: "hsl(222 35% 10%)" }}
              >
                <span className="font-mono text-[10px]" style={{ color: "hsl(220 15% 38%)" }}>
                  app.trivio-ai.com/dashboard
                </span>
              </div>
            </div>

            {/* Dashboard content */}
            <div className="space-y-3 p-4">
              {/* Stat cards */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  {
                    label: "Revenue",
                    value: "$48,290",
                    delta: "+12.4%",
                    color: "hsl(142 60% 45%)",
                  },
                  {
                    label: "Outstanding",
                    value: "$8,640",
                    delta: "3 invoices",
                    color: "hsl(38 80% 55%)",
                  },
                  {
                    label: "Expenses",
                    value: "$12,180",
                    delta: "this month",
                    color: "hsl(0 65% 55%)",
                  },
                  {
                    label: "Net Profit",
                    value: "$36,110",
                    delta: "+8.2%",
                    color: "hsl(221 78% 62%)",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl p-3"
                    style={{
                      background: "hsl(222 35% 10%)",
                      boxShadow: "0 0 0 1px hsl(222 35% 15%)",
                    }}
                  >
                    <p
                      className="mb-1 font-mono text-[9px] font-medium tracking-wide uppercase"
                      style={{ color: "hsl(220 15% 42%)" }}
                    >
                      {stat.label}
                    </p>
                    <p
                      className="font-mono text-[15px] font-bold tracking-tight"
                      style={{ color: "hsl(220 20% 90%)" }}
                    >
                      {stat.value}
                    </p>
                    <p
                      className="mt-0.5 font-mono text-[9px] font-semibold"
                      style={{ color: stat.color }}
                    >
                      {stat.delta}
                    </p>
                  </div>
                ))}
              </div>

              {/* Chart + transactions */}
              <div className="grid grid-cols-3 gap-2">
                <div
                  className="col-span-2 rounded-xl p-3"
                  style={{
                    background: "hsl(222 35% 10%)",
                    boxShadow: "0 0 0 1px hsl(222 35% 15%)",
                  }}
                >
                  <p
                    className="mb-2 font-mono text-[9px] font-medium tracking-wide uppercase"
                    style={{ color: "hsl(220 15% 42%)" }}
                  >
                    Revenue — last 6 months
                  </p>
                  <svg viewBox="0 0 280 56" className="h-11 w-full">
                    <defs>
                      <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(221 78% 62%)" stopOpacity="0.22" />
                        <stop offset="100%" stopColor="hsl(221 78% 62%)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0 44 L47 37 L93 41 L140 24 L187 16 L233 20 L280 6"
                      stroke="hsl(221 78% 62%)"
                      strokeWidth="1.75"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M0 44 L47 37 L93 41 L140 24 L187 16 L233 20 L280 6 L280 56 L0 56Z"
                      fill="url(#rg)"
                    />
                    {([0, 47, 93, 140, 187, 233, 280] as number[]).map((x, i) => {
                      const ys = [44, 37, 41, 24, 16, 20, 6];
                      return <circle key={i} cx={x} cy={ys[i]} r="2.5" fill="hsl(221 78% 62%)" />;
                    })}
                  </svg>
                </div>
                <div
                  className="rounded-xl p-3"
                  style={{
                    background: "hsl(222 35% 10%)",
                    boxShadow: "0 0 0 1px hsl(222 35% 15%)",
                  }}
                >
                  <p
                    className="mb-2 font-mono text-[9px] font-medium tracking-wide uppercase"
                    style={{ color: "hsl(220 15% 42%)" }}
                  >
                    Recent
                  </p>
                  <div className="space-y-2">
                    {[
                      { name: "Stripe payout", amount: "+$4,200", color: "hsl(142 60% 45%)" },
                      { name: "AWS invoice", amount: "-$182", color: "hsl(0 65% 55%)" },
                      { name: "Figma renewal", amount: "-$75", color: "hsl(0 65% 55%)" },
                    ].map((tx) => (
                      <div key={tx.name} className="flex items-center justify-between">
                        <span
                          className="font-mono text-[9px]"
                          style={{ color: "hsl(220 15% 50%)" }}
                        >
                          {tx.name}
                        </span>
                        <span
                          className="font-mono text-[9px] font-semibold"
                          style={{ color: tx.color }}
                        >
                          {tx.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Fade to bg */}
          <div
            className="pointer-events-none -mt-10 h-20"
            style={{ background: "linear-gradient(to bottom, transparent, hsl(38 30% 97%))" }}
          />
        </div>
      </section>

      {/* ── Stats strip ────────────────────────────────────────── */}
      <section
        className="border-b py-16"
        style={{ background: "hsl(38 30% 97%)", borderColor: "hsl(220 16% 88%)" }}
      >
        <div className="mx-auto max-w-5xl px-6">
          <div
            className="grid grid-cols-2 divide-x md:grid-cols-4"
            style={{ borderColor: "hsl(220 16% 88%)" }}
          >
            {[
              { value: "2,400+", label: "Businesses using Trivio", sub: "across 40+ countries" },
              { value: "$2.4B+", label: "Transactions processed", sub: "this fiscal year" },
              { value: "98.7%", label: "Uptime last 12 months", sub: "SLA-backed guarantee" },
              { value: "< 2 min", label: "Average setup time", sub: "from signup to first entry" },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={`px-8 text-center ${i > 0 ? "border-l" : ""}`}
                style={{ borderColor: "hsl(220 16% 88%)" }}
              >
                <p
                  className="font-serif text-3xl tracking-tight"
                  style={{ color: "hsl(222 30% 11%)" }}
                >
                  {stat.value}
                </p>
                <p className="mt-1 text-sm font-medium" style={{ color: "hsl(222 25% 25%)" }}>
                  {stat.label}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: "hsl(220 12% 55%)" }}>
                  {stat.sub}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────── */}
      <section id="how-it-works" className="py-24" style={{ background: "hsl(38 30% 97%)" }}>
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-16 text-center">
            <p
              className="mb-3 text-xs font-bold tracking-[0.15em] uppercase"
              style={{ color: "hsl(221 78% 38%)" }}
            >
              Simple by design
            </p>
            <h2
              className="font-serif text-4xl tracking-tight md:text-5xl"
              style={{ color: "hsl(222 30% 11%)" }}
            >
              Up and running
              <br />
              <span style={{ color: "hsl(221 78% 38%)" }}>in three steps.</span>
            </h2>
          </div>

          <div className="relative grid grid-cols-1 gap-0 md:grid-cols-3">
            {/* Connecting line */}
            <div
              className="absolute top-12 right-1/6 left-1/6 hidden h-px md:block"
              style={{
                background:
                  "linear-gradient(to right, transparent, hsl(221 78% 38% / 0.3), hsl(221 78% 38% / 0.3), transparent)",
              }}
            />

            {[
              {
                step: "01",
                icon: Upload,
                title: "Upload a document",
                desc: "Drag in a receipt photo, bank PDF, or invoice. Trivio accepts images, PDFs, and scanned documents — no formatting required.",
                accent: "hsl(221 78% 38%)",
                bg: "hsl(221 78% 38% / 0.08)",
              },
              {
                step: "02",
                icon: Bot,
                title: "AI reads and categorises",
                desc: "Claude extracts the vendor, date, amount, tax, and category. It proposes balanced journal entries that match your chart of accounts.",
                accent: "hsl(262 70% 58%)",
                bg: "hsl(262 70% 58% / 0.08)",
              },
              {
                step: "03",
                icon: MousePointerClick,
                title: "Confirm and done",
                desc: "One click to approve. Your books update instantly. Reports, reconciliation, and ageing summaries reflect the new entry immediately.",
                accent: "hsl(142 60% 40%)",
                bg: "hsl(142 60% 40% / 0.08)",
              },
            ].map(({ step, icon: Icon, title, desc, accent, bg }) => (
              <div key={step} className="relative flex flex-col items-center p-8 text-center">
                {/* Step number */}
                <p
                  className="pointer-events-none absolute top-2 left-8 font-serif text-7xl font-bold select-none"
                  style={{ color: "hsl(220 16% 88%)", lineHeight: 1 }}
                >
                  {step}
                </p>

                <div
                  className="relative z-10 mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ background: bg, boxShadow: `0 0 0 1px ${accent}22` }}
                >
                  <Icon className="h-6 w-6" style={{ color: accent }} />
                </div>

                <h3 className="mb-3 text-lg font-semibold" style={{ color: "hsl(222 30% 11%)" }}>
                  {title}
                </h3>
                <p
                  className="max-w-xs text-sm leading-relaxed"
                  style={{ color: "hsl(220 12% 48%)" }}
                >
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section
        id="features"
        className="border-t py-24"
        style={{ borderColor: "hsl(220 16% 88%)", background: "hsl(38 25% 94%)" }}
      >
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-16 text-center">
            <p
              className="mb-3 text-xs font-bold tracking-[0.15em] uppercase"
              style={{ color: "hsl(221 78% 38%)" }}
            >
              Everything you need
            </p>
            <h2
              className="font-serif text-4xl tracking-tight md:text-5xl"
              style={{ color: "hsl(222 30% 11%)" }}
            >
              Built for real businesses,
              <br />
              not accounting firms.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg" style={{ color: "hsl(220 12% 48%)" }}>
              Everything a growing business needs to stay on top of their finances — without the
              learning curve.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Zap,
                title: "AI Document Extraction",
                desc: "Upload receipts, invoices, or bank statements. Claude reads them and populates your books — you just confirm.",
                accent: "hsl(221 78% 38%)",
                bg: "hsl(221 78% 38% / 0.07)",
              },
              {
                icon: FileText,
                title: "Invoices & Bills",
                desc: "Create professional invoices, track payments, and manage your accounts payable — all in one place.",
                accent: "hsl(142 60% 40%)",
                bg: "hsl(142 60% 40% / 0.07)",
              },
              {
                icon: RefreshCw,
                title: "Bank Reconciliation",
                desc: "Match bank transactions to your records automatically. Spot discrepancies before they become problems.",
                accent: "hsl(38 80% 45%)",
                bg: "hsl(38 80% 45% / 0.07)",
              },
              {
                icon: BarChart3,
                title: "Financial Reports",
                desc: "Profit & loss, balance sheet, cash flow — generated in seconds. Share with your accountant or investors.",
                accent: "hsl(262 70% 55%)",
                bg: "hsl(262 70% 55% / 0.07)",
              },
              {
                icon: Users,
                title: "AR / AP Aging",
                desc: "Know exactly who owes you and what you owe. Ageing summaries keep cash flow front of mind.",
                accent: "hsl(0 70% 50%)",
                bg: "hsl(0 70% 50% / 0.07)",
              },
              {
                icon: Shield,
                title: "Double-Entry Integrity",
                desc: "Every transaction is a balanced journal entry. Your books are always mathematically correct — guaranteed.",
                accent: "hsl(221 78% 38%)",
                bg: "hsl(221 78% 38% / 0.07)",
              },
            ].map(({ icon: Icon, title, desc, accent, bg }) => (
              <div
                key={title}
                className="group rounded-2xl border p-6 transition-all duration-200 hover:-translate-y-0.5"
                style={{
                  background: "hsl(0 0% 100%)",
                  borderColor: "hsl(220 16% 88%)",
                  boxShadow: "0 1px 3px hsl(222 30% 11% / 0.04)",
                }}
              >
                <div
                  className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110"
                  style={{ background: bg }}
                >
                  <Icon className="h-5 w-5" style={{ color: accent }} />
                </div>
                <h3 className="mb-2 font-semibold" style={{ color: "hsl(222 30% 11%)" }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "hsl(220 12% 48%)" }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI spotlight ───────────────────────────────────────── */}
      <section
        className="border-t py-24"
        style={{ background: "hsl(38 30% 97%)", borderColor: "hsl(220 16% 88%)" }}
      >
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid items-center gap-16 md:grid-cols-2">
            <div>
              <p
                className="mb-3 text-xs font-bold tracking-[0.15em] uppercase"
                style={{ color: "hsl(221 78% 38%)" }}
              >
                Powered by Claude AI
              </p>
              <h2
                className="font-serif text-4xl leading-tight tracking-tight"
                style={{ color: "hsl(222 30% 11%)" }}
              >
                Drop a receipt.
                <br />
                We handle the rest.
              </h2>
              <p className="mt-4 text-base leading-relaxed" style={{ color: "hsl(220 12% 48%)" }}>
                Upload a photo of your receipt or invoice. Trivio reads it, categorises the expense,
                and drafts the journal entry — ready for your approval in seconds.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "Works with photos, PDFs, and scanned documents",
                  "Extracts vendor, date, amount, and tax automatically",
                  "You always review before anything is saved",
                  "Learns your chart of accounts over time",
                ].map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm">
                    <div
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "hsl(221 78% 38% / 0.1)" }}
                    >
                      <Check className="h-3 w-3" style={{ color: "hsl(221 78% 38%)" }} />
                    </div>
                    <span style={{ color: "hsl(222 25% 22%)" }}>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Receipt extraction mockup */}
            <div className="relative">
              <div
                className="space-y-4 rounded-2xl border p-5"
                style={{
                  background: "hsl(0 0% 100%)",
                  borderColor: "hsl(220 16% 88%)",
                  boxShadow:
                    "0 4px 6px -1px hsl(222 30% 11% / 0.05), 0 16px 40px -8px hsl(222 30% 11% / 0.10), 0 0 0 1px hsl(220 16% 88%)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4" style={{ color: "hsl(221 78% 38%)" }} />
                  <span
                    className="text-xs font-semibold tracking-wide uppercase"
                    style={{ color: "hsl(220 12% 48%)" }}
                  >
                    AI Extraction — Review
                  </span>
                  <span
                    className="ml-auto rounded-full px-2.5 py-1 text-[10px] font-semibold"
                    style={{ background: "hsl(38 80% 55% / 0.1)", color: "hsl(38 70% 38%)" }}
                  >
                    Pending review
                  </span>
                </div>

                <div className="space-y-2 rounded-xl p-3" style={{ background: "hsl(38 25% 96%)" }}>
                  {[
                    { label: "Vendor", value: "Adobe Inc." },
                    { label: "Date", value: "May 28, 2026" },
                    { label: "Amount", value: "$54.99" },
                    { label: "Tax (GST)", value: "$4.40" },
                    { label: "Category", value: "Software & Subscriptions" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <span style={{ color: "hsl(220 12% 52%)" }}>{label}</span>
                      <span className="font-semibold" style={{ color: "hsl(222 30% 14%)" }}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                <div
                  className="overflow-hidden rounded-xl border text-xs"
                  style={{ borderColor: "hsl(220 16% 88%)" }}
                >
                  <div
                    className="grid grid-cols-3 px-3 py-2 text-[9px] font-bold tracking-wide uppercase"
                    style={{ background: "hsl(38 20% 95%)", color: "hsl(220 12% 52%)" }}
                  >
                    <span>Account</span>
                    <span className="text-right">Debit</span>
                    <span className="text-right">Credit</span>
                  </div>
                  {[
                    { account: "Software & Subscriptions", debit: "$54.99", credit: "" },
                    { account: "GST Receivable", debit: "$4.40", credit: "" },
                    { account: "Business Chequing", debit: "", credit: "$59.39" },
                  ].map((row) => (
                    <div
                      key={row.account}
                      className="grid grid-cols-3 border-t px-3 py-2"
                      style={{ borderColor: "hsl(220 16% 92%)" }}
                    >
                      <span className="text-[11px]" style={{ color: "hsl(222 25% 28%)" }}>
                        {row.account}
                      </span>
                      <span
                        className="text-right font-mono text-[11px]"
                        style={{ color: "hsl(142 60% 35%)" }}
                      >
                        {row.debit}
                      </span>
                      <span
                        className="text-right font-mono text-[11px]"
                        style={{ color: "hsl(0 68% 48%)" }}
                      >
                        {row.credit}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    className="flex-1 rounded-lg py-2.5 text-xs font-semibold transition-opacity hover:opacity-90"
                    style={{ background: "hsl(221 78% 38%)", color: "#fff" }}
                  >
                    Confirm & save
                  </button>
                  <button
                    className="flex-1 rounded-lg border py-2.5 text-xs font-semibold transition-colors hover:border-blue-200"
                    style={{ borderColor: "hsl(220 16% 88%)", color: "hsl(220 12% 48%)" }}
                  >
                    Edit first
                  </button>
                </div>
              </div>

              {/* Floating badge */}
              <div
                className="absolute -top-4 -right-4 flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold"
                style={{
                  background: "hsl(0 0% 100%)",
                  borderColor: "hsl(220 16% 86%)",
                  boxShadow: "0 4px 20px hsl(222 30% 11% / 0.1), 0 1px 3px hsl(222 30% 11% / 0.06)",
                  color: "hsl(142 58% 35%)",
                }}
              >
                <span
                  className="h-2 w-2 animate-pulse rounded-full"
                  style={{ background: "hsl(142 60% 45%)" }}
                />
                Extracted in 1.8s
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Testimonials ───────────────────────────────────────── */}
      <section
        className="border-t py-20"
        style={{ background: "hsl(38 25% 94%)", borderColor: "hsl(220 16% 88%)" }}
      >
        <div className="mx-auto max-w-5xl px-6">
          <p
            className="mb-12 text-center text-xs font-bold tracking-[0.15em] uppercase"
            style={{ color: "hsl(220 12% 55%)" }}
          >
            Trusted by businesses like yours
          </p>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                quote:
                  "I used to spend 3 hours a week on bookkeeping. Trivio cut that to 20 minutes. The AI extraction alone is worth it.",
                name: "Sarah K.",
                role: "Freelance Designer",
                rating: 5,
              },
              {
                quote:
                  "Finally an accounting tool that doesn't require a CPA to operate. The reconciliation feature saved me hours during tax time.",
                name: "Marcus T.",
                role: "E-commerce Founder",
                rating: 5,
              },
              {
                quote:
                  "The double-entry system gives me confidence that my books are accurate. The reports look professional enough to share with investors.",
                name: "Priya M.",
                role: "SaaS Founder",
                rating: 5,
              },
            ].map(({ quote, name, role, rating }) => (
              <div
                key={name}
                className="flex flex-col rounded-2xl border p-6"
                style={{
                  background: "hsl(0 0% 100%)",
                  borderColor: "hsl(220 16% 88%)",
                  boxShadow: "0 1px 3px hsl(222 30% 11% / 0.04)",
                }}
              >
                {/* Stars */}
                <div className="mb-4 flex gap-1">
                  {[...Array(rating)].map((_, i) => (
                    <Star
                      key={i}
                      className="h-3.5 w-3.5 fill-current"
                      style={{ color: "hsl(38 88% 52%)" }}
                    />
                  ))}
                </div>

                {/* Quote */}
                <p className="flex-1 text-sm leading-relaxed" style={{ color: "hsl(222 20% 28%)" }}>
                  &ldquo;{quote}&rdquo;
                </p>

                {/* Attribution */}
                <div
                  className="mt-5 flex items-center gap-3 border-t pt-5"
                  style={{ borderColor: "hsl(220 16% 92%)" }}
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                    style={{ background: "hsl(221 78% 38% / 0.1)", color: "hsl(221 78% 38%)" }}
                  >
                    {name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "hsl(222 30% 11%)" }}>
                      {name}
                    </p>
                    <p className="text-xs" style={{ color: "hsl(220 12% 55%)" }}>
                      {role}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden border-t py-28"
        style={{ background: "hsl(222 35% 8%)", borderColor: "hsl(222 35% 15%)" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(hsl(220 20% 80% / 0.03) 1px, transparent 1px), linear-gradient(90deg, hsl(220 20% 80% / 0.03) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 110%, hsl(221 78% 38% / 0.18) 0%, transparent 60%)",
          }}
        />

        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2
            className="font-serif leading-tight tracking-tight"
            style={{ color: "hsl(220 20% 96%)", fontSize: "clamp(2.5rem, 6vw, 5rem)" }}
          >
            Your books, balanced.
            <br />
            <span style={{ color: "hsl(221 78% 62%)" }}>Start in minutes.</span>
          </h2>
          <p className="mt-5 text-lg" style={{ color: "hsl(220 20% 46%)" }}>
            Free forever, open source — run it on the web or as a native macOS desktop app.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl px-7 py-3.5 text-sm font-semibold transition-all hover:opacity-90"
              style={{
                background: "hsl(221 78% 38%)",
                color: "#fff",
                boxShadow: "0 4px 24px hsl(221 78% 38% / 0.45), 0 0 0 1px hsl(221 78% 30%)",
              }}
            >
              Create free account
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-xl px-7 py-3.5 text-sm font-medium transition-all"
              style={{ color: "hsl(220 20% 50%)", boxShadow: "0 0 0 1px hsl(222 35% 20%)" }}
            >
              See pricing
            </Link>
            <a
              href="https://github.com/Abubakarjutt/Trivio/releases/latest"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl px-7 py-3.5 text-sm font-medium transition-all"
              style={{ color: "hsl(220 20% 50%)", boxShadow: "0 0 0 1px hsl(222 35% 20%)" }}
            >
              Download for macOS
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-6">
            {[
              "Free forever plan",
              "Open source",
              "Desktop app",
              "AI extraction included",
              "No accountant needed",
              "Cancel anytime",
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-1.5 text-xs"
                style={{ color: "hsl(220 20% 38%)" }}
              >
                <Check className="h-3.5 w-3.5" style={{ color: "hsl(221 78% 52%)" }} />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer
        className="border-t py-10"
        style={{ background: "hsl(222 35% 6%)", borderColor: "hsl(222 35% 13%)" }}
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 md:flex-row">
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{
                background: "hsl(221 78% 38% / 0.15)",
                boxShadow: "0 0 0 1px hsl(221 78% 38% / 0.25)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 3h12M2 8h8M2 13h5"
                  stroke="hsl(221 78% 70%)"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="text-sm font-semibold" style={{ color: "hsl(220 20% 55%)" }}>
              Trivio
            </span>
          </div>

          <div className="flex items-center gap-6">
            {[
              { label: "Features", href: "#features" },
              { label: "Pricing", href: "/pricing" },
              { label: "Login", href: "/login" },
              { label: "Register", href: "/register" },

              { label: "Download", href: "https://github.com/Abubakarjutt/Trivio/releases/latest" },

              { label: "GitHub", href: "https://github.com/Abubakarjutt/Trivio" },
            ].map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-xs transition-colors hover:text-white/60"
                style={{ color: "hsl(220 20% 35%)" }}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <p className="font-mono text-xs" style={{ color: "hsl(220 20% 28%)" }}>
            © 2026 Trivio
          </p>
        </div>
      </footer>
    </div>
  );
}
