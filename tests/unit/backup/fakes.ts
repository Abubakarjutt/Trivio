// In-memory stand-ins for the backup service's dependencies.
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupService, type DbLike, type ServerLike, type ServiceDeps } from "../../../desktop/backup/backup-service";
import type { DriveFile, DriveLike } from "../../../desktop/backup/drive-client";
import { MemorySecretStore } from "../../../desktop/backup/secret-store";

export const FAST = { N: 1024, r: 8, p: 1 };

export class FakeDrive implements DriveLike {
  files = new Map<string, DriveFile & { data: Buffer; folder: string }>();
  folders = new Set<string>();
  failUpload: Error | null = null;
  uploadGate: Promise<void> | null = null;
  private seq = 0;
  private clock = Date.parse("2026-09-01T00:00:00Z");
  // Like the real client: a remembered folder is reused; otherwise the one
  // existing "Trivio Backups" folder is found; only then is one created.
  async ensureFolder(known: string | null) {
    if (known && this.folders.has(known)) return known;
    const existing = [...this.folders][0];
    if (existing) return existing;
    const id = `folder${++this.seq}`;
    this.folders.add(id);
    return id;
  }
  async upload(folder: string, name: string, path: string, appVersion: string) {
    if (this.uploadGate) await this.uploadGate;
    if (this.failUpload) throw this.failUpload;
    const data = await readFile(path);
    const id = `file${++this.seq}`;
    this.clock += 60_000;
    const f = { id, name, size: data.length, createdTime: new Date(this.clock).toISOString(), appVersion, data, folder };
    this.files.set(id, f);
    return f;
  }
  addForeign(folder: string, name: string) {
    const id = `file${++this.seq}`;
    this.files.set(id, { id, name, size: 1, createdTime: new Date(0).toISOString(), appVersion: null, data: Buffer.from("x"), folder });
  }
  async list(folder: string) {
    return [...this.files.values()]
      .filter((f) => f.folder === folder && f.name.endsWith(".trivio-backup"))
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  }
  async download(id: string, dest: string) {
    await writeFile(dest, this.files.get(id)!.data);
  }
  async delete(id: string) {
    this.files.delete(id);
  }
}

export class FakeDb implements DbLike {
  content = "data-v1"; // what the "live database" holds
  fp = "fp-1";
  migrations = ["20260101000000_init"];
  calls: string[] = [];
  restored: string | null = null;
  failSwap = false;
  failRestore = false;
  async dump(out: string) {
    this.calls.push("dump");
    await writeFile(out, this.content);
  }
  async fingerprint() {
    return this.fp;
  }
  async appliedMigrations() {
    return this.migrations;
  }
  async restore(dump: string) {
    this.calls.push("restore");
    if (this.failRestore) throw new Error("pg_restore exited 1");
    this.restored = await readFile(dump, "utf8");
  }
  async swapIn() {
    this.calls.push("swapIn");
    if (this.failSwap) throw new Error("rename failed");
    this.content = this.restored!;
  }
  async undoSwap() {
    this.calls.push("undoSwap");
  }
  async dropRestoreLeftovers() {
    this.calls.push("dropRestoreLeftovers");
  }
  async dropPrevious() {
    this.calls.push("dropPrevious");
  }
}

export class FakeServer implements ServerLike {
  calls: string[] = [];
  async stop() {
    this.calls.push("stop");
  }
  async start(o: { signOut: boolean }) {
    this.calls.push(o.signOut ? "start:signOut" : "start");
  }
}

export async function makeService(over: Partial<ServiceDeps> = {}) {
  const root = await mkdtemp(join(tmpdir(), "trivio-svc-"));
  const attachmentsDir = join(root, "storage", "attachments");
  await mkdir(join(attachmentsDir, "org1"), { recursive: true });
  await writeFile(join(attachmentsDir, "org1", "r.pdf"), "receipt-1");
  let now = new Date("2026-10-02T10:00:00Z");
  const drive = new FakeDrive();
  const db = new FakeDb();
  const server = new FakeServer();
  const secrets = new MemorySecretStore();
  const notes: string[] = [];
  const deps: ServiceDeps = {
    dir: join(root, "backup"),
    attachmentsDir,
    appVersion: "0.1.25",
    configured: true,
    secrets,
    auth: { connect: async () => ({ email: "me@x.com" }), disconnect: async () => { await secrets.clear("google-token"); } },
    drive,
    db,
    server,
    notify: (title) => notes.push(title),
    now: () => now,
    scrypt: FAST,
    ...over,
  };
  const svc = new BackupService(deps);
  await svc.init();
  return {
    svc, drive, db, server, secrets, notes, root, attachmentsDir, deps,
    setNow: (d: Date) => (now = d),
  };
}

export async function ready(over: Partial<ServiceDeps> = {}) {
  const t = await makeService(over);
  await t.svc.connect();
  await t.svc.setPassword("pw-12345678");
  return t;
}
