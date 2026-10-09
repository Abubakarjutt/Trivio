// Electron-side glue for the backup feature: builds BackupService from the
// real Google / Drive / Postgres / server pieces and exposes it over IPC.
// Everything with logic lives in the (unit-tested) modules next to this file.

import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseHandle } from "../embedded/embedded-db";
import { BackupService, type AuthLike, type BackupProgress, type BackupStatus, type ServerLike } from "./backup-service";
import { DriveClient, type DriveLike } from "./drive-client";
import { BackupError } from "./errors";
import { FolderAuth, FolderDrive, findGoogleDriveFolders } from "./folder-target";
import { GoogleAuth } from "./google-auth";
import {
  appliedMigrations, connFromConfig, createDatabase, dataFingerprint, dropDatabase, dumpDatabase,
  restoreDatabase, swapDatabases,
} from "./pg-tools";
import { FileSecretStore } from "./secret-store";

// Injected at build time by desktop/build-electron.mjs (GitHub secrets for
// releases, .env.local for local builds). Empty → backups go to a synced
// folder instead (the Google Drive app's, auto-detected), like WhatsApp
// borrowing the phone's own Google account. See folder-target.ts.
const GOOGLE_CLIENT = {
  clientId: process.env.TRIVIO_GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.TRIVIO_GOOGLE_CLIENT_SECRET ?? "",
};

const RESTORE_DB = "trivio_restore";
const PREVIOUS_DB = "trivio_before_restore";
const DISCARD_DB = "trivio_discard"; // a second restore's replaced data, while trivio_before_restore is kept

export async function createBackupService(o: {
  userData: string;
  attachmentsDir: string;
  db: DatabaseHandle;
  server: ServerLike;
  onProgress: (p: BackupProgress) => void;
}): Promise<BackupService> {
  if (!o.db.config) throw new Error("backup needs the embedded database");
  const conn = connFromConfig(o.db.config);
  const dir = join(o.userData, "backup");
  const secrets = new FileSecretStore(dir, safeStorage);
  const googleMode = Boolean(GOOGLE_CLIENT.clientId && GOOGLE_CLIENT.clientSecret);
  let auth: AuthLike;
  let drive: DriveLike;
  let suggestion: (() => string | null) | undefined;
  if (googleMode) {
    const google = new GoogleAuth(GOOGLE_CLIENT, secrets, { openExternal: (url) => shell.openExternal(url) });
    auth = google;
    drive = new DriveClient({ token: () => google.accessToken(), onUnauthorized: () => google.forgetAccessToken() });
  } else {
    const folder = new FolderAuth({
      file: join(dir, "folder.json"),
      detect: () => findGoogleDriveFolders({ platform: process.platform, home: homedir() }),
      pick: async (defaultPath) => {
        const opts: Electron.OpenDialogOptions = {
          title: "Choose where to keep Trivio backups",
          buttonLabel: "Use this folder",
          defaultPath,
          properties: ["openDirectory", "createDirectory"],
        };
        const win = BrowserWindow.getFocusedWindow();
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
    });
    auth = folder;
    drive = new FolderDrive(() => folder.root());
    suggestion = () => folder.suggestion()?.label ?? null;
  }
  const service = new BackupService({
    dir,
    attachmentsDir: o.attachmentsDir,
    appVersion: app.getVersion(),
    configured: true,
    mode: googleMode ? "google" : "folder",
    suggestion,
    secrets,
    auth,
    drive,
    db: {
      dump: (out) => dumpDatabase(conn, out),
      fingerprint: () => dataFingerprint(conn),
      appliedMigrations: () => appliedMigrations(conn),
      restore: async (dump) => {
        await dropDatabase(conn, RESTORE_DB);
        await createDatabase(conn, RESTORE_DB);
        await restoreDatabase(conn, RESTORE_DB, dump);
      },
      swapIn: () => swapDatabases(conn, { live: conn.database, incoming: RESTORE_DB, previous: PREVIOUS_DB }),
      undoSwap: () => swapDatabases(conn, { live: conn.database, incoming: PREVIOUS_DB, previous: RESTORE_DB }),
      dropRestoreLeftovers: () => dropDatabase(conn, RESTORE_DB),
      dropPrevious: () => dropDatabase(conn, PREVIOUS_DB),
      swapInKeepingPrevious: () => swapDatabases(conn, { live: conn.database, incoming: RESTORE_DB, previous: DISCARD_DB }),
      undoSwapKeepingPrevious: () => swapDatabases(conn, { live: conn.database, incoming: DISCARD_DB, previous: RESTORE_DB }),
      dropDiscard: () => dropDatabase(conn, DISCARD_DB),
    },
    server: o.server,
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show();
    },
    onProgress: o.onProgress,
  });
  await service.init();
  return service;
}

const UNAVAILABLE: BackupStatus = {
  configured: false,
  mode: "google",
  suggestion: null,
  connected: false,
  email: null,
  passwordSet: false,
  running: null,
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastCheckedAt: null,
  lastError: null,
  failingSince: null,
  keptCount: 0,
  restoreRollbackFailed: false,
};

type Result = { ok: true; value: unknown } | { ok: false; code: string; message: string };

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

const failed = (): Result => {
  const e = new BackupError("BACKUP_FAILED");
  return { ok: false, code: e.code, message: e.userMessage };
};

// getAllowedOrigin: the app server's origin, known only once it has launched.
// Calls from any other page (or before launch) are refused.
export function registerBackupIpc(getService: () => BackupService | null, getAllowedOrigin: () => string | null): void {
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, async (e, ...args): Promise<Result> => {
      const allowed = getAllowedOrigin();
      const sender = originOf(e.senderFrame?.url);
      if (!allowed || sender !== allowed) {
        console.error(`[backup] ${channel} refused: sender ${sender ?? "unknown"} is not the app (${allowed ?? "not started"})`);
        return failed();
      }
      try {
        return { ok: true, value: await fn(...args) };
      } catch (err) {
        console.error(`[backup] ${channel} failed:`, err);
        if (err instanceof BackupError) return { ok: false, code: err.code, message: err.userMessage };
        return failed(); // never show raw internal error text; the detail is logged above
      }
    });
  const svc = () => {
    const s = getService();
    if (!s) throw new BackupError("NOT_CONFIGURED");
    return s;
  };
  handle("backup:status", () => getService()?.status() ?? UNAVAILABLE);
  handle("backup:connect", (opts?: { choose?: unknown }) => svc().connect({ choose: opts?.choose === true }));
  handle("backup:disconnect", () => svc().disconnect());
  handle("backup:setPassword", (pw: string) => svc().setPassword(typeof pw === "string" ? pw : ""));
  handle("backup:backupNow", () => svc().backupNow());
  handle("backup:list", () => svc().list());
  handle("backup:restore", (id: string, pw: string) => svc().restore(typeof id === "string" ? id : "", typeof pw === "string" ? pw : ""));
}
