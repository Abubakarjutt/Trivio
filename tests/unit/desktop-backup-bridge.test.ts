import { describe, it, expect, vi } from "vitest";
import { wrapBackup } from "@/lib/desktop";
import type { RawBackupBridge } from "@/types/trivio-desktop";

function rawWith(over: Partial<RawBackupBridge>): RawBackupBridge {
  return { onProgress: () => () => {}, ...over } as RawBackupBridge;
}

describe("wrapBackup", () => {
  it("resolves with the value on { ok: true }", async () => {
    const b = wrapBackup(rawWith({ connect: async () => ({ ok: true, value: { email: "a@b.c" } }) }));
    await expect(b.connect()).resolves.toEqual({ email: "a@b.c" });
  });

  it("rejects with the message and code on { ok: false }", async () => {
    const b = wrapBackup(
      rawWith({
        setPassword: async () => ({ ok: false, code: "WEAK_PASSWORD", message: "Choose a backup password of at least 8 characters." }),
      }),
    );
    const err = await b.setPassword("x").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Choose a backup password of at least 8 characters.");
    expect(err.code).toBe("WEAK_PASSWORD");
  });

  it("passes arguments through and forwards onProgress", async () => {
    const restore = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const unsub = () => {};
    const onProgress = vi.fn(() => unsub);
    const b = wrapBackup(rawWith({ restore, onProgress }));
    await b.restore("id1", "pw");
    expect(restore).toHaveBeenCalledWith("id1", "pw");
    const cb = () => {};
    expect(b.onProgress(cb)).toBe(unsub);
    expect(onProgress).toHaveBeenCalledWith(cb);
  });
});
