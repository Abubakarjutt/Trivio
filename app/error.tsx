"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-[hsl(38,30%,97%)] flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="flex justify-center mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-100">
              <AlertTriangle className="h-8 w-8 text-rose-600" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-2">Something went wrong</h1>
          <p className="text-muted-foreground mb-6">
            An unexpected error occurred. Our team has been notified.
            {error.digest && (
              <span className="block mt-1 text-xs font-mono text-muted-foreground/60">
                Error ID: {error.digest}
              </span>
            )}
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={reset} variant="default">Try again</Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
