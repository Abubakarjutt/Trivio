// Backup keys. The password is stretched once with scrypt into pwKey (slow by
// design); every backup file then gets its own key from HKDF(pwKey, fileSalt)
// (fast). pwKey is what the app keeps (via safeStorage) so daily backups run
// unattended; the password itself is never stored.

import {
  createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt, timingSafeEqual,
} from "node:crypto";

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

const VERIFIER_PLAINTEXT = Buffer.from("trivio-backup-verifier");

// The same password typed on macOS and Windows can arrive as different Unicode
// sequences (NFD vs NFC); normalise so both open the same backups.
export function normalizePassword(password: string): string {
  return password.normalize("NFC");
}

export function derivePwKey(
  password: string,
  pwSalt: Buffer,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      normalizePassword(password),
      pwSalt,
      32,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export function deriveFileKey(pwKey: Buffer, fileSalt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", pwKey, fileSalt, "trivio-backup-v1", 32));
}

// A small encrypted constant: lets the app tell a good stored key from a
// corrupted/foreign one without keeping the password.
export function makeVerifier(pwKey: Buffer): string {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", pwKey, nonce);
  const ct = Buffer.concat([c.update(VERIFIER_PLAINTEXT), c.final()]);
  return Buffer.concat([nonce, ct, c.getAuthTag()]).toString("base64");
}

export function checkVerifier(pwKey: Buffer, verifier: string): boolean {
  const buf = Buffer.from(verifier, "base64");
  if (buf.length < 12 + 16 + 1) return false;
  try {
    const d = createDecipheriv("aes-256-gcm", pwKey, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    const pt = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
    return pt.length === VERIFIER_PLAINTEXT.length && timingSafeEqual(pt, VERIFIER_PLAINTEXT);
  } catch {
    return false;
  }
}
