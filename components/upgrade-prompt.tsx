"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UpgradePrompt({ feature }: { feature: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 flex flex-col items-center gap-3 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
        <Sparkles className="h-5 w-5 text-amber-600" />
      </div>
      <div>
        <p className="font-semibold text-amber-900">Free tier limit reached</p>
        <p className="text-sm text-amber-700 mt-1">
          You&apos;ve used all your free {feature} this month. Upgrade to Pro for unlimited access.
        </p>
      </div>
      <Button asChild className="mt-1">
        <Link href="/settings/billing">Upgrade to Pro</Link>
      </Button>
    </div>
  );
}
