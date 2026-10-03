"use client";

// Settings → Backup to Google Drive: connect, set the backup password, see
// when the last backup ran, back up now, restore, disconnect. All of it runs
// in the desktop shell (desktop/backup); a browser build only shows a notice.

import { useCallback, useEffect, useState } from "react";
import { CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { getBackup, type BackupStatus } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RestoreDialog } from "@/components/backup/restore-dialog";

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <CloudUpload className="h-4 w-4 text-muted-foreground" />
        </div>
        <h2 className="font-semibold">Backup to Google Drive</h2>
      </div>
      <div className="space-y-4 text-sm">{children}</div>
    </div>
  );
}

export function BackupCard() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const refresh = useCallback(async () => {
    const b = getBackup();
    if (!b) return;
    try {
      setStatus(await b.status());
    } catch {
      // Keep showing the last known status.
    }
  }, []);

  useEffect(() => {
    setIsDesktop(getBackup() !== undefined);
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  if (isDesktop === null) return null; // first render (SSR) — avoid a flash
  if (!isDesktop) {
    return (
      <Shell>
        <p className="text-muted-foreground">Available in the Trivio desktop app.</p>
      </Shell>
    );
  }
  const b = getBackup()!;
  if (!status) return null;

  if (!status.configured) {
    return (
      <Shell>
        <p className="text-muted-foreground">Google Drive backup isn&apos;t configured in this build.</p>
      </Shell>
    );
  }

  if (status.restoreRollbackFailed) {
    return (
      <Shell>
        <p role="alert" className="text-destructive">
          A restore couldn&apos;t be completed and your previous data was set aside safely. Backups and restores are
          paused — please contact support.
        </p>
      </Shell>
    );
  }

  if (!status.connected) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          Encrypted daily backups of your books and attachments to your own Google Drive. Trivio can only see
          the files it creates there.
        </p>
        <Button disabled={busy} onClick={() => run(() => b.connect(), "Google Drive connected")}>
          Connect Google Drive
        </Button>
      </Shell>
    );
  }

  if (!status.passwordSet) {
    const tooShort = pw.normalize("NFC").length < 8;
    return (
      <Shell>
        <p>
          Connected as <strong>{status.email}</strong>. Choose a backup password.
        </p>
        <p className="text-muted-foreground">
          Backups are encrypted with it. <strong>If you forget it, your backups can&apos;t be restored</strong> — Trivio
          and Google can&apos;t recover it.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="backup-pw">Backup password</Label>
            <Input id="backup-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backup-pw2">Type it again</Label>
            <Input id="backup-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
        </div>
        {pw2 && pw !== pw2 && <p className="text-destructive">The passwords don&apos;t match.</p>}
        {tooShort && pw && <p className="text-muted-foreground text-xs">At least 8 characters.</p>}
        <Button
          disabled={busy || tooShort || pw !== pw2}
          onClick={() =>
            run(async () => {
              await b.setPassword(pw);
              setPw("");
              setPw2("");
              await b.backupNow();
            }, "Backup password set — first backup done")
          }
        >
          Set password and back up
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <p>
        Connected as <strong>{status.email}</strong>. Backs up once a day while Trivio is open, if anything
        changed, and keeps the last 10.
      </p>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-0.5">Last backup</dt>
          <dd>{when(status.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-0.5">Kept in Drive</dt>
          <dd>{status.keptCount}</dd>
        </div>
      </dl>
      {status.lastError && (
        <p role="alert" className="text-destructive">
          Last backup failed: {status.lastError.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {status.lastError?.code === "AUTH_REVOKED" ? (
          <Button disabled={busy} onClick={() => run(() => b.connect(), "Google Drive reconnected")}>
            Reconnect Google Drive
          </Button>
        ) : (
          <Button disabled={busy || status.running !== null} onClick={() => run(() => b.backupNow(), "Backed up")}>
            {status.running === "backup" || busy ? "Backing up…" : "Back up now"}
          </Button>
        )}
        <Button variant="outline" disabled={busy || status.running !== null} onClick={() => setRestoreOpen(true)}>
          Restore…
        </Button>
        <Button
          variant="ghost"
          disabled={busy || status.running !== null}
          onClick={() => run(() => b.disconnect(), "Disconnected. Your backups stay in Google Drive.")}
        >
          Disconnect
        </Button>
      </div>
      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} confirmReplace />
    </Shell>
  );
}
