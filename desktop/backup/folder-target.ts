// Backups to a folder instead of the Drive API — the desktop version of how
// WhatsApp uses the phone's own Google account: Trivio writes into the folder
// the Google Drive app (or iCloud Drive, Dropbox, OneDrive, a USB drive) keeps
// in sync, and that app does the uploading. No Google sign-in or developer keys.
//
// FolderAuth remembers which folder was chosen (userData/backup/folder.json);
// FolderDrive keeps the backup files in "<folder>/Trivio Backups".

import { promises as fsp, existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AuthLike } from "./backup-service";
import { BACKUP_SUFFIX, FOLDER_NAME, type DriveFile, type DriveLike } from "./drive-client";
import { BackupError } from "./errors";

export interface FolderChoice {
  label: string; // shown in Settings: "you@gmail.com" for the Google Drive app, else the folder path
  path: string;
}

// The Google Drive app's "My Drive" folders on this computer, best match first.
export function findGoogleDriveFolders(env: { platform: NodeJS.Platform; home: string }): FolderChoice[] {
  const found: FolderChoice[] = [];
  const isDir = (p: string) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  if (env.platform === "darwin") {
    // Google Drive for desktop: ~/Library/CloudStorage/GoogleDrive-<email>/My Drive
    const cloud = join(env.home, "Library", "CloudStorage");
    let entries: string[] = [];
    try {
      entries = readdirSync(cloud);
    } catch {
      // no CloudStorage folder: the Drive app isn't installed
    }
    for (const e of entries.sort()) {
      if (!e.startsWith("GoogleDrive-")) continue;
      const path = join(cloud, e, "My Drive");
      if (isDir(path)) found.push({ label: e.slice("GoogleDrive-".length), path });
    }
    // Older Drive versions mounted a volume instead.
    const legacy = "/Volumes/GoogleDrive/My Drive";
    if (isDir(legacy)) found.push({ label: "Google Drive", path: legacy });
  } else if (env.platform === "win32") {
    // Google Drive for desktop mounts a drive letter (G: by default) with a "My Drive" folder.
    for (const letter of "GDEFHIJKLMNOPQRSTUVWXYZ") {
      const path = `${letter}:\\My Drive`;
      if (existsSync(path) && isDir(path)) found.push({ label: `Google Drive (${letter}:)`, path });
    }
  }
  return found;
}

export class FolderAuth implements AuthLike {
  private cached: FolderChoice | null | undefined; // undefined = not read yet

  constructor(
    private readonly deps: {
      file: string; // userData/backup/folder.json
      detect: () => FolderChoice[];
      pick: (defaultPath: string | undefined) => Promise<string | null>; // a folder dialog; null = cancelled
    },
  ) {}

  // The detected Google Drive folder Settings offers before anything is chosen.
  suggestion(): FolderChoice | null {
    return this.deps.detect()[0] ?? null;
  }

  async connect(opts?: { choose?: boolean }): Promise<{ email: string }> {
    const found = this.deps.detect();
    let choice: FolderChoice | null = !opts?.choose && found.length === 1 ? found[0] : null;
    if (!choice) {
      const path = await this.deps.pick(found[0]?.path);
      if (!path) throw new BackupError("FOLDER_NOT_CHOSEN");
      choice = found.find((f) => f.path === path) ?? { label: path, path };
    }
    await fsp.mkdir(dirname(this.deps.file), { recursive: true });
    await fsp.writeFile(this.deps.file, JSON.stringify(choice, null, 2));
    this.cached = choice;
    return { email: choice.label };
  }

  async disconnect(): Promise<void> {
    await fsp.rm(this.deps.file, { force: true });
    this.cached = null;
  }

  async root(): Promise<string> {
    if (this.cached === undefined) {
      try {
        const parsed = JSON.parse(await fsp.readFile(this.deps.file, "utf8"));
        this.cached = typeof parsed?.path === "string" ? { label: String(parsed.label ?? parsed.path), path: parsed.path } : null;
      } catch {
        this.cached = null;
      }
    }
    if (!this.cached) throw new BackupError("NOT_CONNECTED");
    return this.cached.path;
  }
}

// "trivio-2026-10-04T09-30-00Z.trivio-backup" → "2026-10-04T09:30:00Z"
function createdFromName(name: string): string | null {
  const m = name.match(/^trivio-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.trivio-backup$/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z` : null;
}

// File ids come from the renderer: only a bare backup file name is accepted.
function checkId(id: string): string {
  if (typeof id !== "string" || id !== basename(id) || id.includes("\\") || !id.endsWith(BACKUP_SUFFIX) || id.startsWith(".")) {
    throw new BackupError("BAD_FORMAT");
  }
  return id;
}

function ioError(err: unknown): BackupError {
  if (err instanceof BackupError) return err;
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOSPC" || code === "EDQUOT") return new BackupError("NO_SPACE");
  if (code === "ENOENT" || code === "ENOTDIR" || code === "ENXIO" || code === "ENODEV") {
    return new BackupError("FOLDER_MISSING", err instanceof Error ? err.message : String(err));
  }
  return new BackupError("BACKUP_FAILED", err instanceof Error ? err.message : String(err));
}

export class FolderDrive implements DriveLike {
  constructor(private readonly root: () => Promise<string>) {}

  // Never creates the chosen folder itself: if the Drive app is quit or signed
  // out its folder is gone, and recreating it would back up to a plain local
  // folder that never reaches Drive.
  private async folder(create: boolean): Promise<string> {
    const root = await this.root();
    try {
      if (!(await fsp.stat(root)).isDirectory()) throw new BackupError("FOLDER_MISSING");
    } catch (err) {
      throw ioError(err);
    }
    const dir = join(root, FOLDER_NAME);
    if (create) {
      try {
        await fsp.mkdir(dir, { recursive: true });
      } catch (err) {
        throw ioError(err);
      }
    }
    return dir;
  }

  async ensureFolder(): Promise<string> {
    return this.folder(true);
  }

  async upload(_folderId: string, name: string, filePath: string, appVersion: string): Promise<DriveFile> {
    const dir = await this.folder(true);
    const target = join(dir, checkId(name));
    const partial = `${target}.partial`; // not a backup name: never listed until complete
    try {
      await fsp.copyFile(filePath, partial);
      await fsp.rename(partial, target);
      const st = await fsp.stat(target);
      return { id: name, name, size: st.size, createdTime: createdFromName(name) ?? st.mtime.toISOString(), appVersion };
    } catch (err) {
      await fsp.rm(partial, { force: true }).catch(() => {});
      throw ioError(err);
    }
  }

  // Newest first, like the Drive API listing.
  async list(): Promise<DriveFile[]> {
    const dir = await this.folder(false);
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []; // nothing backed up here yet
      throw ioError(err);
    }
    const files: DriveFile[] = [];
    for (const name of names) {
      if (!name.endsWith(BACKUP_SUFFIX) || name.startsWith(".")) continue;
      try {
        const st = await fsp.stat(join(dir, name));
        if (!st.isFile()) continue;
        files.push({ id: name, name, size: st.size, createdTime: createdFromName(name) ?? st.mtime.toISOString(), appVersion: null });
      } catch {
        // vanished while listing (e.g. the Drive app is syncing a delete)
      }
    }
    return files.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  }

  async download(fileId: string, destPath: string): Promise<void> {
    const dir = await this.folder(false);
    try {
      await fsp.copyFile(join(dir, checkId(fileId)), destPath);
    } catch (err) {
      throw ioError(err);
    }
  }

  async delete(fileId: string): Promise<void> {
    const dir = await this.folder(false);
    try {
      await fsp.rm(join(dir, checkId(fileId)), { force: true });
    } catch (err) {
      throw ioError(err);
    }
  }
}
