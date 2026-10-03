import { describe, it, expect, vi, beforeEach } from "vitest";

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0" },
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) },
  Notification: { isSupported: () => false },
  safeStorage: {},
  shell: {},
}));

import { registerBackupIpc } from "../../../desktop/backup/wire";
import type { BackupService } from "../../../desktop/backup/backup-service";
import { BackupError } from "../../../desktop/backup/errors";

const APP = "http://127.0.0.1:4123";
const from = (url: string) => ({ senderFrame: { url } });
const BACKUP_FAILED = new BackupError("BACKUP_FAILED").userMessage;

function register(service: Partial<BackupService>, origin: string | null = APP) {
  handlers.clear();
  registerBackupIpc(() => service as BackupService, () => origin);
}

describe("registerBackupIpc", () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    err = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => err.mockRestore();
  });

  it("answers the app's own origin", async () => {
    register({ list: async () => [] });
    await expect(handlers.get("backup:list")!(from(`${APP}/settings`))).resolves.toEqual({ ok: true, value: [] });
  });

  it("passes a BackupError's user message through", async () => {
    register({ list: async () => { throw new BackupError("OFFLINE", "socket hang up"); } });
    await expect(handlers.get("backup:list")!(from(`${APP}/settings`))).resolves.toEqual({
      ok: false, code: "OFFLINE", message: new BackupError("OFFLINE").userMessage,
    });
  });

  it("never shows a plain Error's text: BACKUP_FAILED with the errors.ts message, detail logged", async () => {
    register({ list: async () => { throw new Error("ECONNREFUSED /var/secret/path"); } });
    const res = await handlers.get("backup:list")!(from(`${APP}/settings`));
    expect(res).toEqual({ ok: false, code: "BACKUP_FAILED", message: BACKUP_FAILED });
    expect(BACKUP_FAILED).toBe("Backup failed.");
    expect(String(err.mock.calls.flat().join(" "))).toContain("ECONNREFUSED");
  });

  it("refuses every channel from another origin, without calling the service", async () => {
    const list = vi.fn(async () => []);
    const restore = vi.fn(async () => {});
    register({ list, restore, status: vi.fn() as never });
    for (const url of ["https://evil.example/x", "http://127.0.0.1:9999/settings", "file:///tmp/a.html", ""]) {
      for (const channel of ["backup:list", "backup:restore", "backup:status"]) {
        await expect(handlers.get(channel)!(from(url), "id", "pw")).resolves.toEqual({
          ok: false, code: "BACKUP_FAILED", message: BACKUP_FAILED,
        });
      }
    }
    await expect(handlers.get("backup:list")!({})).resolves.toMatchObject({ ok: false, code: "BACKUP_FAILED" });
    expect(list).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
  });

  it("refuses everything before the app server's origin is known", async () => {
    const list = vi.fn(async () => []);
    register({ list }, null);
    await expect(handlers.get("backup:list")!(from(`${APP}/settings`))).resolves.toMatchObject({ ok: false, code: "BACKUP_FAILED" });
    expect(list).not.toHaveBeenCalled();
  });
});
