"use client";

// Restore a Google Drive backup: (connect / choose the folder if needed) → pick a backup → enter
// its password → (confirm replacing current data) → progress. On success the
// desktop shell restarts the app server and loads the login page itself, so
// this dialog never "finishes" in place.

import { useEffect, useState } from "react";
import { getBackup, type BackupEntry, type BackupProgress } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PHASE_LABEL: Record<BackupProgress["phase"], string> = {
  dumping: "Reading your data…",
  encrypting: "Encrypting…",
  uploading: "Uploading…",
  pruning: "Tidying old backups…",
  downloading: "Downloading backup…",
  decrypting: "Unlocking backup…",
  restoring: "Restoring your data…",
  restarting: "Restarting Trivio…",
  done: "Done",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function fmtSize(bytes: number) {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

type Step = "connect" | "pick" | "confirm" | "working" | "paused";

// Shown when a restore could not be undone (status.restoreRollbackFailed).
export const ROLLBACK_FAILED_TEXT =
  "A restore couldn't be completed and your previous data was set aside safely. Restores are paused — please contact support.";

// Google access is missing or was revoked: the fix is to (re)connect.
const NEEDS_CONNECT = new Set(["AUTH_REVOKED", "NOT_CONNECTED", "FOLDER_MISSING"]);
const codeOf = (e: unknown) => (e as { code?: string }).code;

export function RestoreDialog({
  open,
  onOpenChange,
  confirmReplace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirmReplace: boolean; // Settings: there is data to replace
}) {
  const backup = getBackup();
  const [step, setStep] = useState<Step>("pick");
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<BackupProgress["phase"] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [folderMode, setFolderMode] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  function reset() {
    setStep("pick");
    setEntries(null);
    setChosen(null);
    setPassword("");
    setError(null);
    setPhase(null);
    setConnecting(false);
  }

  async function load() {
    if (!backup) return;
    setError(null);
    setEntries(null);
    try {
      const s = await backup.status();
      setFolderMode(s.mode === "folder");
      setSuggestion(s.suggestion);
      if (s.restoreRollbackFailed) {
        setStep("paused");
        return;
      }
      if (!s.connected) {
        setStep("connect");
        return;
      }
      setStep("pick");
      const list = await backup.list();
      setEntries(list);
      setChosen(list[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
      if (NEEDS_CONNECT.has(codeOf(e) ?? "")) setStep("connect");
    }
  }

  useEffect(() => {
    reset(); // fresh state on open and on close (drops the typed password)
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => backup?.onProgress((p) => setPhase(p.phase)), [backup]);

  async function connect(choose = false) {
    if (!backup || connecting) return;
    setError(null);
    setConnecting(true);
    try {
      await backup.connect({ choose });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function restore() {
    if (!backup || !chosen) return;
    setError(null);
    setStep("working");
    setPhase("downloading");
    try {
      await backup.restore(chosen, password);
    } catch (e) {
      setPhase(null);
      if (codeOf(e) === "RESTORE_FAILED") {
        // "your data was not changed" is wrong if the rollback itself failed.
        const s = await backup.status().catch(() => null);
        if (s?.restoreRollbackFailed) {
          setError(null);
          setStep("paused");
          return;
        }
      }
      setError((e as Error).message);
      setStep("pick");
    }
  }

  const busy = step === "working";
  const chosenEntry = entries?.find((b) => b.id === chosen);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore from Google Drive</DialogTitle>
          <DialogDescription>
            {confirmReplace
              ? "Replaces all data on this computer with a backup."
              : "Set up this computer from one of your backups."}
          </DialogDescription>
        </DialogHeader>

        {step === "connect" && !folderMode && (
          <div className="space-y-3 text-sm">
            <p>Sign in with the Google account your backups are in.</p>
            <Button disabled={connecting} onClick={() => void connect()}>
              Connect Google Drive
            </Button>
          </div>
        )}

        {step === "connect" && folderMode && (
          <div className="space-y-3 text-sm">
            <p>
              {suggestion
                ? `Use the Google Drive account on this computer (${suggestion}), or choose the folder your backups are in.`
                : "Install Google Drive for desktop and sign in with the Google account your backups are in, or choose the folder your backups are in."}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestion && (
                <Button disabled={connecting} onClick={() => void connect()}>
                  Use Google Drive
                </Button>
              )}
              <Button
                variant={suggestion ? "outline" : "default"}
                disabled={connecting}
                onClick={() => void connect(true)}
              >
                Choose folder…
              </Button>
              {!suggestion && (
                <Button variant="outline" disabled={connecting} onClick={() => void load()}>
                  Check again
                </Button>
              )}
            </div>
          </div>
        )}

        {step === "pick" && (
          <div className="space-y-4 text-sm">
            {entries === null && error ? (
              <Button variant="outline" onClick={() => void load()}>
                Try again
              </Button>
            ) : entries === null ? (
              <p className="text-muted-foreground">Loading backups…</p>
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground">
                {folderMode
                  ? "No Trivio backups found in this folder."
                  : "No backups found in this Google account."}
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label="Backups"
                className="max-h-56 space-y-1 overflow-y-auto"
              >
                {entries.map((b) => (
                  <label
                    key={b.id}
                    className="border-border/40 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <input
                      type="radio"
                      name="backup"
                      checked={chosen === b.id}
                      onChange={() => setChosen(b.id)}
                    />
                    <span className="flex-1">{fmtDate(b.createdAt)}</span>
                    <span className="text-muted-foreground text-xs">
                      {fmtSize(b.sizeBytes)}
                      {b.appVersion ? ` · v${b.appVersion}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {folderMode && entries !== null && (
              <Button
                variant="link"
                className="h-auto p-0"
                disabled={connecting}
                onClick={() => void connect(true)}
              >
                Look in another folder…
              </Button>
            )}
            {entries && entries.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="restore-password">Backup password</Label>
                <Input
                  id="restore-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {step === "confirm" && chosenEntry && (
          <p className="text-sm">
            This replaces <strong>all data on this computer</strong> with the backup from{" "}
            {fmtDate(chosenEntry.createdAt)}. Your current data is kept on this computer for about a
            week.
          </p>
        )}

        {step === "paused" && (
          <p className="text-destructive text-sm" role="alert">
            {ROLLBACK_FAILED_TEXT}
          </p>
        )}

        {step === "working" && (
          <p className="text-sm" role="status" aria-live="polite">
            {phase ? PHASE_LABEL[phase] : "Working…"}
          </p>
        )}

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          {step === "pick" && entries && entries.length > 0 && (
            <Button
              disabled={!chosen || password.length === 0}
              onClick={() => (confirmReplace ? setStep("confirm") : void restore())}
            >
              Restore
            </Button>
          )}
          {step === "confirm" && chosenEntry && (
            <>
              <Button variant="outline" onClick={() => setStep("pick")}>
                Back
              </Button>
              <Button variant="destructive" onClick={() => void restore()}>
                Replace my data
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
