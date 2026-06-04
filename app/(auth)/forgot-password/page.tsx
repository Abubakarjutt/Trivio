"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/hooks/use-toast";
import { Loader2, ArrowLeft, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const data = await res.json();
        toast({ variant: "destructive", title: data.error || "Something went wrong" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F3EF] px-5 py-12">
      <div className="w-full max-w-[440px]">

        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-8 group"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to sign in
        </Link>

        {sent ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
              <Mail className="h-5 w-5 text-green-700" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900 mb-2">Check your email</h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              If an account exists for <strong>{email}</strong>, we&apos;ve sent a password reset link. Check your inbox — it expires in 1 hour.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center justify-center w-full h-11 rounded-xl text-sm font-semibold text-white"
              style={{ background: "#1A6644" }}
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">Forgot password?</h1>
            <p className="text-sm text-slate-500 mb-8 leading-relaxed">
              Enter your email and we&apos;ll send you a reset link.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-12 text-base border-slate-200 focus:border-green-700 focus:ring-green-700/20"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 text-base font-semibold rounded-xl"
                style={{ background: "#1A6644" }}
              >
                {loading && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
