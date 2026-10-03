import { describe, it, expect, vi } from "vitest";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BackupService } from "../../../desktop/backup/backup-service";
import { loadState } from "../../../desktop/backup/state";
import { BackupError } from "../../../desktop/backup/errors";
import type { SecretStoreLike } from "../../../desktop/backup/secret-store";
import { makeService, ready } from "./fakes";

const HOUR = 3600_000;

describe("BackupService — setup", () => {
  it("reports not configured, and refuses to connect, without a client ID", async () => {
    const { svc } = await makeService({ configured: false });
    expect(svc.status().configured).toBe(false);
    await expect(svc.connect()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("connect stores the email; setPassword needs 8+ chars and enables backups", async () => {
    const { svc } = await makeService();
    await svc.connect();
    expect(svc.status()).toMatchObject({ connected: true, email: "me@x.com", passwordSet: false });
    await expect(svc.setPassword("short")).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await svc.setPassword("pw-12345678");
    expect(svc.status().passwordSet).toBe(true);
  });

  it("remembers the key across restarts (init reloads it from the secret store)", async () => {
    const t = await ready();
    const again = new BackupService(t.deps);
    await again.init();
    expect(again.status().passwordSet).toBe(true);
  });

  it("survives an unreadable secret store: init resolves and the password is asked for again", async () => {
    const t = await ready();
    const broken: SecretStoreLike = { ...t.secrets, load: async () => { throw new Error("decrypt failed"); }, save: t.secrets.save.bind(t.secrets), clear: t.secrets.clear.bind(t.secrets) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const again = new BackupService({ ...t.deps, secrets: broken });
    await expect(again.init()).resolves.toBeUndefined();
    expect(again.status()).toMatchObject({ connected: true, passwordSet: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("clears leftover temp files on init", async () => {
    const t = await ready();
    await mkdir(join(t.deps.dir, "tmp", "backup-old"), { recursive: true });
    await writeFile(join(t.deps.dir, "tmp", "backup-old", "x"), "x");
    await new BackupService(t.deps).init();
    expect(await readdir(join(t.deps.dir, "tmp")).catch(() => [])).toEqual([]);
  });
});

describe("BackupService — backups", () => {
  it("backupNow uploads one encrypted file and records success", async () => {
    const t = await ready();
    const status = await t.svc.backupNow();
    expect(t.drive.files.size).toBe(1);
    const [f] = t.drive.files.values();
    expect(f.name).toBe("trivio-2026-10-02T10-00-00Z.trivio-backup");
    expect(f.data.subarray(0, 8).toString()).toBe("TRIVIOBK");
    expect(f.data.includes(Buffer.from("receipt-1"))).toBe(false); // encrypted
    expect(status).toMatchObject({ lastSuccessAt: "2026-10-02T10:00:00.000Z", keptCount: 1, lastError: null });
    expect(await readdir(join(t.deps.dir, "tmp")).catch(() => [])).toEqual([]);
  });

  it("is due with no backup yet, not due within 24 h, due after 24 h", async () => {
    const t = await ready();
    expect(t.svc.isDue()).toBe(true);
    await t.svc.backupNow();
    t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + 23 * HOUR));
    expect(t.svc.isDue()).toBe(false);
    t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + 24 * HOUR));
    expect(t.svc.isDue()).toBe(true);
  });

  // Review Focus 2
  it("treats a last-success time in the future (clock went back) as due", async () => {
    const t = await ready();
    await t.svc.backupNow();
    t.setNow(new Date("2026-09-01T00:00:00Z"));
    expect(t.svc.isDue()).toBe(true);
  });

  it("is never due without a password or after Google access was revoked", async () => {
    const { svc } = await makeService();
    await svc.connect();
    expect(svc.isDue()).toBe(false);
    const t = await ready();
    t.drive.failUpload = new BackupError("AUTH_REVOKED");
    await t.svc.tick();
    expect(t.svc.isDue()).toBe(false);
  });

  it("tick skips when nothing changed, and backs up when the data changed", async () => {
    const t = await ready();
    await t.svc.backupNow();
    t.setNow(new Date("2026-10-03T11:00:00Z"));
    await t.svc.tick();
    expect(t.drive.files.size).toBe(1);
    expect(t.svc.status().lastCheckedAt).toBe("2026-10-03T11:00:00.000Z");
    t.db.fp = "fp-2";
    await t.svc.tick();
    expect(t.drive.files.size).toBe(2);
  });

  it("tick backs up when only an attachment changed", async () => {
    const t = await ready();
    await t.svc.backupNow();
    t.setNow(new Date("2026-10-03T11:00:00Z"));
    await writeFile(join(t.attachmentsDir, "org1", "new.pdf"), "n");
    await t.svc.tick();
    expect(t.drive.files.size).toBe(2);
  });

  // Review Focus 4 (prune side)
  it("keeps the newest 10 after a confirmed upload, never touching other files", async () => {
    const t = await ready();
    await t.svc.backupNow();
    const folder = [...t.drive.files.values()][0].folder; // the folder the service uses
    t.drive.addForeign(folder, "my-notes.txt");
    for (let i = 1; i < 12; i++) {
      t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + i * 25 * HOUR));
      await t.svc.backupNow();
    }
    const inFolder = [...t.drive.files.values()].filter((f) => f.folder === folder).map((f) => f.name);
    expect(inFolder.filter((n) => n.endsWith(".trivio-backup"))).toHaveLength(10);
    expect(inFolder).toContain("my-notes.txt");
    expect(inFolder).toContain("trivio-2026-10-13T21-00-00Z.trivio-backup"); // the newest survives
    expect(t.svc.status().keptCount).toBe(10);
  });

  it("a failing prune after a confirmed upload is still a success and is not retried hourly", async () => {
    const t = await ready();
    for (let i = 0; i < 10; i++) {
      t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + i * 25 * HOUR));
      await t.svc.backupNow();
    }
    t.drive.failDelete = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + 10 * 25 * HOUR));
    const status = await t.svc.backupNow();
    warn.mockRestore();
    expect(status).toMatchObject({ lastSuccessAt: t.svc.status().lastSuccessAt, lastError: null, failingSince: null, keptCount: 11 });
    expect(status.lastSuccessAt).toBe(new Date(Date.parse("2026-10-02T10:00:00Z") + 10 * 25 * HOUR).toISOString());
    expect(t.drive.files.size).toBe(11);
    t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + 10 * 25 * HOUR + 25 * HOUR));
    await t.svc.tick();
    expect(t.drive.files.size).toBe(11);
  });

  it("a failing restore-leftover cleanup does not fail the backup and stays pending", async () => {
    const t = await ready();
    await (t.svc as unknown as { update(p: object): Promise<void> }).update({ cleanupPending: true });
    t.db.failDropPrevious = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await t.svc.backupNow();
    warn.mockRestore();
    expect(t.svc.status().lastError).toBeNull();
    expect((await loadState(join(t.deps.dir, "state.json"))).cleanupPending).toBe(true);
  });

  it("a forced backupNow behind a scheduled run in flight chains a forced run after it", async () => {
    const t = await ready();
    await t.svc.backupNow();
    t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + 25 * HOUR));
    let open!: () => void;
    t.db.fingerprintGate = new Promise((r) => (open = r));
    const dumpsBefore = t.db.calls.filter((c) => c === "dump").length;
    const tick = t.svc.tick(); // due, but the data is unchanged: it will skip
    const forced = t.svc.backupNow();
    open();
    await Promise.all([tick, forced]);
    expect(t.drive.files.size).toBe(2); // the forced run uploaded
    expect(t.db.calls.filter((c) => c === "dump").length - dumpsBefore).toBe(1);
  });

  it("a failed upload prunes nothing and records the error", async () => {
    const t = await ready();
    for (let i = 0; i < 10; i++) {
      t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + i * 25 * HOUR));
      await t.svc.backupNow();
    }
    t.drive.failUpload = new BackupError("OFFLINE");
    await expect(t.svc.backupNow()).rejects.toMatchObject({ code: "OFFLINE" });
    expect(t.drive.files.size).toBe(10);
    expect(t.svc.status().lastError).toMatchObject({ code: "OFFLINE" });
    expect(await readdir(join(t.deps.dir, "tmp")).catch(() => [])).toEqual([]);
  });

  it("emits progress \"done\" exactly once per backup run, on success and on failure", async () => {
    const phases: string[] = [];
    const t = await ready({ onProgress: (p) => phases.push(p.phase) });
    await t.svc.backupNow();
    expect(phases.filter((p) => p === "done")).toHaveLength(1);
    expect(phases.at(-1)).toBe("done");

    phases.length = 0;
    t.drive.failUpload = new BackupError("OFFLINE");
    await expect(t.svc.backupNow()).rejects.toMatchObject({ code: "OFFLINE" });
    expect(phases.filter((p) => p === "done")).toHaveLength(1);
    expect(phases.at(-1)).toBe("done");
  });

  it("notifies once when backups have been failing for 48 hours", async () => {
    const t = await ready();
    t.drive.failUpload = new BackupError("OFFLINE");
    const start = Date.parse("2026-10-02T10:00:00Z");
    for (const h of [0, 1, 47]) {
      t.setNow(new Date(start + h * HOUR));
      await t.svc.tick();
    }
    expect(t.notes).toHaveLength(0);
    for (const h of [48, 49]) {
      t.setNow(new Date(start + h * HOUR));
      await t.svc.tick();
    }
    expect(t.notes).toEqual(["Trivio backups are failing"]);
    t.drive.failUpload = null;
    await t.svc.backupNow();
    expect(t.svc.status().failingSince).toBeNull();
  });

  it("notifies once after 48 hours of revoked Google access, although no runs happen", async () => {
    const t = await ready();
    const t0 = Date.parse("2026-10-02T10:00:00Z");
    t.drive.failUpload = new BackupError("AUTH_REVOKED");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await t.svc.tick(); // the one run that discovers the revocation, at t0
    err.mockRestore();
    expect(t.svc.status()).toMatchObject({ lastError: { code: "AUTH_REVOKED" }, failingSince: "2026-10-02T10:00:00.000Z" });
    t.setNow(new Date(t0 + 47 * HOUR));
    await t.svc.tick();
    expect(t.notes).toHaveLength(0);
    t.setNow(new Date(t0 + 48 * HOUR));
    await t.svc.tick();
    expect(t.notes).toEqual(["Trivio backups are failing"]);
    expect((await loadState(join(t.deps.dir, "state.json"))).failureNotified).toBe(true);
    t.setNow(new Date(t0 + 60 * HOUR));
    await t.svc.tick();
    expect(t.notes).toHaveLength(1);
    expect(t.drive.files.size).toBe(0);
  });

  it("a second backupNow during a run joins it instead of starting another", async () => {
    const t = await ready();
    let open!: () => void;
    t.drive.uploadGate = new Promise((r) => (open = r));
    const a = t.svc.backupNow();
    const b = t.svc.backupNow();
    expect(t.svc.status().running).toBe("backup");
    open();
    await Promise.all([a, b]);
    expect(t.drive.files.size).toBe(1);
    expect(t.db.calls.filter((c) => c === "dump")).toHaveLength(1);
  });

  it("backupNow without a password is NO_PASSWORD", async () => {
    const { svc } = await makeService();
    await svc.connect();
    await expect(svc.backupNow()).rejects.toMatchObject({ code: "NO_PASSWORD" });
  });
});
