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
import { Loader2 } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });

  const register = trpc.auth.register.useMutation({
    onSuccess: async () => {
      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (result?.ok) router.push("/onboarding");
    },
    onError: (err) => toast({ variant: "destructive", title: err.message }),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast({ variant: "destructive", title: "Passwords do not match" });
      return;
    }
    register.mutate({ name: form.name, email: form.email, password: form.password });
  };

  return (
    <div className="flex min-h-screen">
      {/* Left — dark brand panel */}
      <div className="hidden lg:flex lg:w-[460px] xl:w-[520px] flex-col auth-bg relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(hsl(220 20% 80%) 1px, transparent 1px), linear-gradient(90deg, hsl(220 20% 80%) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
        <div className="absolute top-1/4 -left-16 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-1/3 right-0 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />

        <div className="relative flex flex-col justify-between h-full p-12">
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

          <div className="space-y-6">
            <div>
              <h1 className="text-4xl xl:text-5xl font-serif text-white leading-tight">
                Your finances,<br />
                <span className="text-primary/80">finally under control.</span>
              </h1>
              <p className="mt-4 text-white/45 text-base leading-relaxed max-w-sm">
                Free to start. Set up your chart of accounts, send your first invoice, and see your financial position — all in minutes.
              </p>
            </div>

            <div className="rounded-2xl bg-white/5 ring-1 ring-white/8 p-5">
              <p className="text-white/70 text-sm italic leading-relaxed">
                &ldquo;AutoAccounts replaced three spreadsheets and saved me hours every month. The invoices look incredibly professional.&rdquo;
              </p>
              <p className="mt-3 text-white/35 text-xs">— Sara K., Freelance Designer</p>
            </div>
          </div>

          <p className="text-white/20 text-xs">© 2026 AutoAccounts · Free to start</p>
        </div>
      </div>

      {/* Right — form panel */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[hsl(38_30%_97%)] px-6 sm:px-12">
        <div className="lg:hidden mb-10 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12M2 8h8M2 13h5" stroke="hsl(221 78% 38%)" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="font-semibold text-foreground">AutoAccounts</span>
        </div>

        <div className="w-full max-w-[360px]">
          <div className="rounded-2xl bg-white shadow-card-md p-8">
            <div className="mb-7">
              <h2 className="text-2xl font-serif text-foreground">Create your account</h2>
              <p className="text-sm text-muted-foreground mt-1">Free to start · no credit card required</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">Full name</Label>
                <Input
                  id="name"
                  placeholder="Jane Smith"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  autoComplete="name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">Email address</Label>
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
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword" className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={form.confirmPassword}
                  onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                  required
                  autoComplete="new-password"
                />
              </div>

              <div className="pt-1">
                <Button type="submit" className="w-full h-10" disabled={register.isPending}>
                  {register.isPending && <Loader2 className="animate-spin" />}
                  {register.isPending ? "Creating account…" : "Create account"}
                </Button>
              </div>
            </form>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-5">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-primary hover:text-primary/80 transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
