// Every failure the backup feature reports to the user. The message is shown
// verbatim in Settings → Backup and the restore dialog, so keep it plain.

export type BackupErrorCode =
  | "NOT_CONFIGURED"
  | "NOT_CONNECTED"
  | "NO_PASSWORD"
  | "WEAK_PASSWORD"
  | "BUSY"
  | "WRONG_PASSWORD"
  | "BAD_FORMAT"
  | "NEWER_BACKUP"
  | "OFFLINE"
  | "AUTH_REVOKED"
  | "AUTH_TIMEOUT"
  | "AUTH_CANCELLED"
  | "DRIVE_FULL"
  | "DUMP_FAILED"
  | "BACKUP_FAILED"
  | "RESTORE_FAILED";

const MESSAGES: Record<BackupErrorCode, string> = {
  NOT_CONFIGURED: "Google Drive backup isn't configured in this build.",
  NOT_CONNECTED: "Connect Google Drive first.",
  NO_PASSWORD: "Set a backup password first.",
  WEAK_PASSWORD: "Choose a backup password of at least 8 characters.",
  BUSY: "A backup or restore is already running.",
  WRONG_PASSWORD: "Wrong password or damaged backup.",
  BAD_FORMAT: "This file isn't a Trivio backup, or it is damaged.",
  NEWER_BACKUP: "This backup was made by a newer Trivio. Update Trivio first.",
  OFFLINE: "No connection to Google Drive. Will retry.",
  AUTH_REVOKED: "Reconnect Google Drive.",
  AUTH_TIMEOUT: "Google sign-in timed out. Try again.",
  AUTH_CANCELLED: "Google sign-in was cancelled.",
  DRIVE_FULL: "Google Drive is full.",
  DUMP_FAILED: "Backup failed while reading your data.",
  BACKUP_FAILED: "Backup failed.",
  RESTORE_FAILED: "Restore failed — your data was not changed.",
};

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, detail?: string) {
    super(MESSAGES[code] + (detail ? ` (${detail})` : ""));
    this.name = "BackupError";
    this.code = code;
  }
  get userMessage(): string {
    return MESSAGES[this.code];
  }
}

export function toBackupError(err: unknown, fallback: BackupErrorCode): BackupError {
  if (err instanceof BackupError) return err;
  return new BackupError(fallback, err instanceof Error ? err.message : String(err));
}
