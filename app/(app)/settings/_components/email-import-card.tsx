"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface EmailImportCardProps {
  initialToken: string;
}

export function EmailImportCard({ initialToken }: EmailImportCardProps) {
  const [token, setToken] = useState(initialToken);
  const [confirmReset, setConfirmReset] = useState(false);

  const resetToken = trpc.org.resetEmailImportToken.useMutation({
    onSuccess: (data) => {
      setToken(data.emailImportToken);
      setConfirmReset(false);
      toast.success("Import address reset. Old address no longer works.");
    },
    onError: () => toast.error("Failed to reset address"),
  });

  const importAddress = `${token}@import.trivio-ai.com`;

  return (
    <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6 space-y-3">
      <div className="flex items-center gap-3 mb-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <span className="text-sm">📧</span>
        </div>
        <div>
          <h2 className="font-semibold text-sm">Email Import</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Forward bank alert emails to auto-import transactions. Works with alerts and PDF/image attachments.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
        <span className="font-mono text-xs text-blue-700 truncate">{importAddress}</span>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(importAddress); toast.success("Copied!"); }}
          className="ml-3 text-xs font-semibold text-blue-600 hover:text-blue-800 flex-shrink-0"
        >
          Copy
        </button>
      </div>

      {!confirmReset ? (
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="text-xs text-red-500 hover:text-red-700"
        >
          🔄 Reset address
        </button>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
          <p className="text-xs text-red-700 font-medium">
            This generates a new address. The old address stops working immediately.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => resetToken.mutate()}
              disabled={resetToken.isPending}
              className="text-xs h-7"
            >
              {resetToken.isPending ? "Resetting…" : "Yes, reset it"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmReset(false)} className="text-xs h-7">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
