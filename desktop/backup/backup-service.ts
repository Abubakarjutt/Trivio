// The backup feature's brain: when to back up, what goes in a backup, how
// many to keep, and how to restore one. Every outside effect (Google, Drive,
// Postgres, the app server, notifications, the clock) is injected, so the
// whole flow is unit-tested with fakes. desktop/backup/wire.ts builds the real
// thing. See docs/superpowers/specs/2026-10-02-google-drive-backup-design.md.

import { randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";
import { attachmentsFingerprint, backupFileName, packBackup, unpackBackup } from "./archive";
import type { DriveLike } from "./drive-client";
import { BackupError, toBackupError } from "./errors";
import { DEFAULT_SCRYPT, checkVerifier, derivePwKey, makeVerifier, normalizePassword, type ScryptParams } from "./keys";
import type { SecretStoreLike } from "./secret-store";
import { loadState, saveState, type BackupState } from "./state";

const DAY = 24 * 3600_000;
const NOTIFY_AFTER = 48 * 3600_000;
const KEEP = 10;

export interface AuthLike {
  connect(): Promise<{ email: string }>;
  disconnect(): Promise<void>;
}

export interface DbLike {
  dump(outPath: string): Promise<void>;
  fingerprint(): Promise<string>;
  appliedMigrations(): Promise<string[]>;
  restore(dumpPath: string): Promise<void>; // into trivio_restore (recreated)
  swapIn(): Promise<void>; // trivio→trivio_before_restore, trivio_restore→trivio
  undoSwap(): Promise<void>; // the reverse
  dropRestoreLeftovers(): Promise<void>; // drop trivio_restore
  dropPrevious(): Promise<void>; // drop trivio_before_restore
}

export interface ServerLike {
  stop(): Promise<void>;
  start(opts: { signOut: boolean }): Promise<void>;
}

export interface BackupStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  passwordSet: boolean;
  running: "backup" | "restore" | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastCheckedAt: string | null;
  lastError: { code: string; message: string } | null;
  failingSince: string | null;
  keptCount: number;
  restoreRollbackFailed: boolean; // a restore could not be undone; the old data is kept aside, contact support
}

export type BackupProgress = {
  phase:
    | "dumping"
    | "encrypting"
    | "uploading"
    | "pruning"
    | "downloading"
    | "decrypting"
    | "restoring"
    | "restarting"
    | "done";
};

export interface BackupEntry {
  id: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  appVersion: string | null;
}

export interface ServiceDeps {
  dir: string; // userData/backup
  attachmentsDir: string; // userData/storage/attachments
  appVersion: string;
  configured: boolean; // a Google client ID was built in
  secrets: SecretStoreLike;
  auth: AuthLike;
  drive: DriveLike;
  db: DbLike;
  server: ServerLike;
  notify: (title: string, body: string) => void;
  onProgress?: (p: BackupProgress) => void;
  now?: () => Date;
  scrypt?: ScryptParams;
  keep?: number;
}

export class BackupService {
  private state!: BackupState;
  private pwKey: Buffer | null = null;
  private running: { kind: "backup" | "restore"; forced?: boolean; promise: Promise<void> } | null = null;
  private saveChain: Promise<void> = Promise.resolve(); // serialises state.json writes
  private timers: NodeJS.Timeout[] = [];
  private schedule: { everyMs: number; firstAfterMs: number } | null = null; // remembered so connect() can resume it

  constructor(private readonly d: ServiceDeps) {}

  private get stateFile() {
    return join(this.d.dir, "state.json");
  }
  private get tmp() {
    return join(this.d.dir, "tmp");
  }
  private now(): Date {
    return this.d.now ? this.d.now() : new Date();
  }
  private progress(phase: BackupProgress["phase"]) {
    this.d.onProgress?.({ phase });
  }
  private async update(patch: Partial<BackupState>): Promise<void> {
    this.state = { ...this.state, ...patch };
    const snapshot = this.state;
    const save = this.saveChain.then(async () => {
      await fsp.mkdir(this.d.dir, { recursive: true });
      await saveState(this.stateFile, snapshot);
    });
    this.saveChain = save.catch(() => {});
    await save;
  }

  async init(): Promise<void> {
    this.state = await loadState(this.stateFile);
    await fsp.rm(this.tmp, { recursive: true, force: true });
    let stored: string | null = null;
    try {
      stored = await this.d.secrets.load("key");
    } catch (err) {
      // Unreadable key: leave pwKey null so the UI asks for the password again.
      console.warn("[backup] could not read the saved backup key:", err instanceof Error ? err.message : err);
    }
    if (stored && this.state.verifier) {
      const key = Buffer.from(stored, "base64");
      if (checkVerifier(key, this.state.verifier)) this.pwKey = key;
    }
  }

  startSchedule(everyMs = 3600_000, firstAfterMs = 60_000): void {
    this.schedule = { everyMs, firstAfterMs };
    const run = () => void this.tick();
    const first = setTimeout(run, firstAfterMs);
    const every = setInterval(run, everyMs);
    first.unref?.();
    every.unref?.();
    this.timers.push(first, every);
  }

  stopSchedule(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  status(): BackupStatus {
    const s = this.state;
    return {
      configured: this.d.configured,
      connected: !!s.email,
      email: s.email,
      passwordSet: !!this.pwKey,
      running: this.running?.kind ?? null,
      lastSuccessAt: s.lastSuccessAt,
      lastAttemptAt: s.lastAttemptAt,
      lastCheckedAt: s.lastCheckedAt,
      lastError: s.lastError,
      failingSince: s.failingSince,
      keptCount: s.keptCount,
      restoreRollbackFailed: !!s.restoreRollbackFailed,
    };
  }

  async connect(): Promise<{ email: string }> {
    if (!this.d.configured) throw new BackupError("NOT_CONFIGURED");
    const { email } = await this.d.auth.connect();
    await this.update({ email, lastError: null });
    // disconnect() stops the schedule; a later reconnect resumes it.
    if (this.schedule && this.timers.length === 0) this.startSchedule(this.schedule.everyMs, this.schedule.firstAfterMs);
    return { email };
  }

  async setPassword(password: string): Promise<void> {
    if (this.running?.kind === "restore") throw new BackupError("BUSY");
    if (normalizePassword(password).length < 8) throw new BackupError("WEAK_PASSWORD");
    if (!this.state.email) throw new BackupError("NOT_CONNECTED");
    const params = this.d.scrypt ?? DEFAULT_SCRYPT;
    const pwSalt = randomBytes(16);
    await this.adoptKey(await derivePwKey(password, pwSalt, params), pwSalt, params);
  }

  private async adoptKey(key: Buffer, pwSalt: Buffer, params: ScryptParams): Promise<void> {
    await this.d.secrets.save("key", key.toString("base64"));
    this.pwKey = key;
    await this.update({ pwSalt: pwSalt.toString("base64"), scrypt: params, verifier: makeVerifier(key) });
  }

  isDue(): boolean {
    if (!this.d.configured || !this.state.email || !this.pwKey) return false;
    if (this.state.lastError?.code === "AUTH_REVOKED") return false;
    const now = this.now().getTime();
    const last = this.state.lastSuccessAt ? Date.parse(this.state.lastSuccessAt) : NaN;
    if (Number.isNaN(last) || last > now) return true;
    return now - last >= DAY;
  }

  async tick(): Promise<void> {
    if (this.running || !this.isDue()) return;
    await this.runBackup(false).catch(() => {}); // recorded in state; shown in Settings
  }

  async backupNow(): Promise<BackupStatus> {
    if (this.running?.kind === "restore") throw new BackupError("BUSY");
    await this.runBackup(true);
    return this.status();
  }

  private runBackup(force: boolean): Promise<void> {
    const current = this.running;
    if (current?.kind === "backup") {
      if (!force || current.forced) return current.promise;
      // A forced request behind a scheduled run: chain, never run two at once.
      // Skip the extra upload if the run in flight already uploaded.
      const before = this.state.lastSuccessAt;
      const chained = current.promise
        .catch(() => {})
        .then(() => (this.state.lastSuccessAt !== before ? undefined : this.doBackup(true)))
        .finally(() => {
          if (this.running === entry) this.running = null;
        });
      const entry = { kind: "backup" as const, forced: true, promise: chained };
      this.running = entry;
      return chained;
    }
    const promise: Promise<void> = this.doBackup(force).finally(() => {
      if (this.running === entry) this.running = null;
    });
    const entry = { kind: "backup" as const, forced: force, promise };
    this.running = entry;
    return promise;
  }

  private requireReady(): void {
    if (!this.d.configured) throw new BackupError("NOT_CONFIGURED");
    if (!this.state.email) throw new BackupError("NOT_CONNECTED");
    if (!this.pwKey || !this.state.pwSalt || !this.state.scrypt) throw new BackupError("NO_PASSWORD");
  }

  private async doBackup(force: boolean): Promise<void> {
    this.requireReady();
    const startedAt = this.now();
    const work = join(this.tmp, `backup-${startedAt.getTime()}`);
    try {
      const fingerprint = `${await this.d.db.fingerprint()}|${await attachmentsFingerprint(this.d.attachmentsDir)}`;
      if (!force && fingerprint === this.state.fingerprint) {
        await this.update({ lastCheckedAt: startedAt.toISOString() });
        return;
      }
      await this.update({ lastAttemptAt: startedAt.toISOString() });
      await fsp.mkdir(work, { recursive: true });

      this.progress("dumping");
      const dumpPath = join(work, "db.dump");
      try {
        await this.d.db.dump(dumpPath);
      } catch (err) {
        throw toBackupError(err, "DUMP_FAILED");
      }
      const latestMigration = (await this.d.db.appliedMigrations()).at(-1) ?? "";

      this.progress("encrypting");
      const name = backupFileName(startedAt);
      const outPath = join(work, name);
      await packBackup({
        workDir: work,
        dumpPath,
        attachmentsDir: this.d.attachmentsDir,
        appVersion: this.d.appVersion,
        latestMigration,
        now: startedAt,
        key: { pwKey: this.pwKey!, pwSalt: Buffer.from(this.state.pwSalt!, "base64"), params: this.state.scrypt! },
        outPath,
      });

      this.progress("uploading");
      const folderId = await this.d.drive.ensureFolder(this.state.folderId);
      if (folderId !== this.state.folderId) await this.update({ folderId });
      const uploaded = await this.d.drive.upload(folderId, name, outPath, this.d.appVersion);
      const { size } = await fsp.stat(outPath);
      if (uploaded.size !== size) {
        throw new BackupError("BACKUP_FAILED", `Drive has ${uploaded.size} bytes, expected ${size}`);
      }

      // The upload is confirmed: from here on the run is a success. Prune and
      // cleanup failures are only logged, never recorded as a failed backup.
      this.progress("pruning");
      const keep = this.d.keep ?? KEEP;
      let kept = Math.min(this.state.keptCount + 1, keep);
      try {
        const others = (await this.d.drive.list(folderId)).filter((f) => f.id !== uploaded.id);
        kept = 1 + others.length;
        for (const old of others.slice(keep - 1)) {
          try {
            await this.d.drive.delete(old.id);
            kept--;
          } catch (err) {
            console.warn("[backup] could not delete an old backup:", err instanceof Error ? err.message : err);
          }
        }
      } catch (err) {
        console.warn("[backup] could not prune old backups:", err instanceof Error ? err.message : err);
      }
      let cleanupPending = this.state.cleanupPending;
      if (cleanupPending && !this.state.restoreRollbackFailed) {
        try {
          await this.dropRestoreLeftovers();
          cleanupPending = false;
        } catch (err) {
          console.warn("[backup] could not drop restore leftovers:", err instanceof Error ? err.message : err);
        }
      }

      const doneAt = this.now().toISOString();
      await this.update({
        lastSuccessAt: doneAt,
        lastCheckedAt: doneAt,
        fingerprint,
        lastError: null,
        failingSince: null,
        failureNotified: false,
        keptCount: kept,
        cleanupPending,
      });
    } catch (err) {
      const e = toBackupError(err, "BACKUP_FAILED");
      const now = this.now();
      const failingSince = this.state.failingSince ?? now.toISOString();
      const notify = !this.state.failureNotified && now.getTime() - Date.parse(failingSince) >= NOTIFY_AFTER;
      try {
        await this.update({
          lastAttemptAt: now.toISOString(),
          lastError: { code: e.code, message: e.userMessage },
          failingSince,
          failureNotified: this.state.failureNotified || notify,
        });
      } catch (saveErr) {
        console.warn("[backup] could not record the failure:", saveErr instanceof Error ? saveErr.message : saveErr);
      }
      if (notify) this.d.notify("Trivio backups are failing", `${e.userMessage} Open Settings → Backup for details.`);
      console.error("[backup] failed:", e.message);
      throw e;
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
      this.progress("done"); // "run finished", success or failure, so the UI never sticks on "Backing up…"
    }
  }

  private async dropRestoreLeftovers(): Promise<void> {
    await this.d.db.dropPrevious();
    await fsp.rm(`${this.d.attachmentsDir}_before_restore`, { recursive: true, force: true });
  }

  async list(): Promise<BackupEntry[]> {
    if (!this.state.email) throw new BackupError("NOT_CONNECTED");
    const folderId = await this.d.drive.ensureFolder(this.state.folderId);
    if (folderId !== this.state.folderId) await this.update({ folderId });
    return (await this.d.drive.list(folderId)).map((f) => ({
      id: f.id,
      name: f.name,
      createdAt: f.createdTime,
      sizeBytes: f.size,
      appVersion: f.appVersion,
    }));
  }

  // Resolves when no backup/restore is in flight (errors are the caller's, not ours).
  async whenIdle(): Promise<void> {
    while (this.running) await this.running.promise.catch(() => {});
  }

  restore(id: string, password: string): Promise<void> {
    if (this.running) return Promise.reject(new BackupError("BUSY"));
    if (this.state.restoreRollbackFailed) {
      return Promise.reject(new BackupError("RESTORE_FAILED", "an earlier restore could not be rolled back"));
    }
    const promise: Promise<void> = this.doRestore(id, password)
      .catch((err) => {
        throw toBackupError(err, "RESTORE_FAILED");
      })
      .finally(() => {
        if (this.running === entry) this.running = null;
      });
    const entry = { kind: "restore" as const, promise };
    this.running = entry;
    return promise;
  }

  private async doRestore(id: string, password: string): Promise<void> {
    if (!this.state.email) throw new BackupError("NOT_CONNECTED");
    const work = join(this.tmp, `restore-${this.now().getTime()}`);
    await fsp.mkdir(work, { recursive: true });
    try {
      this.progress("downloading");
      const src = join(work, "backup.trivio-backup");
      await this.d.drive.download(id, src);

      this.progress("decrypting");
      const unpacked = await unpackBackup({
        srcPath: src,
        workDir: work,
        getPwKey: (h) => derivePwKey(password, h.pwSalt, h.params),
      });
      const known = await this.d.db.appliedMigrations();
      const needs = unpacked.manifest.latestMigration;
      if (needs && !known.includes(needs)) throw new BackupError("NEWER_BACKUP");

      // Restore into the side database while the app keeps running.
      this.progress("restoring");
      try {
        await this.d.db.restore(unpacked.dumpPath);
      } catch (err) {
        await this.d.db.dropRestoreLeftovers().catch(() => {});
        throw new BackupError("RESTORE_FAILED", err instanceof Error ? err.message : String(err));
      }

      // Swap: attachments first (plain renames), then both databases in one transaction.
      const live = this.d.attachmentsDir;
      const previous = `${live}_before_restore`;
      let liveMoved = false;
      let newInPlace = false;
      let swapped = false;
      // Every rollback step is attempted on its own; the server is always restarted.
      const rollback = async (err: unknown): Promise<never> => {
        const failures: unknown[] = [];
        // A failed step that leaves a *_before_restore copy as the only original must
        // block every later cleanup and restore (update() keeps it in memory even if the write fails).
        let originalAtRisk = false;
        const step = async (fn: () => Promise<unknown>, keepsOnlyOriginal = false) => {
          try {
            await fn();
          } catch (e) {
            failures.push(e);
            if (keepsOnlyOriginal) originalAtRisk = true;
          }
        };
        if (swapped) {
          await step(() => this.d.db.undoSwap(), true);
          if (originalAtRisk) console.error("[backup] ROLLBACK FAILED: could not undo the database swap; trivio_before_restore is kept");
        }
        await step(() => this.d.db.dropRestoreLeftovers());
        if (newInPlace) await step(() => fsp.rm(live, { recursive: true, force: true }), true);
        if (liveMoved) await step(() => fsp.rename(previous, live), true);
        if (originalAtRisk) {
          await step(() => this.update({ restoreRollbackFailed: true }));
          this.state.restoreRollbackFailed = true;
        }
        await step(() => this.d.server.start({ signOut: false }));
        for (const f of failures) console.error("[backup] restore rollback step failed:", f);
        throw new BackupError("RESTORE_FAILED", err instanceof Error ? err.message : String(err));
      };
      try {
        await this.d.server.stop();
        await fsp.rm(previous, { recursive: true, force: true });
        await fsp.mkdir(dirname(live), { recursive: true });
        try {
          await fsp.rename(live, previous);
          liveMoved = true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        await fsp.rename(unpacked.attachmentsDir, live);
        newInPlace = true;
        await this.d.db.swapIn();
        swapped = true;
        // The kept-aside copies only become leftovers once the swap succeeded; recording it
        // earlier would let a later backup delete the only original after a failed swap.
        await this.update({ cleanupPending: true });
      } catch (err) {
        return await rollback(err);
      }

      this.progress("restarting");
      try {
        await this.d.server.start({ signOut: true });
      } catch (err) {
        // The restored database wouldn't start (e.g. its migration failed): put everything back.
        await this.d.server.stop().catch(() => {});
        return await rollback(err);
      }

      // The restored data is live: everything below is post-commit and must not fail the restore.
      try {
        await this.update({ cleanupPending: true, fingerprint: null, lastError: null });
      } catch (err) {
        console.error("[backup] could not record the restore in state:", err);
      }
      try {
        await this.adoptKey(unpacked.pwKey, unpacked.pwSalt, unpacked.params);
      } catch (err) {
        console.error("[backup] restored, but could not save the backup key; the password will be asked again:", err);
      }
      this.progress("done");
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
    }
  }

  async disconnect(): Promise<void> {
    if (this.running) throw new BackupError("BUSY");
    await this.d.auth.disconnect();
    await this.d.secrets.clear("key");
    this.pwKey = null;
    await this.update({
      email: null,
      folderId: null,
      pwSalt: null,
      scrypt: null,
      verifier: null,
      fingerprint: null,
      lastError: null,
      failingSince: null,
      failureNotified: false,
    });
    this.stopSchedule(); // last, so a failed disconnect keeps backups running
  }
}
