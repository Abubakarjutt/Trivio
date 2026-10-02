import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DriveClient, FOLDER_NAME } from "../../../desktop/backup/drive-client";

// A tiny in-memory Google Drive speaking just the REST calls DriveClient uses.
function fakeDrive() {
  const files = new Map<string, { id: string; name: string; parents: string[]; mimeType?: string; trashed: boolean; data: Buffer; createdTime: string; appProperties?: Record<string, string> }>();
  const sessions = new Map<string, { meta: any; size: number; received: Buffer }>();
  let seq = 0;
  let clock = Date.parse("2026-10-01T00:00:00Z");
  const fail = { putTimes: 0, quota: false };
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const view = (f: any) => ({ id: f.id, name: f.name, size: String(f.data.length), createdTime: f.createdTime, appProperties: f.appProperties, trashed: f.trashed });
  const add = (name: string, parents: string[], data: Buffer = Buffer.alloc(0), extra: any = {}) => {
    const id = `f${++seq}`;
    clock += 1000;
    files.set(id, { id, name, parents, trashed: false, data, createdTime: new Date(clock).toISOString(), ...extra });
    return id;
  };

  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      let list = [...files.values()].filter((f) => !f.trashed);
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      if (parent) list = list.filter((f) => f.parents.includes(parent));
      if (q.includes("mimeType='application/vnd.google-apps.folder'")) list = list.filter((f) => f.mimeType && f.name === FOLDER_NAME);
      const pageSize = 2; // force paging
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = list.slice(start, start + pageSize);
      return json({ files: page.map(view), nextPageToken: start + pageSize < list.length ? String(start + pageSize) : undefined });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init.body));
      return json({ id: add(meta.name, meta.parents ?? [], Buffer.alloc(0), { mimeType: meta.mimeType }) });
    }
    const one = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (one && method === "GET") {
      const f = files.get(one[1]);
      if (!f) return json({ error: { code: 404 } }, 404);
      if (url.searchParams.get("alt") === "media") return new Response(new Uint8Array(f.data));
      return json(view(f));
    }
    if (one && method === "DELETE") {
      files.delete(one[1]);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      if (fail.quota) return json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, 403);
      const sid = `s${++seq}`;
      sessions.set(sid, { meta: JSON.parse(String(init.body)), size: Number((init.headers as any)["x-upload-content-length"]), received: Buffer.alloc(0) });
      return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/session/${sid}` } });
    }
    const sess = url.pathname.match(/^\/upload\/session\/(.+)$/);
    if (sess && method === "PUT") {
      const s = sessions.get(sess[1])!;
      const range = String((init.headers as any)["content-range"]);
      const status = () =>
        s.received.length === s.size
          ? json(view(files.get(add(s.meta.name, s.meta.parents, s.received, { appProperties: s.meta.appProperties }))!), 200)
          : new Response(null, { status: 308, headers: s.received.length ? { range: `bytes=0-${s.received.length - 1}` } : {} });
      if (range.startsWith("bytes */")) return status();
      if (fail.putTimes > 0) {
        fail.putTimes--;
        return new Response("oops", { status: 503 });
      }
      const [, from] = range.match(/bytes (\d+)-/)!;
      if (Number(from) !== s.received.length) return new Response("bad offset", { status: 400 });
      s.received = Buffer.concat([s.received, Buffer.from(init.body as Uint8Array)]);
      return status();
    }
    return new Response(`unhandled ${method} ${url.pathname}`, { status: 500 });
  }) as unknown as typeof fetch;

  return { files, fail, add, fetchImpl };
}

const client = (d: ReturnType<typeof fakeDrive>) =>
  new DriveClient({ token: async () => "t", fetch: d.fetchImpl, sleep: async () => {}, chunkSize: 256 * 1024 });

async function tmpFile(bytes: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "trivio-drive-"));
  const p = join(dir, "b.trivio-backup");
  await writeFile(p, bytes);
  return { dir, p };
}

describe("DriveClient", () => {
  it("creates the backup folder once and reuses it", async () => {
    const d = fakeDrive();
    const c = client(d);
    const id = await c.ensureFolder(null);
    expect(await c.ensureFolder(null)).toBe(id);
    expect(await c.ensureFolder(id)).toBe(id);
    expect([...d.files.values()].filter((f) => f.mimeType)).toHaveLength(1);
  });

  // Review Focus 3
  it("recreates the folder when the remembered one was trashed or deleted", async () => {
    const d = fakeDrive();
    const c = client(d);
    const id = await c.ensureFolder(null);
    d.files.get(id)!.trashed = true;
    const again = await c.ensureFolder(id);
    expect(again).not.toBe(id);
    d.files.delete(again);
    expect(await c.ensureFolder(again)).not.toBe(again);
  });

  it("uploads in chunks, resuming after a 503, and reports Drive's size", async () => {
    const d = fakeDrive();
    const c = client(d);
    const folder = await c.ensureFolder(null);
    const bytes = randomBytes(700 * 1024); // 3 chunks of 256 KiB
    const { p } = await tmpFile(bytes);
    d.fail.putTimes = 1;
    const f = await c.upload(folder, "trivio-2026-10-02T00-00-00Z.trivio-backup", p, "0.1.25");
    expect(f.size).toBe(bytes.length);
    expect(f.appVersion).toBe("0.1.25");
    expect(d.files.get(f.id)!.data.equals(bytes)).toBe(true);
  });

  // Review Focus 4
  it("lists only .trivio-backup files, newest first, across pages", async () => {
    const d = fakeDrive();
    const c = client(d);
    const folder = await c.ensureFolder(null);
    d.add("trivio-a.trivio-backup", [folder], Buffer.from("1"));
    d.add("my-notes.txt", [folder], Buffer.from("2"));
    d.add("trivio-b.trivio-backup", [folder], Buffer.from("3"));
    d.add("trivio-c.trivio-backup", [folder], Buffer.from("4"));
    const names = (await c.list(folder)).map((f) => f.name);
    expect(names).toEqual(["trivio-c.trivio-backup", "trivio-b.trivio-backup", "trivio-a.trivio-backup"]);
  });

  it("downloads and deletes", async () => {
    const d = fakeDrive();
    const c = client(d);
    const folder = await c.ensureFolder(null);
    const id = d.add("trivio-a.trivio-backup", [folder], Buffer.from("payload"));
    const { dir } = await tmpFile(Buffer.alloc(0));
    await c.download(id, join(dir, "out"));
    expect(await readFile(join(dir, "out"), "utf8")).toBe("payload");
    await c.delete(id);
    expect(d.files.has(id)).toBe(false);
  });

  it("maps a full Drive to DRIVE_FULL", async () => {
    const d = fakeDrive();
    const c = client(d);
    const folder = await c.ensureFolder(null);
    d.fail.quota = true;
    const { p } = await tmpFile(Buffer.from("x"));
    await expect(c.upload(folder, "trivio-x.trivio-backup", p, "1")).rejects.toMatchObject({ code: "DRIVE_FULL" });
  });

  it("maps a network failure to OFFLINE after retries, and a second 401 to AUTH_REVOKED", async () => {
    let unauthorized = 0;
    const offline = new DriveClient({
      token: async () => "t",
      fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch,
      sleep: async () => {},
    });
    await expect(offline.ensureFolder(null)).rejects.toMatchObject({ code: "OFFLINE" });
    const revoked = new DriveClient({
      token: async () => "t",
      onUnauthorized: () => unauthorized++,
      fetch: (async () => new Response("", { status: 401 })) as unknown as typeof fetch,
      sleep: async () => {},
    });
    await expect(revoked.ensureFolder(null)).rejects.toMatchObject({ code: "AUTH_REVOKED" });
    expect(unauthorized).toBe(1);
  });
});
