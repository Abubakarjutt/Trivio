import { describe, it, expect, vi } from "vitest";
import { promises as fsp } from "node:fs";
import { readFile, writeFile, readdir, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BackupService } from "../../../desktop/backup/backup-service";
import { loadState } from "../../../desktop/backup/state";
import { makeService, ready } from "./fakes";

const HOUR = 3600_000;

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

  it("orders several backups newest first", async () => {
    const t = await ready();
    await t.svc.backupNow();
    t.setNow(new Date("2026-10-03T10:00:00Z"));
    await t.svc.backupNow();
    const names = (await t.svc.list()).map((e) => e.name);
    expect(names).toEqual(["trivio-2026-10-03T10-00-00Z.trivio-backup", "trivio-2026-10-02T10-00-00Z.trivio-backup"]);
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
    expect(t.svc.status().restoreRollbackFailed).toBe(false);
    expect(await readFile(join(t.attachmentsDir, "org1", "r.pdf"), "utf8")).toBe("receipt-1");
    expect(await readFile(join(`${t.attachmentsDir}_before_restore`, "org1", "r.pdf"), "utf8")).toBe("receipt-2");
    expect(t.db.calls).toEqual(["dump", "restore", "swapIn"]);
    expect(t.server.calls).toEqual(["stop", "start:signOut"]);
  });

  it("keeps the kept-aside copies for a week, then drops them on the next successful backup", async () => {
    const t = await backedUp();
    const restoredAt = Date.parse("2026-10-02T10:00:00Z");
    await t.svc.restore(t.entry.id, "pw-12345678");
    expect((await loadState(join(t.deps.dir, "state.json"))).restoredAt).toBe("2026-10-02T10:00:00.000Z");

    t.setNow(new Date(restoredAt + HOUR));
    await t.svc.backupNow();
    expect(t.db.calls).not.toContain("dropPrevious");
    expect(await readFile(join(`${t.attachmentsDir}_before_restore`, "org1", "r.pdf"), "utf8")).toBe("receipt-2");
    expect((await loadState(join(t.deps.dir, "state.json"))).cleanupPending).toBe(true);

    t.setNow(new Date(restoredAt + 7 * 24 * HOUR + HOUR));
    await t.svc.backupNow();
    expect(t.db.calls.at(-1)).toBe("dropPrevious");
    await expect(readdir(`${t.attachmentsDir}_before_restore`)).rejects.toThrow();
    const state = await loadState(join(t.deps.dir, "state.json"));
    expect(state.cleanupPending).toBe(false);
    expect(state.restoredAt).toBeNull();
  });

  it("sets an earlier attachments_before_restore aside instead of deleting it when it isn't a known leftover", async () => {
    const t = await backedUp();
    const previous = `${t.attachmentsDir}_before_restore`;
    await mkdir(join(previous, "org1"), { recursive: true });
    await writeFile(join(previous, "org1", "only.pdf"), "only-copy");
    expect((await loadState(join(t.deps.dir, "state.json"))).cleanupPending).toBe(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await t.svc.restore(t.entry.id, "pw-12345678");
    warn.mockRestore();
    const aside = (await readdir(join(t.attachmentsDir, ".."))).filter((n) => n.startsWith("attachments_before_restore-"));
    expect(aside).toEqual(["attachments_before_restore-2026-10-02T10-00-00-000Z"]);
    expect(await readFile(join(t.attachmentsDir, "..", aside[0], "org1", "only.pdf"), "utf8")).toBe("only-copy");
    expect(await readFile(join(previous, "org1", "r.pdf"), "utf8")).toBe("receipt-2");
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

describe("BackupService — restore fix round", () => {
  it("post-commit failures (key save) don't fail a restore that already went live", async () => {
    const t = await backedUp();
    t.secrets.save = async () => {
      throw new Error("keychain locked");
    };
    await t.svc.restore(t.entry.id, "pw-12345678");
    expect(t.db.content).toBe("data-v1");
    expect(t.server.calls.at(-1)).toBe("start:signOut");
    expect(t.svc.status().running).toBeNull();
    const state = JSON.parse(await readFile(join(t.root, "backup", "state.json"), "utf8"));
    expect(state.cleanupPending).toBe(true);
    const next = await t.svc.backupNow().then(() => null, (e) => e);
    if (next) expect(next.code).toBe("NO_PASSWORD");
  });

  it("a failing attachments rollback still restarts the server and reports RESTORE_FAILED", async () => {
    const t = await backedUp();
    t.db.failSwap = true;
    t.db.beforeSwap = () => rm(`${t.attachmentsDir}_before_restore`, { recursive: true, force: true });
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(t.server.calls).toEqual(["stop", "start"]);
  });

  it("a failing undoSwap is recorded, keeps the old DB, and blocks further restores and cleanup", async () => {
    const t = await backedUp();
    t.server.failSignOutStart = true;
    t.db.failUndoSwap = true;
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(t.server.calls.at(-1)).toBe("start");
    expect(t.svc.status().running).toBeNull();
    const state = JSON.parse(await readFile(join(t.root, "backup", "state.json"), "utf8"));
    expect(state.restoreRollbackFailed).toBe(true);

    t.db.calls.length = 0;
    await t.svc.backupNow();
    expect(t.db.calls).not.toContain("dropPrevious");
    expect(t.db.calls).not.toContain("dropRestoreLeftovers");

    let downloads = 0;
    const orig = t.drive.download.bind(t.drive);
    t.drive.download = async (...a: Parameters<typeof orig>) => {
      downloads++;
      return orig(...a);
    };
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(downloads).toBe(0);
  });

  it("a server that won't stop drops the side DB, restarts and reports RESTORE_FAILED", async () => {
    const t = await backedUp();
    t.server.failStop = true;
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(t.db.calls).toContain("dropRestoreLeftovers");
    expect(t.server.calls.at(-1)).toBe("start");
    expect(t.db.content).toBe("data-v2");
  });

  it("setPassword is refused while a restore runs", async () => {
    const t = await backedUp();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const origStop = t.server.stop.bind(t.server);
    t.server.stop = async () => {
      await gate;
      return origStop();
    };
    const restoring = t.svc.restore(t.entry.id, "pw-12345678");
    await new Promise((r) => setTimeout(r, 50));
    await expect(t.svc.setPassword("another-pass-1")).rejects.toMatchObject({ code: "BUSY" });
    release();
    await restoring;
  });

  it("a failed disconnect keeps the schedule running", async () => {
    vi.useFakeTimers();
    try {
      const t = await ready();
      t.svc.startSchedule(1000, 500);
      t.secrets.clear = async () => {
        throw new Error("keychain locked");
      };
      await expect(t.svc.disconnect()).rejects.toThrow();
      const tick = vi.spyOn(t.svc, "tick").mockResolvedValue();
      await vi.advanceTimersByTimeAsync(600);
      expect(tick).toHaveBeenCalled();
      t.svc.stopSchedule();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BackupService — attachments rollback failure", () => {
  it("keeps the only copy of the old attachments and blocks cleanup and restores", async () => {
    const t = await backedUp();
    // An old, expired restore is pending cleanup, so only the rollback-failed guard keeps the copy below.
    await (t.svc as unknown as { update(p: object): Promise<void> }).update({ cleanupPending: true, restoredAt: "2026-09-01T00:00:00.000Z" });
    t.db.failSwap = true;
    const realRename = fsp.rename.bind(fsp);
    const spy = vi.spyOn(fsp, "rename").mockImplementation(async (from, to) => {
      // only the rollback's move back into place fails
      if (String(from).endsWith("_before_restore") && String(to) === t.attachmentsDir) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return realRename(from, to);
    });
    try {
      await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    } finally {
      spy.mockRestore();
    }
    expect(t.svc.status().restoreRollbackFailed).toBe(true);
    expect(t.server.calls.at(-1)).toBe("start");

    await t.svc.backupNow();
    expect(t.db.calls).not.toContain("dropPrevious");
    expect(await readFile(join(`${t.attachmentsDir}_before_restore`, "org1", "r.pdf"), "utf8")).toBe("receipt-2");

    let downloads = 0;
    const orig = t.drive.download.bind(t.drive);
    t.drive.download = async (...a: Parameters<typeof orig>) => {
      downloads++;
      return orig(...a);
    };
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(downloads).toBe(0);
  });
});

describe("BackupService — a second restore within the week", () => {
  const state = (t: { deps: { dir: string } }) => loadState(join(t.deps.dir, "state.json"));
  const restoredTwice = async () => {
    const t = await backedUp();
    await t.svc.restore(t.entry.id, "pw-12345678");
    expect(t.db.previous).toBe("data-v2");
    expect(await readFile(join(`${t.attachmentsDir}_before_restore`, "org1", "r.pdf"), "utf8")).toBe("receipt-2");
    const firstRestoredAt = (await state(t)).restoredAt;
    // the user works on the restored data, then restores again
    t.db.content = "data-v3";
    await writeFile(join(t.attachmentsDir, "org1", "r.pdf"), "receipt-3");
    return { ...t, firstRestoredAt };
  };
  const dirsNamed = async (t: { attachmentsDir: string }, prefix: string) =>
    (await readdir(join(t.attachmentsDir, ".."))).filter((n) => n.startsWith(prefix));

  it("keeps the original pre-first-restore data and discards the current data", async () => {
    const t = await restoredTwice();
    t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + HOUR));
    t.db.calls.length = 0;
    await t.svc.restore(t.entry.id, "pw-12345678");
    expect(t.db.content).toBe("data-v1");
    expect(await readFile(join(t.attachmentsDir, "org1", "r.pdf"), "utf8")).toBe("receipt-1");
    expect(t.db.previous).toBe("data-v2");
    expect(await readFile(join(`${t.attachmentsDir}_before_restore`, "org1", "r.pdf"), "utf8")).toBe("receipt-2");
    expect(t.db.calls).toEqual(["restore", "swapInKeepingPrevious", "dropDiscard"]);
    expect(t.db.discard).toBeNull();
    expect(await dirsNamed(t, "attachments_discard")).toEqual([]);
    const s = await state(t);
    expect(s.restoredAt).toBe(t.firstRestoredAt);
    expect(s.cleanupPending).toBe(true);
  });

  it("a failed swap on the second restore leaves the live data and the original intact", async () => {
    const t = await restoredTwice();
    t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + HOUR));
    t.db.failSwap = true;
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    expect(t.db.content).toBe("data-v3");
    expect(await readFile(join(t.attachmentsDir, "org1", "r.pdf"), "utf8")).toBe("receipt-3");
    expect(t.db.previous).toBe("data-v2");
    expect(await readFile(join(`${t.attachmentsDir}_before_restore`, "org1", "r.pdf"), "utf8")).toBe("receipt-2");
    expect(await dirsNamed(t, "attachments_discard")).toEqual([]);
    expect(t.server.calls.at(-1)).toBe("start");
    expect(t.svc.status().restoreRollbackFailed).toBe(false);
  });

  it("a restore after the week uses the normal path and restarts the clock", async () => {
    const t = await restoredTwice();
    t.setNow(new Date(Date.parse("2026-10-02T10:00:00Z") + 7 * 24 * HOUR + HOUR));
    t.db.calls.length = 0;
    await t.svc.restore(t.entry.id, "pw-12345678");
    expect(t.db.calls).toEqual(["restore", "swapIn"]);
    expect(t.db.previous).toBe("data-v3");
    expect(await readFile(join(`${t.attachmentsDir}_before_restore`, "org1", "r.pdf"), "utf8")).toBe("receipt-3");
    expect((await state(t)).restoredAt).toBe("2026-10-09T11:00:00.000Z");
  });
});

describe("BackupService — quit and cleanup guards", () => {
  it("a failure before swapIn succeeds leaves cleanupPending false, so the next backup keeps the copies", async () => {
    const t = await backedUp();
    t.db.failSwap = true;
    await expect(t.svc.restore(t.entry.id, "pw-12345678")).rejects.toMatchObject({ code: "RESTORE_FAILED" });
    const state = JSON.parse(await readFile(join(t.root, "backup", "state.json"), "utf8"));
    expect(state.cleanupPending).toBe(false);
    t.db.calls.length = 0;
    await t.svc.backupNow();
    expect(t.db.calls).not.toContain("dropPrevious");
  });

  it("whenIdle waits for an in-flight restore and swallows its error", async () => {
    const t = await backedUp();
    let release!: () => void;
    t.server.stop = () => new Promise<void>((r) => (release = r));
    t.db.failSwap = true;
    const restoring = t.svc.restore(t.entry.id, "pw-12345678").catch(() => {});
    await vi.waitFor(() => expect(t.svc.status().running).toBe("restore"));
    let idle = false;
    const w = t.svc.whenIdle().then(() => (idle = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(idle).toBe(false);
    release();
    await w;
    await restoring;
    expect(t.svc.status().running).toBeNull();
  });
});
