"use client";

import { useState, useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/hooks/use-toast";
import { Loader2, Eye, EyeOff } from "lucide-react";

const FEATURES = [
  "Import bank statements & receipts",
  "AI-powered auto-categorisation",
  "Live dashboard & cash flow",
  "Ask your finances anything",
];

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (searchParams.get("verified") === "1") {
      toast({ title: "Email verified — you can now sign in." });
    } else if (searchParams.get("error") === "expired-token") {
      toast({ variant: "destructive", title: "Verification link expired. Please register again." });
    } else if (searchParams.get("error") === "invalid-token") {
      toast({ variant: "destructive", title: "Invalid verification link." });
    }
  }, [searchParams, toast]);

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
        className="hidden lg:flex lg:w-[44%] xl:w-[46%] flex-col relative overflow-hidden"
        style={{ background: "linear-gradient(170deg, #081B12 0%, #0C2A1B 55%, #0e2d1d 100%)" }}
      >
        {/* Ledger-line horizontal rule texture */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
          {Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0"
              style={{
                top: `${i * 3.45}%`,
                height: "1px",
                background: "rgba(147,196,174,0.04)",
              }}
            />
          ))}
        </div>

        {/* Ambient glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 25% 65%, rgba(26,102,68,0.22) 0%, transparent 60%)",
          }}
        />

        <div className="relative flex flex-col justify-between h-full p-12 xl:p-16">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[9px]"
              style={{ background: "rgba(147,196,174,0.07)", boxShadow: "inset 0 0 0 1px rgba(147,196,174,0.14)" }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 2h12v3H2zM2 7h8v2H2zM2 11h5v2H2z" stroke="rgba(147,196,174,0.65)" strokeWidth="1.25" strokeLinejoin="round" fill="none"/>
                <circle cx="11" cy="12" r="2.5" stroke="rgba(147,196,174,0.65)" strokeWidth="1.25"/>
                <path d="M11 10.75v1.25l.75.5" stroke="rgba(147,196,174,0.65)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span
              className="text-xs font-medium"
              style={{ color: "rgba(244,243,239,0.5)", letterSpacing: "0.12em", textTransform: "uppercase" }}
            >
              Trivio
            </span>
          </div>

          {/* Display content */}
          <div>
            <h1
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 400,
                fontStyle: "italic",
                fontSize: "clamp(2.5rem, 4vw, 3.75rem)",
                lineHeight: 1.05,
                letterSpacing: "-0.025em",
                color: "rgba(244,243,239,0.88)",
                marginBottom: "1.5rem",
              }}
            >
              Books balanced.
              <br />
              <span style={{ color: "rgba(147,196,174,0.6)", fontStyle: "normal", fontWeight: 300 }}>
                Mind cleared.
              </span>
            </h1>

            {/* Gold rule divider */}
            <div className="flex items-center gap-3 mb-9">
              <div
                className="h-px w-10"
                style={{ background: "linear-gradient(90deg, #C9A86A, rgba(201,168,106,0.2))" }}
              />
              <div className="w-1 h-1 rounded-full" style={{ background: "rgba(201,168,106,0.45)" }} />
            </div>

            {/* Feature list */}
            <div className="space-y-4">
              {FEATURES.map((f, i) => (
                <div key={i} className="flex items-center gap-3.5">
                  <div
                    className="h-px w-4 shrink-0"
                    style={{ background: `rgba(201,168,106,${0.3 + i * 0.08})` }}
                  />
                  <span className="text-sm" style={{ color: "rgba(244,243,239,0.72)", lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          <p
            className="text-xs"
            style={{ color: "rgba(244,243,239,0.12)", letterSpacing: "0.05em" }}
          >
            © 2026 Trivio
          </p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 flex-col" style={{ background: "#FDFCF9" }}>

        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4 sm:px-10 sm:py-5">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: "rgba(26,102,68,0.07)", boxShadow: "inset 0 0 0 1px rgba(26,102,68,0.13)" }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M2 2h12v3H2zM2 7h8v2H2zM2 11h5v2H2z" stroke="#1A6644" strokeWidth="1.25" strokeLinejoin="round" fill="none"/>
              </svg>
            </div>
            <span className="text-sm font-medium" style={{ color: "#1A6644" }}>Trivio</span>
          </div>
          <div className="hidden lg:block" />
          <Link
            href="https://trivio-ai.com"
            className="text-xs text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
            style={{ letterSpacing: "0.02em" }}
          >
            trivio-ai.com ↗
          </Link>
        </div>

        {/* Form area */}
        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[400px]">

            {/* Eyebrow + heading */}
            <div className="mb-9">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="h-px w-5" style={{ background: "#C9A86A" }} />
                <span
                  className="text-xs font-medium"
                  style={{ color: "#C9A86A", letterSpacing: "0.14em", textTransform: "uppercase" }}
                >
                  Secure access
                </span>
              </div>
              <h2
                style={{
                  fontFamily: "var(--font-serif)",
                  fontWeight: 400,
                  fontSize: "2rem",
                  letterSpacing: "-0.025em",
                  lineHeight: 1.2,
                  color: "#0F1117",
                  margin: 0,
                }}
              >
                Welcome back
              </h2>
              <p className="mt-2.5 text-sm" style={{ color: "#9CA3AF", lineHeight: 1.5 }}>
                Sign in to your Trivio account.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="block text-xs font-medium"
                  style={{ color: "#6B7180", letterSpacing: "0.07em", textTransform: "uppercase" }}
                >
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  autoComplete="email"
                  className="h-11 text-sm bg-white"
                  style={{ borderColor: "#E4E1D8" }}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-xs font-medium"
                    style={{ color: "#6B7180", letterSpacing: "0.07em", textTransform: "uppercase" }}
                  >
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-medium transition-colors"
                    style={{ color: "#1A6644" }}
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                    autoComplete="current-password"
                    className="h-11 text-sm bg-white pr-10"
                    style={{ borderColor: "#E4E1D8" }}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    tabIndex={0}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-1.5">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 text-sm font-medium rounded-xl"
                  style={{ background: "#1A6644", letterSpacing: "0.01em" }}
                >
                  {loading && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
              </div>
            </form>

            <div className="mt-8 pt-8" style={{ borderTop: "1px solid #E4E1D8" }}>
              <p className="text-xs text-center mb-4" style={{ color: "#C4C4C4" }}>
                New to Trivio?
              </p>
              <Link
                href="/register"
                className="flex items-center justify-center w-full h-11 rounded-xl text-sm font-medium transition-all hover:border-primary/50 hover:text-foreground"
                style={{ border: "1.5px solid #E4E1D8", color: "#374151" }}
              >
                Create a free account
              </Link>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
