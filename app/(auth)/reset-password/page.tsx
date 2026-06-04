"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/hooks/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-slate-500 text-sm mb-4">Invalid or missing reset link.</p>
        <Link href="/forgot-password" className="text-green-700 font-medium text-sm hover:underline">
          Request a new one
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ variant: "destructive", title: "Passwords don't match" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Password updated! Please sign in." });
        router.push("/login");
      } else {
        toast({ variant: "destructive", title: data.error || "Something went wrong" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          New password
        </Label>
        <Input
          id="password"
          type="password"
          placeholder="Min. 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="h-12 text-base border-slate-200 focus:border-green-700 focus:ring-green-700/20"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm" className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Confirm password
        </Label>
        <Input
          id="confirm"
          type="password"
          placeholder="Repeat password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
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
        {loading ? "Updating…" : "Set new password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
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

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">Set new password</h1>
          <p className="text-sm text-slate-500 mb-8">Choose a strong password for your account.</p>

          <Suspense fallback={<div className="text-sm text-slate-400">Loading…</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
