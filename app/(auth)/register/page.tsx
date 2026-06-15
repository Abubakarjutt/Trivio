"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Loader2, ArrowLeft } from "lucide-react";

const METRICS = [
  { value: "$47,293", label: "tracked by users today", delay: "0ms" },
  { value: "94%", label: "of transactions auto-categorised", delay: "120ms" },
  { value: "3.2 hrs", label: "saved per month on average", delay: "240ms" },
];

function PasswordStrength({ password }: { password: string }) {
  const score = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  const colors = ["", "#ef4444", "#f97316", "#eab308", "#22c55e"];
  const labels = ["", "Weak", "Fair", "Good", "Strong"];

  if (!password) return null;
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex gap-1 flex-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-all duration-300"
            style={{ background: i <= score ? colors[score] : "#e2e8f0" }}
          />
        ))}
      </div>
      <span className="text-xs font-medium" style={{ color: colors[score] }}>
        {labels[score]}
      </span>
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [gdprConsent, setGdprConsent] = useState(false);

  const recordConsent = trpc.gdpr.recordConsent.useMutation();

  const register = trpc.auth.register.useMutation({
    onSuccess: async () => {
      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (result?.ok) {
        await recordConsent.mutateAsync().catch(() => {
          // Non-blocking — consent can be re-recorded from support if needed
        });
        router.push("/onboarding");
      } else {
        toast({ variant: "destructive", title: "Account created but sign-in failed. Please sign in manually." });
        router.push("/login");
      }
    },
    onError: (err) => toast({ variant: "destructive", title: err.message }),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast({ variant: "destructive", title: "Passwords do not match" });
      return;
    }
    if (!gdprConsent) {
      toast({ variant: "destructive", title: "Please accept the Privacy Policy to continue" });
      return;
    }
    register.mutate({ name: form.name, email: form.email, password: form.password });
  };

  return (
    <div className="flex min-h-screen">

      {/* ── Left brand panel ── */}
      <div
        className="hidden lg:flex lg:w-[42%] xl:w-[45%] flex-col relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #0a1f14 0%, #0f2e1c 40%, #1A6644 100%)" }}
      >
        {/* Grid texture */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: `linear-gradient(rgba(147,196,174,1) 1px, transparent 1px), linear-gradient(90deg, rgba(147,196,174,1) 1px, transparent 1px)`,
            backgroundSize: "56px 56px",
          }}
        />

        {/* Glow orbs */}
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full opacity-20" style={{ background: "radial-gradient(circle, #1A6644, transparent 70%)" }} />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full opacity-15" style={{ background: "radial-gradient(circle, #2A8A5A, transparent 70%)" }} />

        {/* Decorative floating amounts */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
          {[
            { text: "+$3,240", top: "12%", left: "68%", size: "2.5rem" },
            { text: "-$89.50", top: "31%", left: "5%", size: "1.75rem" },
            { text: "+$1,800", top: "55%", left: "72%", size: "2rem" },
            { text: "-$420", top: "72%", left: "8%", size: "1.5rem" },
            { text: "+$560", top: "85%", left: "55%", size: "1.25rem" },
          ].map((item, i) => (
            <span
              key={i}
              className="absolute font-mono font-bold"
              style={{
                top: item.top,
                left: item.left,
                fontSize: item.size,
                color: item.text.startsWith("+") ? "rgba(134,239,172,0.07)" : "rgba(252,165,165,0.07)",
                animationName: "floatAmount",
                animationDuration: `${8 + i * 1.5}s`,
                animationTimingFunction: "ease-in-out",
                animationIterationCount: "infinite",
                animationDelay: `${i * 0.8}s`,
              }}
            >
              {item.text}
            </span>
          ))}
        </div>

        <style>{`
          @keyframes floatAmount {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-12px); }
          }
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        <div className="relative flex flex-col justify-between h-full p-12 xl:p-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "rgba(26,102,68,0.25)", boxShadow: "inset 0 0 0 1px rgba(26,102,68,0.4)" }}>
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M2 2h12v3H2zM2 7h8v2H2zM2 11h5v2H2z" stroke="rgba(147,196,174,0.9)" strokeWidth="1.25" strokeLinejoin="round" fill="none"/>
                <circle cx="11" cy="12" r="2.5" stroke="rgba(147,196,174,0.9)" strokeWidth="1.25"/>
                <path d="M11 10.75v1.25l.75.5" stroke="rgba(147,196,174,0.9)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-white/80 font-semibold tracking-wide text-sm">Trivio</span>
          </div>

          {/* Headline */}
          <div className="space-y-10">
            <div>
              <h1
                className="text-5xl xl:text-6xl font-bold leading-[1.1] text-white"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Your finances,
                <br />
                <em className="not-italic" style={{ color: "rgba(42,138,90,0.95)" }}>finally clear.</em>
              </h1>
              <p className="mt-5 text-white/45 text-base leading-relaxed max-w-xs">
                Import bank statements, scan receipts, and let AI handle the categorization. Understand your money in minutes.
              </p>
            </div>

            {/* Metrics */}
            <div className="space-y-4">
              {METRICS.map((m, i) => (
                <div
                  key={i}
                  className="flex items-baseline gap-3"
                  style={{
                    animationName: "slideUp",
                    animationDuration: "0.6s",
                    animationTimingFunction: "cubic-bezier(0.16,1,0.3,1)",
                    animationFillMode: "both",
                    animationDelay: m.delay,
                  }}
                >
                  <span
                    className="text-3xl font-bold tabular-nums"
                    style={{ fontFamily: "var(--font-display)", color: "rgba(42,138,90,0.95)" }}
                  >
                    {m.value}
                  </span>
                  <span className="text-white/40 text-sm">{m.label}</span>
                </div>
              ))}
            </div>

            {/* Testimonial */}
            <div
              className="rounded-2xl p-5"
              style={{ background: "rgba(255,255,255,0.04)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)" }}
            >
              <p className="text-white/65 text-sm italic leading-relaxed">
                &ldquo;I finally stopped dreading my monthly accounting. Trivio does in seconds what used to take me an entire afternoon.&rdquo;
              </p>
              <p className="mt-3 text-white/30 text-xs font-medium tracking-wide">— SARAH K. · INDEPENDENT CONSULTANT</p>
            </div>
          </div>

          <p className="text-white/15 text-xs">© 2026 Trivio · Free to start</p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 flex-col bg-white">

        {/* Top bar */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(26,102,68,0.1)", boxShadow: "inset 0 0 0 1px rgba(26,102,68,0.2)" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 2h12v3H2zM2 7h8v2H2zM2 11h5v2H2z" stroke="#1A6644" strokeWidth="1.25" strokeLinejoin="round" fill="none"/>
              </svg>
            </div>
            <span className="font-semibold text-slate-800 text-sm">Trivio</span>
          </div>
          <div className="hidden lg:block" />
          <Link
            href="https://trivio-ai.com"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-700 transition-colors group"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
            Back to trivio-ai.com
          </Link>
        </div>

        {/* Form area */}
        <div className="flex flex-1 items-center justify-center px-8 py-12">
          <div className="w-full max-w-[580px]">

            {/* Heading */}
            <div className="mb-10">
              <h2
                className="text-4xl font-bold text-slate-900 leading-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Create your account
              </h2>
              <p className="mt-2 text-slate-500 text-base">
                Free to start — no credit card required.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Row 1: Name + Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    Full name
                  </Label>
                  <Input
                    id="name"
                    placeholder="Jane Smith"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    autoComplete="name"
                    className="h-12 text-base border-slate-200 focus:border-green-700 focus:ring-green-700/20"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                    autoComplete="email"
                    className="h-12 text-base border-slate-200 focus:border-green-700 focus:ring-green-700/20"
                  />
                </div>
              </div>

              {/* Row 2: Password + Confirm */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="At least 8 characters"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="h-12 text-base border-slate-200 focus:border-green-700 focus:ring-green-700/20"
                  />
                  <PasswordStrength password={form.password} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    Confirm password
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    value={form.confirmPassword}
                    onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                    required
                    autoComplete="new-password"
                    className="h-12 text-base border-slate-200 focus:border-green-700 focus:ring-green-700/20"
                  />
                </div>
              </div>

              {/* GDPR consent */}
              <div className="flex items-start gap-3 pt-1">
                <input
                  id="gdprConsent"
                  type="checkbox"
                  checked={gdprConsent}
                  onChange={(e) => setGdprConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-green-700 cursor-pointer shrink-0"
                />
                <label htmlFor="gdprConsent" className="text-xs text-slate-500 leading-relaxed cursor-pointer">
                  I have read and agree to the{" "}
                  <Link href="/privacy" className="underline underline-offset-2 hover:text-slate-700 font-medium">
                    Privacy Policy
                  </Link>
                  {" "}and consent to the processing of my personal data to provide this service.
                </label>
              </div>

              <div className="pt-1">
                <Button
                  type="submit"
                  disabled={register.isPending || !gdprConsent}
                  className="w-full h-12 text-base font-semibold rounded-xl"
                  style={{ background: "#1A6644" }}
                >
                  {register.isPending && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                  {register.isPending ? "Creating account…" : "Create account →"}
                </Button>
              </div>
            </form>

            {/* Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-100" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-4 text-xs text-slate-400">Already have an account?</span>
              </div>
            </div>

            <Link
              href="/login"
              className="flex items-center justify-center w-full h-12 rounded-xl border-2 border-slate-200 text-slate-700 text-sm font-semibold hover:border-green-600 hover:text-green-700 transition-all"
            >
              Sign in instead
            </Link>

          </div>
        </div>
      </div>
    </div>
  );
}
