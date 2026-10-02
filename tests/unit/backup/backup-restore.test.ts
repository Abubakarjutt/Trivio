import { describe, it, expect, vi } from "vitest";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BackupService } from "../../../desktop/backup/backup-service";
import { makeService, ready } from "./fakes";

async function backedUp() {
  const t = await ready();
  await t.svc.backupNow();
  // the live data moves on after the backup
  t.db.content = "data-v2";
  await writeFile(join(t.attachmentsDir, "org1", "r.pdf"), "receipt-2");
  const [entry] = await t.svc.list();
  return { ...t, entry };
}

describe("BackupService — list", () => {
  it("lists backups newest first with size, date and app version", async () => {
    const t = await backedUp();
    expect(t.entry).toMatchObject({ name: "trivio-2026-10-02T10-00-00Z.trivio-backup", appVersion: "0.1.25" });
    expect(t.entry.sizeBytes).toBeGreaterThan(60);
  });

  it("needs a connection", async () => {
    const { svc } = await makeService();
    await expect(svc.list()).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  });
});

describe("BackupService — restore", () => {
  it("restores data + attachments, swaps with the server stopped, restarts signed out", async () => {
    const t = await backedUp();
    await t.svc.restore(t.entry.id, "pw-12345678");
    expect(t.db.content).toBe("data-v1");
    expect(await readFile(join(t.attachmentsDir, "org1", "r.pdf"), "utf8")).toBe("receipt-1");
    expect(await readFile(join(`${t.attachmentsDir}_before_restore`, "org1", "r.pdf"), "utf8")).toBe("receipt-2");
    expect(t.db.calls).toEqual(["dump", "restore", "swapIn"]);
    expect(t.server.calls).toEqual(["stop", "start:signOut"]);
  });

  it("drops the kept-aside copies after the next successful backup", async () => {
    const t = await backedUp();
    await t.svc.restore(t.entry.id, "pw-12345678");
    await t.svc.backupNow();
    expect(t.db.calls.at(-1)).toBe("dropPrevious");
    await expect(readdir(`${t.attachmentsDir}_before_restore`)).rejects.toThrow();
  });

  it("a wrong password changes nothing and never stops the server", async () => {
    const t = await backedUp();
    await expect(t.svc.restore(t.entry.id, "wrong-password")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    expect(t.db.content).toBe("data-v2");
    expect(t.server.calls).toEqual([]);
  });

  it("refuses a backup from a newer app (unknown migration)", async () => {
    const t = await backedUp();
    t.db.migrations = ["20250101000000_older_only"];
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "NEWER_BACKUP" });
    expect(t.server.calls).toEqual([]);
  });

  it("a pg_restore failure drops the side DB and keeps the server running", async () => {
    const t = await backedUp();
    t.db.failRestore = true;
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(t.db.calls).toContain("dropRestoreLeftovers");
    expect(t.server.calls).toEqual([]);
    expect(t.db.content).toBe("data-v2");
  });

  it("a failed swap puts the old attachments back and restarts the server", async () => {
    const t = await backedUp();
    t.db.failSwap = true;
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(await readFile(join(t.attachmentsDir, "org1", "r.pdf"), "utf8")).toBe("receipt-2");
    expect(t.server.calls).toEqual(["stop", "start"]);
    expect(t.db.content).toBe("data-v2");
  });

  it("first-run restore (connected, no password yet) adopts the backup's password", async () => {
    const t = await backedUp();
    const fresh = new BackupService({ ...t.deps, dir: join(t.root, "fresh-backup") });
    await fresh.init();
    await fresh.connect();
    expect(fresh.status().passwordSet).toBe(false);
    await fresh.restore(t.entry.id, "pw-12345678");
    expect(fresh.status().passwordSet).toBe(true);
    await fresh.backupNow(); // works with the adopted key
  });

  // Review Focus 5
  it("refuses to restore during a backup, and to back up during a restore", async () => {
    const t = await backedUp();
    let open!: () => void;
    t.drive.uploadGate = new Promise((r) => (open = r));
    const running = t.svc.backupNow();
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "BUSY" });
    open();
    await running;
    t.drive.uploadGate = null;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const origStop = t.server.stop.bind(t.server);
    t.server.stop = async () => {
      await gate;
      return origStop();
    };
    const restoring = t.svc.restore(t.entry.id, "pw-12345678");
    await new Promise((r) => setTimeout(r, 50));
    await expect(t.svc.backupNow()).rejects.toMatchObject({ code: "BUSY" });
    release();
    await restoring;
  });
});

describe("BackupService — disconnect", () => {
  it("forgets the account and key but leaves Drive files alone", async () => {
    const t = await backedUp();
    await t.svc.disconnect();
    expect(t.svc.status()).toMatchObject({ connected: false, passwordSet: false, email: null });
    expect(await t.secrets.load("key")).toBeNull();
    expect(t.drive.files.size).toBe(1);
  });

  it("stops the schedule, and a reconnect resumes it", async () => {
    vi.useFakeTimers();
    try {
      const t = await ready();
      t.svc.startSchedule(1000, 500);
      await t.svc.disconnect();
      const tick = vi.spyOn(t.svc, "tick").mockResolvedValue();
      await vi.advanceTimersByTimeAsync(5000);
      expect(tick).not.toHaveBeenCalled();
      await t.svc.connect();
      await vi.advanceTimersByTimeAsync(600);
      expect(tick).toHaveBeenCalledTimes(1);
      t.svc.stopSchedule();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses while a backup is running", async () => {
    const t = await ready();
    let open!: () => void;
    t.drive.uploadGate = new Promise((r) => (open = r));
    const running = t.svc.backupNow();
    await expect(t.svc.disconnect()).rejects.toMatchObject({ code: "BUSY" });
    open();
    await running;
  });
});

describe("BackupService — restore cleanup and rollback", () => {
  const workLeft = async (t: { root: string }) => {
    const left = await readdir(join(t.root, "backup", "tmp")).catch(() => []);
    return left.filter((n) => n.startsWith("restore-"));
  };

  it("removes the plaintext work dir on success and on every failure path", async () => {
    const ok = await backedUp();
    await ok.svc.restore(ok.entry.id, "pw-12345678");
    expect(await workLeft(ok)).toEqual([]);

    const wrong = await backedUp();
    await expect(wrong.svc.restore(wrong.entry.id, "wrong-password")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    expect(await workLeft(wrong)).toEqual([]);

    const newer = await backedUp();
    newer.db.migrations = ["20250101000000_older_only"];
    await expect(newer.svc.restore(newer.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "NEWER_BACKUP" });
    expect(await workLeft(newer)).toEqual([]);

    const pg = await backedUp();
    pg.db.failRestore = true;
    await expect(pg.svc.restore(pg.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(await workLeft(pg)).toEqual([]);

    const swap = await backedUp();
    swap.db.failSwap = true;
    await expect(swap.svc.restore(swap.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(await workLeft(swap)).toEqual([]);
  });

  it("a server that won't start on the restored data is rolled back", async () => {
    const t = await backedUp();
    t.server.failSignOutStart = true;
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(t.db.calls).toContain("undoSwap");
    expect(await readFile(join(t.attachmentsDir, "org1", "r.pdf"), "utf8")).toBe("receipt-2");
    expect(t.server.calls).toEqual(["stop", "start:signOut", "stop", "start"]);
    expect(await workLeft(t)).toEqual([]);
  });

  it("a Drive download failure is reported and releases the busy lock", async () => {
    const t = await backedUp();
    await expect(t.svc.restore("missing-id", "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(t.server.calls).toEqual([]);
    await t.svc.backupNow(); // not stuck BUSY
  });
});
