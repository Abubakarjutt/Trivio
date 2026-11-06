"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { getDesktop } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// Must match PRIVACY_FULL_DISK_ACCESS_URL in desktop/external-url.ts: the main
// process opens only that exact non-http URL.
const FULL_DISK_ACCESS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

type Access = "ok" | "no_access" | "missing" | "error";
const ACCESS_TEXT: Record<Exclude<Access, "ok">, string> = {
  no_access: "Trivio can't read Messages yet. Turn on Full Disk Access for Trivio, then click Check again.",
  missing: "Messages isn't set up on this Mac. Sign in to Messages with your Apple ID first.",
  error: "Couldn't read Messages. Try again in a minute.",
};

function timeAgo(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function SmsImportCard() {
  const utils = trpc.useUtils();
  const { data } = trpc.smsImport.getSource.useQuery();
  const [draft, setDraft] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [showSuggest, setShowSuggest] = useState(false);

  const save = trpc.smsImport.saveSource.useMutation({
    onSuccess: () => utils.smsImport.getSource.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const check = trpc.smsImport.checkAccess.useMutation({
    onSuccess: (r) => {
      setAccess(r);
      void utils.smsImport.getSource.invalidate();
    },
  });
  const suggestions = trpc.smsImport.suggestSenders.useQuery(undefined, {
    enabled: showSuggest,
    retry: false,
  });

  if (!data?.platformSupported) return null;

  const source = data.source;
  const senders = source?.senderIds ?? [];
  const enabled = source?.enabled ?? true;
  const hasAccess = access === "ok" || (access === null && source?.status === "ACTIVE" && !!source.lastSyncedAt);
  const setSenders = (next: string[]) => save.mutate({ senderIds: next, enabled });
  const addSender = (id: string) => {
    if (save.isPending) return;
    const v = id.trim();
    if (v && !senders.includes(v)) setSenders([...senders, v]);
    setDraft("");
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <span className="text-sm">📱</span>
        </div>
        <div>
          <h2 className="font-semibold text-sm">SMS Import</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Trivio reads your bank&apos;s SMS alerts on this Mac and asks you to approve each transaction.
          </p>
        </div>
      </div>

      <ol className="space-y-3 text-xs">
        <li className="space-y-1">
          <p className="font-semibold text-foreground">1. Send iPhone texts to this Mac</p>
          <p className="text-muted-foreground">
            On your iPhone: Settings → Messages → <span className="font-medium text-foreground">Text Message Forwarding</span> → turn on this Mac.
          </p>
        </li>

        <li className="space-y-1.5">
          <p className="font-semibold text-foreground">
            2. Allow Trivio to read Messages {hasAccess && <span className="text-emerald-600">✓</span>}
          </p>
          <p className="text-muted-foreground">
            System Settings → Privacy &amp; Security → <span className="font-medium text-foreground">Full Disk Access</span> → turn on Trivio.
          </p>
          <div className="flex gap-2">
            {getDesktop() && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => getDesktop()?.openExternal(FULL_DISK_ACCESS_URL)}>
                Open System Settings
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => check.mutate()} disabled={check.isPending}>
              {check.isPending ? "Checking…" : "Check again"}
            </Button>
          </div>
          {access && access !== "ok" && <p className="text-red-600">{ACCESS_TEXT[access]}</p>}
        </li>

        <li className="space-y-1.5">
          <p className="font-semibold text-foreground">
            3. Your bank&apos;s SMS senders {senders.length > 0 && <span className="text-emerald-600">✓</span>}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {senders.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono">
                {s}
                <button type="button" aria-label={`Remove ${s}`} className="text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={save.isPending}
                  onClick={() => setSenders(senders.filter((x) => x !== s))}>×</button>
              </span>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addSender(draft); }}>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. HBL or 8250" className="h-7 text-xs" maxLength={64} />
            <Button type="submit" size="sm" variant="outline" className="h-7 text-xs" disabled={!draft.trim() || save.isPending}>Add</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSuggest((v) => !v)}>
              Suggest senders
            </Button>
          </form>
          {showSuggest && (
            <div className="rounded-lg border border-border/40 bg-muted/30 p-2 space-y-1">
              {suggestions.isLoading && <p className="text-muted-foreground">Looking at the last 30 days…</p>}
              {suggestions.error && <p className="text-red-600">{suggestions.error.message}</p>}
              {suggestions.data?.length === 0 && <p className="text-muted-foreground">No likely bank senders found.</p>}
              {suggestions.data?.map((s) => (
                <label key={s.sender} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={senders.includes(s.sender)} disabled={save.isPending}
                    onChange={(e) => (e.target.checked ? addSender(s.sender) : setSenders(senders.filter((x) => x !== s.sender)))} />
                  <span>
                    <span className="font-mono font-medium text-foreground">{s.sender}</span>
                    <span className="text-muted-foreground"> · {s.count} msg · “{s.lastText}”</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </li>
      </ol>

      <div className="flex items-center justify-between border-t border-border/40 pt-3 text-xs">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={enabled} disabled={save.isPending} onChange={(e) => save.mutate({ senderIds: senders, enabled: e.target.checked })} />
          Import SMS automatically
        </label>
        <span className={source?.status && source.status !== "ACTIVE" ? "text-red-600" : "text-muted-foreground"}>
          {source?.status === "NO_ACCESS" ? ACCESS_TEXT.no_access
            : source?.status === "ERROR" ? (source.lastError ?? ACCESS_TEXT.error)
            : source?.lastSyncedAt ? `Last checked ${timeAgo(new Date(source.lastSyncedAt))} · ${data.approvedCount} imported`
            : "Not checked yet"}
        </span>
      </div>
    </div>
  );
}
