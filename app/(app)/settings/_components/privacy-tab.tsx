"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Download, Trash2, Shield, Clock, AlertTriangle } from "lucide-react";

function DataExportCard() {
  const exportData = trpc.gdpr.exportData.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `autoaccounts-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    },
    onError: () => toast.error("Export failed. Please try again."),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-start gap-3">
        <Download className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Export your data</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Download a copy of all your data in JSON format — invoices, bills, journals, contacts, budgets,
            and chat history (GDPR Article 20).
          </p>
        </div>
      </div>
      <button
        onClick={() => exportData.mutate()}
        disabled={exportData.isPending}
        className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
        {exportData.isPending ? "Preparing export…" : "Download my data"}
      </button>
    </div>
  );
}

function ChatRetentionCard() {
  const purge = trpc.gdpr.purgeOldChatMessages.useMutation({
    onSuccess: (data) =>
      toast.success(
        data.deleted > 0
          ? `Deleted ${data.deleted} chat message${data.deleted === 1 ? "" : "s"}.`
          : "No messages older than 1 year found.",
      ),
    onError: () => toast.error("Failed to purge messages."),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-start gap-3">
        <Clock className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Chat history retention</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI assistant chat messages are kept for 12 months. Delete messages older than 1 year now.
          </p>
        </div>
      </div>
      <button
        onClick={() => purge.mutate({ olderThanDays: 365 })}
        disabled={purge.isPending}
        className="flex items-center gap-2 text-sm font-medium text-amber-600 hover:text-amber-800 disabled:opacity-50 transition-colors"
      >
        <Clock className="h-3.5 w-3.5" />
        {purge.isPending ? "Purging…" : "Delete messages older than 1 year"}
      </button>
    </div>
  );
}

function AuditLogCard() {
  const [show, setShow] = useState(false);
  const { data, isLoading } = trpc.gdpr.auditLog.useQuery(
    { limit: 20 },
    { enabled: show },
  );

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-start gap-3">
        <Shield className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Activity audit log</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            A record of significant data operations on your account (GDPR Article 30).
          </p>
        </div>
      </div>
      <button
        onClick={() => setShow((v) => !v)}
        className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
      >
        {show ? "Hide log" : "Show recent activity"}
      </button>
      {show && (
        <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!isLoading && (!data?.logs || data.logs.length === 0) && (
            <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
          )}
          {data?.logs.map((log: { id: string; action: string; entityType: string; entityId?: string | null; createdAt: Date | string }) => (
            <div key={log.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
              <span className="text-foreground">
                <span className="font-medium">{log.action}</span>{" "}{log.entityType}
                {log.entityId ? <span className="text-muted-foreground"> #{log.entityId.slice(-6)}</span> : null}
              </span>
              <span className="text-muted-foreground shrink-0 ml-4">
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteAccountCard() {
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [confirmText, setConfirmText] = useState("");

  const deleteAccount = trpc.gdpr.deleteAccount.useMutation({
    onSuccess: () => {
      toast.success("Account deleted. Signing you out…");
      setTimeout(() => { window.location.href = "/login"; }, 1500);
    },
    onError: () => toast.error("Failed to delete account. Please contact support."),
  });

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-destructive">Delete account</p>
          <p className="text-xs text-destructive/80 mt-0.5">
            Permanently anonymises your personal data and deletes your organisation&apos;s records
            (GDPR Article 17). Financial records required by law may be retained in anonymised form.
          </p>
        </div>
      </div>

      {step === "idle" && (
        <button
          onClick={() => setStep("confirm")}
          className="text-sm font-medium text-destructive hover:text-destructive/80 transition-colors"
        >
          Request account deletion
        </button>
      )}

      {step === "confirm" && (
        <div className="space-y-3 pt-1">
          <p className="text-xs font-medium text-destructive">
            Type <strong>DELETE</strong> to confirm. This cannot be undone.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full h-9 rounded-lg border border-destructive/30 bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-destructive/20"
          />
          <div className="flex gap-2">
            <button
              onClick={() => deleteAccount.mutate({ confirmText: "DELETE" })}
              disabled={confirmText !== "DELETE" || deleteAccount.isPending}
              className="flex-1 h-9 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-40 hover:bg-destructive/90 transition-colors"
            >
              {deleteAccount.isPending ? "Deleting…" : "Delete my account"}
            </button>
            <button
              onClick={() => { setStep("idle"); setConfirmText(""); }}
              disabled={deleteAccount.isPending}
              className="flex-1 h-9 rounded-lg border border-border bg-background text-sm text-muted-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PrivacyTab() {
  return (
    <div className="space-y-4">
      <DataExportCard />
      <ChatRetentionCard />
      <AuditLogCard />
      <DeleteAccountCard />
      <p className="text-xs text-muted-foreground pt-2">
        Questions? Email{" "}
        <a href="mailto:privacy@autoaccounts.app" className="underline hover:text-foreground">
          privacy@autoaccounts.app
        </a>
        {" "}or read our{" "}
        <a href="/privacy" className="underline hover:text-foreground">Privacy Policy</a>.
      </p>
    </div>
  );
}
