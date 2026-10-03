// userData/backup/state.json — what Settings → Backup shows instantly on open,
// plus the bits the scheduler needs between launches. Written atomically.

import { promises as fsp } from "node:fs";
import type { BackupErrorCode } from "./errors";
import type { ScryptParams } from "./keys";

export interface BackupState {
  email: string | null;
  folderId: string | null;
  pwSalt: string | null; // base64
  scrypt: ScryptParams | null;
  verifier: string | null;
  lastSuccessAt: string | null; // ISO 8601 UTC
  lastAttemptAt: string | null;
  lastCheckedAt: string | null;
  lastError: { code: BackupErrorCode; message: string } | null;
  failingSince: string | null;
  failureNotified: boolean;
  fingerprint: string | null;
  keptCount: number;
  cleanupPending: boolean; // a restore left trivio_before_restore / attachments_before_restore
  restoredAt?: string | null; // when that restore committed; leftovers are dropped ≥ 7 days later
  restoreRollbackFailed?: boolean; // a restore could not be undone: keep trivio_before_restore, refuse further restores
}

export const EMPTY_STATE: BackupState = {
  email: null,
  folderId: null,
  pwSalt: null,
  scrypt: null,
  verifier: null,
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastCheckedAt: null,
  lastError: null,
  failingSince: null,
  failureNotified: false,
  fingerprint: null,
  keptCount: 0,
  cleanupPending: false,
};

export async function loadState(file: string): Promise<BackupState> {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    return { ...EMPTY_STATE, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function saveState(file: string, state: BackupState): Promise<void> {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
  await fsp.rename(tmp, file);
}
