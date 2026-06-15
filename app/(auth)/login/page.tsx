"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/hooks/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";

const FEATURES = [
  { icon: "↑", label: "Import bank statements & receipts" },
  { icon: "◈", label: "AI auto-categorisation" },
  { icon: "▦", label: "Live dashboard & cash flow" },
  { icon: "◉", label: "Ask your finances anything" },
];

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (result?.error) {
        toast({ variant: "destructive", title: "Invalid email or password" });
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
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
                Welcome
                <br />
                <em className="not-italic" style={{ color: "rgba(42,138,90,0.95)" }}>back.</em>
              </h1>
              <p className="mt-5 text-white/45 text-base leading-relaxed max-w-xs">
                Your financial data is waiting. Pick up right where you left off.
              </p>
            </div>

            {/* Feature list */}
            <div className="space-y-3">
              {FEATURES.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3"
                  style={{
                    animationName: "slideUp",
                    animationDuration: "0.6s",
                    animationTimingFunction: "cubic-bezier(0.16,1,0.3,1)",
                    animationFillMode: "both",
                    animationDelay: `${i * 80}ms`,
                  }}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold shrink-0"
                    style={{ background: "rgba(26,102,68,0.2)", color: "rgba(147,196,174,0.9)", boxShadow: "inset 0 0 0 1px rgba(26,102,68,0.3)" }}
                  >
                    {f.icon}
                  </span>
                  <span className="text-white/55 text-sm">{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-white/15 text-xs">© 2026 Trivio · Personal finance made easy</p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 flex-col bg-white">

        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5 border-b border-slate-100">
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
        <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 sm:py-12">
          <div className="w-full max-w-[480px]">

            {/* Heading */}
            <div className="mb-6 sm:mb-10">
              <h2
                className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Sign in to Trivio
              </h2>
              <p className="mt-2 text-slate-500 text-sm sm:text-base">
                Enter your credentials to access your dashboard.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
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

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    Password
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-green-700 hover:text-green-900 transition-colors font-medium"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  autoComplete="current-password"
                  className="h-12 text-base border-slate-200 focus:border-green-700 focus:ring-green-700/20"
                />
              </div>

              <div className="pt-1">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 text-base font-semibold rounded-xl"
                  style={{ background: "#1A6644" }}
                >
                  {loading && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                  {loading ? "Signing in…" : "Sign in →"}
                </Button>
              </div>
            </form>

            {/* Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-100" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-4 text-xs text-slate-400">Don&apos;t have an account?</span>
              </div>
            </div>

            <Link
              href="/register"
              className="flex items-center justify-center w-full h-12 rounded-xl border-2 border-slate-200 text-slate-700 text-sm font-semibold hover:border-green-600 hover:text-green-700 transition-all"
            >
              Create a free account
            </Link>

          </div>
        </div>
      </div>
    </div>
  );
}
