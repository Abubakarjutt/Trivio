"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/hooks/use-toast";
import { Loader2 } from "lucide-react";

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
      {/* Left — dark brand panel */}
      <div className="hidden lg:flex lg:w-[460px] xl:w-[520px] flex-col auth-bg relative overflow-hidden">
        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(hsl(220 20% 80%) 1px, transparent 1px), linear-gradient(90deg, hsl(220 20% 80%) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />

        {/* Glowing orbs */}
        <div className="absolute top-1/4 -left-16 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-1/3 right-0 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />

        <div className="relative flex flex-col justify-between h-full p-12">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 ring-1 ring-primary/30">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M2 3h12M2 8h8M2 13h5" stroke="hsl(221 78% 70%)" strokeWidth="1.75" strokeLinecap="round"/>
                <circle cx="12" cy="11" r="3" stroke="hsl(221 78% 70%)" strokeWidth="1.5"/>
                <path d="M12 9.5v1.5l.75.75" stroke="hsl(221 78% 70%)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="font-semibold text-white/90 tracking-wide">AutoAccounts</span>
          </div>

          {/* Headline */}
          <div className="space-y-6">
            <div>
              <h1 className="text-4xl xl:text-5xl font-serif text-white leading-tight">
                Financial clarity<br />
                <span className="text-primary/80">without complexity.</span>
              </h1>
              <p className="mt-4 text-white/45 text-base leading-relaxed max-w-sm">
                Double-entry bookkeeping, invoicing, and reports — designed for the way modern businesses actually work.
              </p>
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2">
              {["Invoices & Bills", "AR / AP Aging", "Financial Reports", "AI Extraction"].map((f) => (
                <span key={f} className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-white/55 ring-1 ring-white/10">
                  <span className="h-1 w-1 rounded-full bg-primary/60" />
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* Footer */}
          <p className="text-white/20 text-xs">© 2026 AutoAccounts · Built for serious businesses</p>
        </div>
      </div>

      {/* Right — form panel */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[hsl(38_30%_97%)] px-6 sm:px-12">
        {/* Mobile logo */}
        <div className="lg:hidden mb-10 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12M2 8h8M2 13h5" stroke="hsl(221 78% 38%)" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="font-semibold text-foreground">AutoAccounts</span>
        </div>

        <div className="w-full max-w-[360px]">
          {/* Card */}
          <div className="rounded-2xl bg-white shadow-card-md p-8">
            <div className="mb-7">
              <h2 className="text-2xl font-serif text-foreground">Welcome back</h2>
              <p className="text-sm text-muted-foreground mt-1">Sign in to your account to continue</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
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
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  autoComplete="current-password"
                />
              </div>

              <div className="pt-1">
                <Button type="submit" className="w-full h-10" disabled={loading}>
                  {loading && <Loader2 className="animate-spin" />}
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
              </div>
            </form>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-5">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="font-semibold text-primary hover:text-primary/80 transition-colors">
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
