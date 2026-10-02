import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  derivePwKey, deriveFileKey, makeVerifier, checkVerifier, normalizePassword, DEFAULT_SCRYPT,
} from "../../../desktop/backup/keys";
import { BackupError, toBackupError } from "../../../desktop/backup/errors";

const FAST = { N: 1024, r: 8, p: 1 };

describe("keys", () => {
  it("uses the spec's scrypt cost by default", () => {
    expect(DEFAULT_SCRYPT).toEqual({ N: 131072, r: 8, p: 1 });
  });

  it("derives the same pwKey for the same password + salt, different for another salt", async () => {
    const salt = randomBytes(16);
    const a = await derivePwKey("correct horse", salt, FAST);
    const b = await derivePwKey("correct horse", salt, FAST);
    const c = await derivePwKey("correct horse", randomBytes(16), FAST);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a).toHaveLength(32);
  });

  // Review Focus 1: macOS/Windows keyboards can produce NFD vs NFC for "é".
  it("treats composed and decomposed accents as the same password", async () => {
    const salt = randomBytes(16);
    const nfc = "café-password".normalize("NFC");
    const nfd = "café-password".normalize("NFD");
    expect(nfc).not.toBe(nfd);
    expect((await derivePwKey(nfc, salt, FAST)).equals(await derivePwKey(nfd, salt, FAST))).toBe(true);
    expect(normalizePassword(nfd)).toBe(nfc);
  });

  it("derives a distinct 32-byte file key per file salt", async () => {
    const pwKey = await derivePwKey("pw-12345678", randomBytes(16), FAST);
    const k1 = deriveFileKey(pwKey, randomBytes(16));
    const k2 = deriveFileKey(pwKey, randomBytes(16));
    expect(k1).toHaveLength(32);
    expect(k1.equals(k2)).toBe(false);
  });

  it("verifier accepts the right key and rejects a wrong or garbage one", async () => {
    const salt = randomBytes(16);
    const key = await derivePwKey("pw-12345678", salt, FAST);
    const v = makeVerifier(key);
    expect(checkVerifier(key, v)).toBe(true);
    expect(checkVerifier(await derivePwKey("pw-87654321", salt, FAST), v)).toBe(false);
    expect(checkVerifier(key, "AAAA")).toBe(false);
  });

  it("BackupError carries a code and a user message", () => {
    const e = new BackupError("WRONG_PASSWORD");
    expect(e.code).toBe("WRONG_PASSWORD");
    expect(e.userMessage).toBe("Wrong password or damaged backup.");
    expect(toBackupError(new Error("boom"), "BACKUP_FAILED").code).toBe("BACKUP_FAILED");
    expect(toBackupError(e, "BACKUP_FAILED")).toBe(e);
  });
});
