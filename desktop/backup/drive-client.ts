// The few Google Drive v3 REST calls the backup needs, over plain fetch. With
// the drive.file scope Drive only shows Trivio the files Trivio created, so the
// "Trivio Backups" folder is found by name among those.

import { createWriteStream, promises as fsp } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BackupError } from "./errors";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FIELDS = "id,name,size,createdTime,appProperties";
const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB
const RETRIES = 3;

export const FOLDER_NAME = "Trivio Backups";
export const BACKUP_SUFFIX = ".trivio-backup";

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  createdTime: string;
  appVersion: string | null;
}

export interface DriveLike {
  ensureFolder(knownId: string | null): Promise<string>;
  upload(folderId: string, name: string, filePath: string, appVersion: string): Promise<DriveFile>;
  list(folderId: string): Promise<DriveFile[]>;
  download(fileId: string, destPath: string): Promise<void>;
  delete(fileId: string): Promise<void>;
}

interface RawFile {
  id: string;
  name: string;
  size?: string;
  createdTime: string;
  appProperties?: Record<string, string>;
  trashed?: boolean;
}

function toDriveFile(f: RawFile): DriveFile {
  return {
    id: f.id,
    name: f.name,
    size: Number(f.size ?? 0),
    createdTime: f.createdTime,
    appVersion: f.appProperties?.appVersion ?? null,
  };
}

// "bytes=0-1234" → next offset 1235; no header → nothing received yet.
function nextOffset(range: string | null): number {
  const m = range?.match(/bytes=\d+-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

export class DriveClient implements DriveLike {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly deps: {
      token: () => Promise<string>;
      onUnauthorized?: () => void;
      fetch?: typeof fetch;
      sleep?: (ms: number) => Promise<void>;
      chunkSize?: number;
    },
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async call(url: string, init: RequestInit = {}, ok: number[] = [200], retry = true): Promise<Response> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.deps.token();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
        });
      } catch (err) {
        if (retry && attempt < RETRIES) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new BackupError("OFFLINE", err instanceof Error ? err.message : String(err));
      }
      if (ok.includes(res.status)) return res;
      if (res.status === 401) {
        if (!refreshed) {
          refreshed = true;
          this.deps.onUnauthorized?.();
          continue;
        }
        throw new BackupError("AUTH_REVOKED");
      }
      if (res.status >= 500 || res.status === 429) {
        if (retry && attempt < RETRIES) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new BackupError("OFFLINE", `Drive answered ${res.status}`);
      }
      const body = await res.text();
      if (res.status === 403 && body.includes("storageQuotaExceeded")) throw new BackupError("DRIVE_FULL");
      throw new Error(`Drive ${init.method ?? "GET"} ${new URL(url).pathname} → ${res.status}: ${body.slice(0, 300)}`);
    }
  }

  async ensureFolder(knownId: string | null): Promise<string> {
    if (knownId) {
      const res = await this.call(`${API}/files/${encodeURIComponent(knownId)}?fields=id,trashed`, {}, [200, 404]);
      if (res.status === 200 && !((await res.json()) as RawFile).trashed) return knownId;
    }
    const q = `mimeType='${FOLDER_MIME}' and name='${FOLDER_NAME}' and trashed=false`;
    const found = (await (
      await this.call(`${API}/files?${new URLSearchParams({ q, fields: "files(id)", spaces: "drive" })}`)
    ).json()) as { files?: { id: string }[] };
    if (found.files?.[0]?.id) return found.files[0].id;
    const created = (await (
      await this.call(`${API}/files?fields=id`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
      })
    ).json()) as { id: string };
    return created.id;
  }

  async upload(folderId: string, name: string, filePath: string, appVersion: string): Promise<DriveFile> {
    const { size } = await fsp.stat(filePath);
    const start = await this.call(`${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": "application/octet-stream",
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({ name, parents: [folderId], appProperties: { appVersion } }),
    });
    const session = start.headers.get("location");
    if (!session) throw new Error("Drive did not return an upload session");

    const chunkSize = this.deps.chunkSize ?? CHUNK;
    const fh = await fsp.open(filePath, "r");
    try {
      let offset = 0;
      let failures = 0;
      for (;;) {
        const n = Math.min(chunkSize, size - offset);
        const buf = Buffer.alloc(n);
        await fh.read(buf, 0, n, offset);
        let res: Response;
        try {
          res = await this.call(
            session,
            { method: "PUT", headers: { "content-range": `bytes ${offset}-${offset + n - 1}/${size}` }, body: buf },
            [200, 201, 308],
            false,
          );
        } catch (err) {
          if (!(err instanceof BackupError) || err.code !== "OFFLINE" || ++failures > RETRIES) throw err;
          await this.sleep(1000 * 2 ** (failures - 1));
          // Ask Drive how much it actually kept, then continue from there.
          res = await this.call(session, { method: "PUT", headers: { "content-range": `bytes */${size}` } }, [200, 201, 308]);
        }
        if (res.status === 308) {
          const next = nextOffset(res.headers.get("range"));
          if (next > offset) failures = 0;
          offset = next;
          continue;
        }
        return toDriveFile((await res.json()) as RawFile);
      }
    } finally {
      await fh.close();
    }
  }

  async list(folderId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        orderBy: "createdTime desc",
        pageSize: "100",
        fields: `nextPageToken,files(${FIELDS})`,
        spaces: "drive",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = (await (await this.call(`${API}/files?${params}`)).json()) as {
        files?: RawFile[];
        nextPageToken?: string;
      };
      for (const f of page.files ?? []) if (f.name.endsWith(BACKUP_SUFFIX)) out.push(toDriveFile(f));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  }

  async download(fileId: string, destPath: string): Promise<void> {
    const res = await this.call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    if (!res.body) throw new Error("Drive returned an empty download");
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(destPath));
  }

  async delete(fileId: string): Promise<void> {
    await this.call(`${API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, [204, 404]);
  }
}
