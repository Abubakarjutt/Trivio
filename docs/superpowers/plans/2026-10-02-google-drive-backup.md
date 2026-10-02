# Google Drive Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypted daily backups of the desktop app's database and attachments to the user's Google Drive, with restore from Settings and from the first-run (register) screen.

**Architecture:**
- The Electron main process does all the work:
  - `pg_dump` of the embedded Postgres plus the attachments folder go into a minimal tar;
  - the tar is encrypted with AES-256-GCM (scrypt + HKDF keys);
  - the result is uploaded with a resumable upload to the Drive REST v3 API, using the `drive.file` scope.
- Restore reverses this:
  - it restores into a side database, `trivio_restore`;
  - with the web server stopped, it swaps the databases inside one transaction;
  - it restarts the server, which re-runs migrations.
- The Next.js UI talks to it only through `window.trivioDesktop.backup`, which the preload script exposes.

**Tech Stack:**
- Electron 33 main process (esbuild → CJS);
- Node `crypto` / `http` / `fs`;
- embedded Postgres 16 tools (`pg_dump`, `pg_restore`, `psql`);
- Next.js 15 + React client components, shadcn/ui;
- Vitest for tests, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-10-02-google-drive-backup-design.md`

## Global Constraints

- No new npm dependencies. tar is our own minimal ustar (`desktop/backup/tar.ts`).
- OAuth scopes are exactly `https://www.googleapis.com/auth/drive.file openid email`.
- Drive folder name: `Trivio Backups`. File name: `trivio-<UTC ISO with colons→dashes, no ms>.trivio-backup`.
- Keep the newest **10** backups. Prune only after a confirmed upload.
- A backup is due when the last *successful* backup is ≥ 24 h old, or is in the future. Checked on start (after 60 s) and every hour.
- File header is exactly 60 bytes: `magic "TRIVIOBK" 8 | version 1 | N uint32BE 4 | r 1 | p 1 | pwSalt 16 | fileSalt 16 | nonce 12 | reserved 1`. The header is the GCM AAD. The tag is the last 16 bytes.
- Keys:
  - `pwKey = scrypt(NFC(password), pwSalt, 32, {N: 2^17, r: 8, p: 1})`;
  - `fileKey = HKDF-SHA256(pwKey, fileSalt, "trivio-backup-v1", 32)`.
- The password is never stored. `pwKey` is stored only through Electron `safeStorage`.
- Minimum password length: 8 characters, after NFC normalisation.
- Restore never touches the live `trivio` database until `trivio_restore` is fully restored. Every failure path ends with the old data live and the server running.
- Organisation scoping is unaffected: backup and restore move whole databases and run no per-row queries.
- User-facing error texts are the strings in `desktop/backup/errors.ts`. The renderer shows them unchanged.
- Only the embedded database is supported. With an external DB, backup reports "not configured".
- Tests and manual checks must never use the installed app's real data folder (`~/Library/Application Support/trivio-desktop`). Only the user, by clicking Restore, touches it.

## Spec amendments (found while planning; the spec is updated in the same commit)

1. **Bridge name.** The renderer bridge is `window.trivioDesktop.backup`. The spec said `window.trivio.backup`, but `window.trivioDesktop` is the existing global.
2. **Change fingerprint.** It is `stats_reset | sum(n_tup_ins + n_tup_upd + n_tup_del)` from `pg_stat_user_tables`, plus the attachments hash. The spec used `xact_commit`, but that also counts read-only transactions, including the backup's own queries. "Unchanged" would then never be detected.
3. **"3 consecutive daily failures" becomes time-based.** One notification is sent when backups have been failing for ≥ 48 h (`failingSince`). Counting attempts would fire after 3 hourly retries.
4. **A successful restore adopts the backup's password key.** Daily backups then continue with the same password, and a first-run restore needs no separate "set password" step.
5. **The pieces are split more finely than the spec's 4 modules** so each can be tested alone:
   - `errors`, `keys`, `tar`, `archive`, `pg-tools`, `state`, `secret-store`, `google-auth`, `drive-client`, `backup-service`;
   - `wire.ts` holds the Electron-only glue.
6. **`drive-client` is tested with a fake `fetch`** rather than a fake HTTP server. `google-auth`'s loopback listener is tested with a real local HTTP server.
7. **`server/routers/gdpr.ts:154` also hard-codes `process.cwd()/storage`.** It now uses the same `storageRoot()`.
8. **`pg_restore` runs into `trivio_restore` while the server is still up.** The server is stopped only for the swap, which shortens downtime.

## Review Focus

1. **Passwords with accents typed differently on two machines.** One machine may produce decomposed accents (NFD), the other composed ones (NFC). Both must open the same backup. Pinned in Task 2.
2. **A computer whose clock went backwards,** so the last-backup timestamp is in the future. It must still back up instead of waiting until that date. Pinned in Task 9.
3. **A user who deleted or trashed the "Trivio Backups" folder in Drive.** The next backup must recreate it, not fail forever. Pinned in Task 8.
4. **Other files the user put in the backup folder** must never be listed, restored or pruned. Pinned in Tasks 8 and 9.
5. **Clicking Restore while a backup is uploading,** or "Back up now" during a restore, must be refused with "A backup or restore is already running." The two must not interleave. Pinned in Task 10.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/storage.ts` (modify) | `storageRoot()` honours `TRIVIO_STORAGE_DIR` |
| `server/routers/gdpr.ts` (modify) | use `storageRoot()` |
| `desktop/storage-dir.ts` (new) | one-time move of attachments out of the app bundle |
| `desktop/backup/errors.ts` | `BackupError` codes and user messages |
| `desktop/backup/keys.ts` | scrypt / HKDF / verifier |
| `desktop/backup/tar.ts` | minimal ustar writer + safe extractor |
| `desktop/backup/archive.ts` | file header, encrypt/decrypt, pack/unpack, attachments fingerprint |
| `desktop/backup/pg-tools.ts` | `pg_dump` / `pg_restore` / `psql` wrappers, swap, fingerprint, migrations |
| `desktop/backup/state.ts` | `state.json` load/save (atomic) |
| `desktop/backup/secret-store.ts` | `safeStorage`-encrypted small secrets on disk |
| `desktop/backup/google-auth.ts` | PKCE loopback sign-in, token refresh, revoke |
| `desktop/backup/drive-client.ts` | Drive folder/upload/list/download/delete |
| `desktop/backup/backup-service.ts` | scheduling, backup, prune, restore, status |
| `desktop/backup/wire.ts` | Electron glue: builds the service from real deps, IPC handlers |
| `desktop/embedded/embedded-db.ts` (modify) | handle exposes `config` + `migrate()` |
| `desktop/main.ts` (modify) | storage env, server restart, service lifecycle, IPC |
| `desktop/preload.ts` (modify) | `backup` sub-API |
| `desktop/build-electron.mjs` (modify) | injects Google client ID/secret |
| `desktop/tsconfig.json` (modify) | include `backup/*.ts`, `storage-dir.ts` |
| `.github/workflows/desktop-release.yml` (modify) | pass secrets to builds |
| `types/trivio-desktop.d.ts`, `lib/desktop.ts` (modify) | bridge types + `getBackup()` |
| `components/backup/restore-dialog.tsx` (new) | shared restore flow UI |
| `components/backup/restore-from-drive-link.tsx` (new) | register-page entry point |
| `app/(app)/settings/_components/backup-card.tsx` (new) | Settings card |
| `app/(app)/settings/page.tsx`, `app/(auth)/register/page.tsx` (modify) | mount the UI |
| tests | `tests/unit/backup/*.test.ts`, `tests/unit/storage-dir.test.ts`, `tests/unit/storage.test.ts`, `e2e/smoke.spec.ts` |

`vitest.config.ts` already includes all `tests/unit/**` files. Run a single file with `npx vitest run <path>`.

---

### Task 1: Move attachments out of the app bundle

**Files:**
- Modify: `lib/storage.ts` (every use of `STORAGE_ROOT`)
- Modify: `server/routers/gdpr.ts:154`
- Create: `desktop/storage-dir.ts`
- Test: `tests/unit/storage.test.ts`, `tests/unit/storage-dir.test.ts`

**Interfaces:**
- Produces:
  - `storageRoot(): string` (from `@/lib/storage`);
  - `moveLegacyAttachments(from: string, to: string): Promise<number>`, returning the count of files moved (from `desktop/storage-dir.ts`).

- [ ] **Step 1: Write the failing tests**

`tests/unit/storage.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import { storageRoot, getAttachmentPath } from "@/lib/storage";

describe("storageRoot", () => {
  const saved = process.env.TRIVIO_STORAGE_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.TRIVIO_STORAGE_DIR;
    else process.env.TRIVIO_STORAGE_DIR = saved;
  });

  it("defaults to <cwd>/storage", () => {
    delete process.env.TRIVIO_STORAGE_DIR;
    expect(storageRoot()).toBe(path.join(process.cwd(), "storage"));
  });

  it("uses TRIVIO_STORAGE_DIR when set (desktop app: userData/storage)", () => {
    process.env.TRIVIO_STORAGE_DIR = "/tmp/trivio-storage";
    expect(storageRoot()).toBe("/tmp/trivio-storage");
    expect(getAttachmentPath("org1", "att1", "pdf")).toBe(
      path.join("/tmp/trivio-storage", "attachments", "org1", "att1.pdf"),
    );
  });
});
```

`tests/unit/storage-dir.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveLegacyAttachments } from "../../desktop/storage-dir";

async function scratch() {
  return mkdtemp(join(tmpdir(), "trivio-storage-"));
}

describe("moveLegacyAttachments", () => {
  it("returns 0 when there is nothing to move", async () => {
    const dir = await scratch();
    expect(await moveLegacyAttachments(join(dir, "nope"), join(dir, "to"))).toBe(0);
  });

  it("moves files into the new folder and removes the old one", async () => {
    const dir = await scratch();
    const from = join(dir, "bundle", "attachments");
    await mkdir(join(from, "org1"), { recursive: true });
    await writeFile(join(from, "org1", "a.pdf"), "A");
    const to = join(dir, "userData", "attachments");
    expect(await moveLegacyAttachments(from, to)).toBe(1);
    expect(await readFile(join(to, "org1", "a.pdf"), "utf8")).toBe("A");
    expect(existsSync(from)).toBe(false);
  });

  it("never overwrites a file that already exists in the new folder", async () => {
    const dir = await scratch();
    const from = join(dir, "from");
    const to = join(dir, "to");
    await mkdir(join(from, "org1"), { recursive: true });
    await mkdir(join(to, "org1"), { recursive: true });
    await writeFile(join(from, "org1", "a.pdf"), "OLD");
    await writeFile(join(to, "org1", "a.pdf"), "NEW");
    await moveLegacyAttachments(from, to);
    expect(await readFile(join(to, "org1", "a.pdf"), "utf8")).toBe("NEW");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/storage.test.ts tests/unit/storage-dir.test.ts`
Expected: FAIL. `storageRoot` is not exported, and `desktop/storage-dir` cannot be resolved.

- [ ] **Step 3: Implement**

In `lib/storage.ts`:
1. Replace `const STORAGE_ROOT = path.join(process.cwd(), "storage");` with the function below.
2. Replace every remaining `STORAGE_ROOT` in the file with `storageRoot()`.
3. In `readFile` and `deleteFile`, which each use it twice (the path and the `startsWith` traversal check), read it once into `const root = storageRoot();` and use `root` in both places.

```ts
/**
 * Where uploads live. The desktop app points this at its per-user data folder
 * (TRIVIO_STORAGE_DIR, set by desktop/main.ts) so app updates — which replace
 * the whole app bundle, and with it process.cwd() — never erase them.
 */
export function storageRoot(): string {
  return process.env.TRIVIO_STORAGE_DIR || path.join(process.cwd(), "storage");
}
```

In `server/routers/gdpr.ts:154`, replace
`const orgDir = path.join(process.cwd(), "storage", "attachments", user.organisationId);`
with
`const orgDir = path.join(storageRoot(), "attachments", user.organisationId);`
and add `import { storageRoot } from "@/lib/storage";` to its imports.

Create `desktop/storage-dir.ts`:
```ts
// One-time move of uploads out of the app bundle.
//
// Before v0.1.25 the server saved attachments under process.cwd()/storage,
// which in the desktop app is inside the (replaced-on-update) app bundle.
// main.ts now points TRIVIO_STORAGE_DIR at userData/storage and calls this on
// start to carry over anything an older version left behind. Existing files in
// the new folder always win; the old folder is removed afterwards.

import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await countFiles(join(dir, e.name)) : 1;
  }
  return n;
}

export async function moveLegacyAttachments(from: string, to: string): Promise<number> {
  let n: number;
  try {
    n = await countFiles(from);
  } catch {
    return 0; // nothing there
  }
  if (n > 0) await cp(from, to, { recursive: true, force: false, errorOnExist: false });
  await rm(from, { recursive: true, force: true }).catch(() => {});
  return n;
}
```

- [ ] **Step 4: Run tests and the typecheck**

Run: `npx vitest run tests/unit/storage.test.ts tests/unit/storage-dir.test.ts && npm run typecheck`
Expected: PASS, with no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/storage.ts server/routers/gdpr.ts desktop/storage-dir.ts tests/unit/storage.test.ts tests/unit/storage-dir.test.ts
git commit -m "fix(storage): uploads can live outside the app bundle (TRIVIO_STORAGE_DIR)"
```

---

### Task 2: Errors and keys

**Files:**
- Create: `desktop/backup/errors.ts`, `desktop/backup/keys.ts`
- Test: `tests/unit/backup/keys.test.ts`

**Interfaces:**
- Produces:
  - from `errors.ts`: `BackupErrorCode`, `class BackupError { code; userMessage }`, `toBackupError(err, fallback)`;
  - from `keys.ts`: `ScryptParams {N,r,p}`, `DEFAULT_SCRYPT`, `normalizePassword(pw)`, `derivePwKey(pw, pwSalt, params?) → Promise<Buffer>`, `deriveFileKey(pwKey, fileSalt) → Buffer`, `makeVerifier(pwKey) → string`, `checkVerifier(pwKey, verifier) → boolean`.

- [ ] **Step 1: Write the failing test**

`tests/unit/backup/keys.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/backup/keys.test.ts`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Implement**

`desktop/backup/errors.ts`:
```ts
// Every failure the backup feature reports to the user. The message is shown
// verbatim in Settings → Backup and the restore dialog, so keep it plain.

export type BackupErrorCode =
  | "NOT_CONFIGURED"
  | "NOT_CONNECTED"
  | "NO_PASSWORD"
  | "BUSY"
  | "WRONG_PASSWORD"
  | "BAD_FORMAT"
  | "NEWER_BACKUP"
  | "OFFLINE"
  | "AUTH_REVOKED"
  | "AUTH_TIMEOUT"
  | "AUTH_CANCELLED"
  | "DRIVE_FULL"
  | "DUMP_FAILED"
  | "BACKUP_FAILED"
  | "RESTORE_FAILED";

const MESSAGES: Record<BackupErrorCode, string> = {
  NOT_CONFIGURED: "Google Drive backup isn't configured in this build.",
  NOT_CONNECTED: "Connect Google Drive first.",
  NO_PASSWORD: "Set a backup password first.",
  BUSY: "A backup or restore is already running.",
  WRONG_PASSWORD: "Wrong password or damaged backup.",
  BAD_FORMAT: "This file isn't a Trivio backup, or it is damaged.",
  NEWER_BACKUP: "This backup was made by a newer Trivio. Update Trivio first.",
  OFFLINE: "No connection to Google Drive. Will retry.",
  AUTH_REVOKED: "Reconnect Google Drive.",
  AUTH_TIMEOUT: "Google sign-in timed out. Try again.",
  AUTH_CANCELLED: "Google sign-in was cancelled.",
  DRIVE_FULL: "Google Drive is full.",
  DUMP_FAILED: "Backup failed while reading your data.",
  BACKUP_FAILED: "Backup failed.",
  RESTORE_FAILED: "Restore failed — your data was not changed.",
};

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, detail?: string) {
    super(MESSAGES[code] + (detail ? ` (${detail})` : ""));
    this.name = "BackupError";
    this.code = code;
  }
  get userMessage(): string {
    return MESSAGES[this.code];
  }
}

export function toBackupError(err: unknown, fallback: BackupErrorCode): BackupError {
  if (err instanceof BackupError) return err;
  return new BackupError(fallback, err instanceof Error ? err.message : String(err));
}
```

`desktop/backup/keys.ts`:
```ts
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
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/backup/keys.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/backup/errors.ts desktop/backup/keys.ts tests/unit/backup/keys.test.ts
git commit -m "feat(backup): error codes and password-derived keys"
```

---

### Task 3: Minimal tar

**Files:**
- Create: `desktop/backup/tar.ts`
- Test: `tests/unit/backup/tar.test.ts`

**Interfaces:**
- Produces:
  - `TarEntry { name: string; path: string }`;
  - `fileHeader(name, size, mtime) → Buffer`;
  - `writeTar(outPath, entries) → Promise<void>`;
  - `extractTar(tarPath, destDir) → Promise<string[]>`, returning the names extracted.

- [ ] **Step 1: Write the failing test**

`tests/unit/backup/tar.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeTar, extractTar, fileHeader } from "../../../desktop/backup/tar";

async function scratch() {
  return mkdtemp(join(tmpdir(), "trivio-tar-"));
}

describe("tar", () => {
  it("round-trips files byte for byte, including sizes that aren't multiples of 512", async () => {
    const dir = await scratch();
    const a = join(dir, "a.bin");
    const b = join(dir, "b.txt");
    const bytes = randomBytes(70_001);
    await writeFile(a, bytes);
    await writeFile(b, "");
    const tar = join(dir, "x.tar");
    await writeTar(tar, [
      { name: "db.dump", path: a },
      { name: "attachments/org1/empty.txt", path: b },
    ]);
    const out = join(dir, "out");
    const names = await extractTar(tar, out);
    expect(names).toEqual(["db.dump", "attachments/org1/empty.txt"]);
    expect((await readFile(join(out, "db.dump"))).equals(bytes)).toBe(true);
    expect(await readFile(join(out, "attachments", "org1", "empty.txt"), "utf8")).toBe("");
  });

  it("stores long paths (>100 bytes) using the ustar prefix field", async () => {
    const dir = await scratch();
    const f = join(dir, "f");
    await writeFile(f, "x");
    const long = `attachments/${"o".repeat(60)}/${"n".repeat(80)}.pdf`;
    const tar = join(dir, "x.tar");
    await writeTar(tar, [{ name: long, path: f }]);
    expect(await extractTar(tar, join(dir, "out"))).toEqual([long]);
  });

  it.skipIf(process.platform === "win32")("is readable by the system tar", async () => {
    const dir = await scratch();
    const f = join(dir, "f");
    await writeFile(f, "hello");
    const tar = join(dir, "x.tar");
    await writeTar(tar, [{ name: "attachments/org1/f.txt", path: f }]);
    expect(execFileSync("tar", ["-tf", tar], { encoding: "utf8" }).trim()).toBe("attachments/org1/f.txt");
  });

  it("refuses entries that would escape the destination", async () => {
    const dir = await scratch();
    const tar = join(dir, "evil.tar");
    const h = fileHeader("../evil.txt", 1, new Date());
    await writeFile(tar, Buffer.concat([h, Buffer.alloc(512), Buffer.alloc(1024)]));
    await expect(extractTar(tar, join(dir, "out"))).rejects.toThrow(/unsafe path/);
  });

  it("rejects a corrupted header", async () => {
    const dir = await scratch();
    const f = join(dir, "f");
    await writeFile(f, "x");
    const tar = join(dir, "x.tar");
    await writeTar(tar, [{ name: "f", path: f }]);
    const buf = await readFile(tar);
    buf[0] ^= 0xff;
    await writeFile(tar, buf);
    await mkdir(join(dir, "out"));
    await expect(extractTar(tar, join(dir, "out"))).rejects.toThrow(/checksum/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/backup/tar.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement**

`desktop/backup/tar.ts`:
```ts
// The smallest tar we need: regular files only, POSIX ustar headers (so any
// `tar` can read our archives for support/debugging), and an extractor that
// refuses paths escaping the destination. No dependency.

import { createReadStream, createWriteStream, promises as fsp } from "node:fs";
import { once } from "node:events";
import { dirname, isAbsolute, join } from "node:path";

const BLOCK = 512;

export interface TarEntry {
  name: string; // path inside the archive, "/"-separated
  path: string; // source file on disk
}

function splitName(name: string): { prefix: string; base: string } {
  if (Buffer.byteLength(name) <= 100) return { prefix: "", base: name };
  for (let i = name.lastIndexOf("/"); i > 0; i = name.lastIndexOf("/", i - 1)) {
    const prefix = name.slice(0, i);
    const base = name.slice(i + 1);
    if (base && Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(base) <= 100) {
      return { prefix, base };
    }
  }
  throw new Error(`tar: path too long: ${name}`);
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

export function fileHeader(name: string, size: number, mtime: Date): Buffer {
  const h = Buffer.alloc(BLOCK);
  const { prefix, base } = splitName(name);
  h.write(base, 0, 100, "utf8");
  h.write(octal(0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, "ascii");
  h.write("        ", 148, "ascii"); // checksum placeholder: 8 spaces
  h.write("0", 156, "ascii"); // regular file
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

export async function writeTar(outPath: string, entries: TarEntry[]): Promise<void> {
  const out = createWriteStream(outPath);
  const write = async (buf: Buffer) => {
    if (!out.write(buf)) await once(out, "drain");
  };
  try {
    for (const e of entries) {
      const st = await fsp.stat(e.path);
      await write(fileHeader(e.name, st.size, st.mtime));
      let written = 0;
      for await (const chunk of createReadStream(e.path)) {
        await write(chunk as Buffer);
        written += (chunk as Buffer).length;
      }
      if (written !== st.size) throw new Error(`tar: ${e.path} changed while archiving`);
      const pad = (BLOCK - (st.size % BLOCK)) % BLOCK;
      if (pad) await write(Buffer.alloc(pad));
    }
    await write(Buffer.alloc(BLOCK * 2)); // end-of-archive marker
  } finally {
    out.end();
    await once(out, "close");
  }
}

function field(h: Buffer, offset: number, length: number): string {
  const raw = h.subarray(offset, offset + length).toString("utf8");
  const nul = raw.indexOf("\0");
  return nul === -1 ? raw : raw.slice(0, nul);
}

function verifyChecksum(h: Buffer): void {
  const stored = parseInt(field(h, 148, 8).trim(), 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  if (sum !== stored) throw new Error("tar: bad header checksum");
}

function safeJoin(root: string, name: string): string {
  const parts = name.split("/");
  if (!name || isAbsolute(name) || name.includes("\\") || parts.some((p) => p === ".." || p === "")) {
    throw new Error(`tar: unsafe path ${name}`);
  }
  return join(root, ...parts);
}

export async function extractTar(tarPath: string, destDir: string): Promise<string[]> {
  const fh = await fsp.open(tarPath, "r");
  const names: string[] = [];
  try {
    const header = Buffer.alloc(BLOCK);
    let pos = 0;
    for (;;) {
      const { bytesRead } = await fh.read(header, 0, BLOCK, pos);
      if (bytesRead < BLOCK) throw new Error("tar: truncated archive");
      if (header.every((b) => b === 0)) break;
      verifyChecksum(header);
      const base = field(header, 0, 100);
      const prefix = field(header, 345, 155);
      const name = prefix ? `${prefix}/${base}` : base;
      const size = parseInt(field(header, 124, 12).trim() || "0", 8);
      const type = field(header, 156, 1) || "0";
      pos += BLOCK;
      if (type === "0") {
        const target = safeJoin(destDir, name);
        await fsp.mkdir(dirname(target), { recursive: true });
        const out = await fsp.open(target, "w");
        try {
          const buf = Buffer.alloc(Math.max(1, Math.min(size, 1 << 20)));
          let left = size;
          let at = pos;
          while (left > 0) {
            const n = Math.min(left, buf.length);
            const r = await fh.read(buf, 0, n, at);
            if (r.bytesRead !== n) throw new Error("tar: truncated archive");
            await out.write(buf, 0, n);
            left -= n;
            at += n;
          }
        } finally {
          await out.close();
        }
        names.push(name);
      } else if (type !== "5") {
        throw new Error(`tar: unsupported entry type "${type}"`);
      }
      pos += Math.ceil(size / BLOCK) * BLOCK;
    }
  } finally {
    await fh.close();
  }
  return names;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/backup/tar.test.ts`
Expected: PASS (5 tests, or 4 on Windows).

- [ ] **Step 5: Commit**

```bash
git add desktop/backup/tar.ts tests/unit/backup/tar.test.ts
git commit -m "feat(backup): minimal ustar writer and safe extractor"
```

---

### Task 4: Encrypted backup archive

**Files:**
- Create: `desktop/backup/archive.ts`
- Test: `tests/unit/backup/archive.test.ts`

**Interfaces:**
- Consumes:
  - `BackupError` (Task 2);
  - `deriveFileKey`, `derivePwKey`, `ScryptParams` (Task 2);
  - `writeTar`, `extractTar` (Task 3).
- Produces:
  - `HEADER_LEN = 60`, `TAG_LEN = 16`;
  - `BackupHeader { params; pwSalt; fileSalt; nonce }`;
  - `encodeHeader(h) → Buffer`, `decodeHeader(buf) → BackupHeader`;
  - `KeyMaterial { pwKey: Buffer; pwSalt: Buffer; params: ScryptParams }`;
  - `encryptFile(src, dest, key: KeyMaterial) → Promise<void>`;
  - `decryptFile(src, dest, getPwKey: (h: BackupHeader) => Promise<Buffer>) → Promise<{ header; pwKey }>`;
  - `Manifest { formatVersion: 1; appVersion; latestMigration; createdAt; attachmentCount; dbDumpSha256 }`;
  - `packBackup(o: { workDir; dumpPath; attachmentsDir; appVersion; latestMigration; now: Date; key: KeyMaterial; outPath }) → Promise<Manifest>`;
  - `unpackBackup(o: { srcPath; workDir; getPwKey }) → Promise<{ manifest; dumpPath; attachmentsDir; pwKey; pwSalt; params }>`;
  - `attachmentsFingerprint(dir) → Promise<string>`;
  - `backupFileName(now: Date) → string`.

- [ ] **Step 1: Write the failing test**

`tests/unit/backup/archive.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  packBackup, unpackBackup, encodeHeader, decodeHeader, attachmentsFingerprint, backupFileName,
  HEADER_LEN, type KeyMaterial,
} from "../../../desktop/backup/archive";
import { derivePwKey } from "../../../desktop/backup/keys";

const FAST = { N: 1024, r: 8, p: 1 };

async function setup(password = "pw-12345678") {
  const dir = await mkdtemp(join(tmpdir(), "trivio-archive-"));
  const dump = join(dir, "db.dump");
  await writeFile(dump, randomBytes(5000));
  const att = join(dir, "attachments");
  await mkdir(join(att, "org1"), { recursive: true });
  await writeFile(join(att, "org1", "r.pdf"), "receipt");
  const pwSalt = randomBytes(16);
  const key: KeyMaterial = { pwKey: await derivePwKey(password, pwSalt, FAST), pwSalt, params: FAST };
  const out = join(dir, "b.trivio-backup");
  await mkdir(join(dir, "work"));
  const manifest = await packBackup({
    workDir: join(dir, "work"), dumpPath: dump, attachmentsDir: att, appVersion: "0.1.25",
    latestMigration: "20260101000000_init", now: new Date("2026-10-02T14:30:00.123Z"), key, outPath: out,
  });
  return { dir, dump, att, out, manifest };
}

const withPassword = (pw: string) => (h: { pwSalt: Buffer; params: typeof FAST }) =>
  derivePwKey(pw, h.pwSalt, h.params);

describe("archive", () => {
  it("names files trivio-<UTC, colons→dashes, no ms>.trivio-backup", () => {
    expect(backupFileName(new Date("2026-10-02T14:30:00.123Z"))).toBe(
      "trivio-2026-10-02T14-30-00Z.trivio-backup",
    );
  });

  it("header round-trips and is exactly 60 bytes", () => {
    const h = { params: FAST, pwSalt: randomBytes(16), fileSalt: randomBytes(16), nonce: randomBytes(12) };
    const b = encodeHeader(h);
    expect(b).toHaveLength(HEADER_LEN);
    expect(b.subarray(0, 8).toString()).toBe("TRIVIOBK");
    const d = decodeHeader(b);
    expect(d.params).toEqual(FAST);
    expect(d.pwSalt.equals(h.pwSalt) && d.fileSalt.equals(h.fileSalt) && d.nonce.equals(h.nonce)).toBe(true);
  });

  it("round-trips dump + attachments with the right password", async () => {
    const { dir, dump, out, manifest } = await setup();
    expect(manifest.attachmentCount).toBe(1);
    await mkdir(join(dir, "w2"));
    const r = await unpackBackup({ srcPath: out, workDir: join(dir, "w2"), getPwKey: withPassword("pw-12345678") });
    expect((await readFile(r.dumpPath)).equals(await readFile(dump))).toBe(true);
    expect(await readFile(join(r.attachmentsDir, "org1", "r.pdf"), "utf8")).toBe("receipt");
    expect(r.manifest.latestMigration).toBe("20260101000000_init");
    expect(r.manifest.appVersion).toBe("0.1.25");
  });

  it("rejects a wrong password with WRONG_PASSWORD and leaves no plaintext behind", async () => {
    const { dir, out } = await setup();
    await mkdir(join(dir, "w2"));
    await expect(
      unpackBackup({ srcPath: out, workDir: join(dir, "w2"), getPwKey: withPassword("nope-nope-nope") }),
    ).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(readFile(join(dir, "w2", "body.tar"))).rejects.toThrow();
  });

  it.each([
    ["the header (scrypt salt)", 20],
    ["the body", HEADER_LEN + 10],
    ["the tag", -1],
  ])("rejects a flipped byte in %s", async (_label, offset) => {
    const { dir, out } = await setup();
    const buf = await readFile(out);
    const at = offset < 0 ? buf.length + offset : offset;
    buf[at] ^= 0x01;
    await writeFile(out, buf);
    await mkdir(join(dir, "w2"));
    await expect(
      unpackBackup({ srcPath: out, workDir: join(dir, "w2"), getPwKey: withPassword("pw-12345678") }),
    ).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
  });

  it("rejects a non-backup file with BAD_FORMAT and a future format version with NEWER_BACKUP", async () => {
    const { dir, out } = await setup();
    await writeFile(join(dir, "junk"), randomBytes(200));
    await mkdir(join(dir, "w2"));
    await expect(
      unpackBackup({ srcPath: join(dir, "junk"), workDir: join(dir, "w2"), getPwKey: withPassword("x") }),
    ).rejects.toMatchObject({ code: "BAD_FORMAT" });
    const buf = await readFile(out);
    buf[8] = 2;
    await writeFile(out, buf);
    await expect(
      unpackBackup({ srcPath: out, workDir: join(dir, "w2"), getPwKey: withPassword("pw-12345678") }),
    ).rejects.toMatchObject({ code: "NEWER_BACKUP" });
  });

  it("refuses absurd scrypt parameters from an untrusted header", () => {
    const b = encodeHeader({ params: FAST, pwSalt: randomBytes(16), fileSalt: randomBytes(16), nonce: randomBytes(12) });
    b.writeUInt32BE(2 ** 30, 9);
    expect(() => decodeHeader(b)).toThrow(/isn't a Trivio backup/);
  });

  it("attachments fingerprint changes when a file is added or modified, not otherwise", async () => {
    const { att } = await setup();
    const a = await attachmentsFingerprint(att);
    expect(await attachmentsFingerprint(att)).toBe(a);
    await utimes(join(att, "org1", "r.pdf"), new Date(), new Date(Date.now() + 5000));
    const b = await attachmentsFingerprint(att);
    expect(b).not.toBe(a);
    await writeFile(join(att, "org1", "s.pdf"), "x");
    expect(await attachmentsFingerprint(att)).not.toBe(b);
    expect(await attachmentsFingerprint(join(att, "missing"))).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/backup/archive.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement**

`desktop/backup/archive.ts`:
```ts
// A Trivio backup file: a 60-byte plaintext header (format version, scrypt
// parameters, salts, nonce) followed by an AES-256-GCM encrypted tar of
// manifest.json + db.dump + attachments/, then the 16-byte GCM tag. The header
// is the GCM "additional data", so editing any byte of it fails decryption just
// like a wrong password does. See docs/superpowers/specs/2026-10-02-google-drive-backup-design.md §3.

import { createReadStream, promises as fsp } from "node:fs";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { BackupError } from "./errors";
import { deriveFileKey, type ScryptParams } from "./keys";
import { extractTar, writeTar } from "./tar";

export const MAGIC = Buffer.from("TRIVIOBK", "ascii");
export const FORMAT_VERSION = 1;
export const HEADER_LEN = 60;
export const TAG_LEN = 16;

export interface BackupHeader {
  params: ScryptParams;
  pwSalt: Buffer;
  fileSalt: Buffer;
  nonce: Buffer;
}

export interface KeyMaterial {
  pwKey: Buffer;
  pwSalt: Buffer;
  params: ScryptParams;
}

export interface Manifest {
  formatVersion: 1;
  appVersion: string;
  latestMigration: string;
  createdAt: string;
  attachmentCount: number;
  dbDumpSha256: string;
}

export function encodeHeader(h: BackupHeader): Buffer {
  const b = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(b, 0);
  b.writeUInt8(FORMAT_VERSION, 8);
  b.writeUInt32BE(h.params.N, 9);
  b.writeUInt8(h.params.r, 13);
  b.writeUInt8(h.params.p, 14);
  h.pwSalt.copy(b, 15);
  h.fileSalt.copy(b, 31);
  h.nonce.copy(b, 47);
  // byte 59 reserved (0)
  return b;
}

export function decodeHeader(b: Buffer): BackupHeader {
  if (b.length < HEADER_LEN || !b.subarray(0, 8).equals(MAGIC)) throw new BackupError("BAD_FORMAT");
  const version = b.readUInt8(8);
  if (version > FORMAT_VERSION) throw new BackupError("NEWER_BACKUP");
  if (version !== FORMAT_VERSION) throw new BackupError("BAD_FORMAT");
  const params = { N: b.readUInt32BE(9), r: b.readUInt8(13), p: b.readUInt8(14) };
  // The header is untrusted until the tag verifies — bound the work it can ask for.
  const powerOfTwo = (params.N & (params.N - 1)) === 0;
  if (!powerOfTwo || params.N < 2 ** 10 || params.N > 2 ** 20 || params.r < 1 || params.r > 32 || params.p < 1 || params.p > 16) {
    throw new BackupError("BAD_FORMAT");
  }
  return {
    params,
    pwSalt: Buffer.from(b.subarray(15, 31)),
    fileSalt: Buffer.from(b.subarray(31, 47)),
    nonce: Buffer.from(b.subarray(47, 59)),
  };
}

export async function encryptFile(src: string, dest: string, key: KeyMaterial): Promise<void> {
  const header: BackupHeader = {
    params: key.params,
    pwSalt: key.pwSalt,
    fileSalt: randomBytes(16),
    nonce: randomBytes(12),
  };
  const hb = encodeHeader(header);
  const cipher = createCipheriv("aes-256-gcm", deriveFileKey(key.pwKey, header.fileSalt), header.nonce);
  cipher.setAAD(hb);
  const out = await fsp.open(dest, "w");
  try {
    await out.write(hb);
    for await (const chunk of createReadStream(src)) await out.write(cipher.update(chunk as Buffer));
    await out.write(cipher.final());
    await out.write(cipher.getAuthTag());
  } finally {
    await out.close();
  }
}

export async function decryptFile(
  src: string,
  dest: string,
  getPwKey: (h: BackupHeader) => Promise<Buffer>,
): Promise<{ header: BackupHeader; pwKey: Buffer }> {
  const fh = await fsp.open(src, "r");
  try {
    const { size } = await fh.stat();
    if (size < HEADER_LEN + TAG_LEN) throw new BackupError("BAD_FORMAT");
    const hb = Buffer.alloc(HEADER_LEN);
    await fh.read(hb, 0, HEADER_LEN, 0);
    const header = decodeHeader(hb);
    const tag = Buffer.alloc(TAG_LEN);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
    const pwKey = await getPwKey(header);
    const d = createDecipheriv("aes-256-gcm", deriveFileKey(pwKey, header.fileSalt), header.nonce);
    d.setAAD(hb);
    d.setAuthTag(tag);
    const out = await fsp.open(dest, "w");
    try {
      const buf = Buffer.alloc(1 << 20);
      const end = size - TAG_LEN;
      for (let at = HEADER_LEN; at < end; ) {
        const n = Math.min(buf.length, end - at);
        await fh.read(buf, 0, n, at);
        await out.write(d.update(buf.subarray(0, n)));
        at += n;
      }
      try {
        await out.write(d.final());
      } catch {
        throw new BackupError("WRONG_PASSWORD");
      }
    } catch (err) {
      await out.close();
      await fsp.rm(dest, { force: true }); // never leave unauthenticated plaintext
      throw err;
    }
    await out.close();
    return { header, pwKey };
  } finally {
    await fh.close();
  }
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

// Cheap "did the uploads change?" check: names, sizes and modification times.
export async function attachmentsFingerprint(dir: string): Promise<string> {
  const h = createHash("sha256");
  for (const rel of await listFiles(dir)) {
    const st = await fsp.stat(join(dir, ...rel.split("/")));
    h.update(`${rel}\t${st.size}\t${Math.floor(st.mtimeMs)}\n`);
  }
  return h.digest("hex");
}

export function backupFileName(now: Date): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  return `trivio-${iso}.trivio-backup`;
}

export async function packBackup(o: {
  workDir: string;
  dumpPath: string;
  attachmentsDir: string;
  appVersion: string;
  latestMigration: string;
  now: Date;
  key: KeyMaterial;
  outPath: string;
}): Promise<Manifest> {
  const files = await listFiles(o.attachmentsDir);
  const manifest: Manifest = {
    formatVersion: 1,
    appVersion: o.appVersion,
    latestMigration: o.latestMigration,
    createdAt: o.now.toISOString(),
    attachmentCount: files.length,
    dbDumpSha256: await sha256File(o.dumpPath),
  };
  const manifestPath = join(o.workDir, "manifest.json");
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const tarPath = join(o.workDir, "body.tar");
  await writeTar(tarPath, [
    { name: "manifest.json", path: manifestPath },
    { name: "db.dump", path: o.dumpPath },
    ...files.map((f) => ({ name: `attachments/${f}`, path: join(o.attachmentsDir, ...f.split("/")) })),
  ]);
  try {
    await encryptFile(tarPath, o.outPath, o.key);
  } finally {
    await fsp.rm(tarPath, { force: true });
  }
  return manifest;
}

export async function unpackBackup(o: {
  srcPath: string;
  workDir: string;
  getPwKey: (h: BackupHeader) => Promise<Buffer>;
}): Promise<{
  manifest: Manifest;
  dumpPath: string;
  attachmentsDir: string;
  pwKey: Buffer;
  pwSalt: Buffer;
  params: ScryptParams;
}> {
  const tarPath = join(o.workDir, "body.tar");
  const { header, pwKey } = await decryptFile(o.srcPath, tarPath, o.getPwKey);
  const outDir = join(o.workDir, "restore");
  await fsp.rm(outDir, { recursive: true, force: true });
  try {
    await extractTar(tarPath, outDir);
  } catch (err) {
    throw new BackupError("BAD_FORMAT", err instanceof Error ? err.message : String(err));
  } finally {
    await fsp.rm(tarPath, { force: true });
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(join(outDir, "manifest.json"), "utf8"));
  } catch {
    throw new BackupError("BAD_FORMAT");
  }
  if (manifest.formatVersion !== 1) throw new BackupError("NEWER_BACKUP");
  const dumpPath = join(outDir, "db.dump");
  const actual = await sha256File(dumpPath).catch(() => "");
  if (actual !== manifest.dbDumpSha256) throw new BackupError("BAD_FORMAT");
  const attachmentsDir = join(outDir, "attachments");
  await fsp.mkdir(attachmentsDir, { recursive: true });
  return { manifest, dumpPath, attachmentsDir, pwKey, pwSalt: header.pwSalt, params: header.params };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/backup/archive.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/backup/archive.ts tests/unit/backup/archive.test.ts
git commit -m "feat(backup): encrypted backup archive format"
```

---

### Task 5: Postgres tools; the embedded handle exposes config + migrate

**Files:**
- Create: `desktop/backup/pg-tools.ts`
- Modify: `desktop/embedded/embedded-db.ts`:
  - `interface DatabaseHandle` (≈ line 73);
  - the step-4 migrate block and the `return` at the end of `startEmbeddedDatabase` (lines 543–563).
- Test:
  - `tests/unit/backup/pg-tools.pg.test.ts` runs against real Postgres and is skipped when the embedded binaries are absent;
  - one new case in `tests/unit/embedded-db.test.ts`.

**Interfaces:**
- Consumes: `withEngineLibPath`, `withSafeLocale`, `startEmbeddedDatabase`, `EmbeddedDbConfig` from `desktop/embedded/embedded-db.ts`.
- Produces:
  - `DatabaseHandle.config?: EmbeddedDbConfig` and `DatabaseHandle.migrate?: () => Promise<void>`;
  - `PgConn { binDir; libDir?; host; port; user; password; database }`;
  - `connFromConfig(cfg: EmbeddedDbConfig): PgConn`;
  - `sql(conn, db, query) → Promise<string>`;
  - `dumpDatabase(conn, outPath)`, `restoreDatabase(conn, dbName, dumpPath)`;
  - `createDatabase(conn, name)`, `dropDatabase(conn, name)`;
  - `swapDatabases(conn, { live, incoming, previous })`;
  - `dataFingerprint(conn) → Promise<string>`;
  - `appliedMigrations(conn, db?) → Promise<string[]>`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("startEmbeddedDatabase", ...)` in `tests/unit/embedded-db.test.ts`. It reuses that file's `fakeChild()` and `opts()` helpers:
```ts
  it("returns a handle exposing its config and a way to re-run migrations", async () => {
    const spawnImpl: any = () => {
      const child = fakeChild();
      child.kill = vi.fn(() => {
        child.killed = true;
        process.nextTick(() => child.emit("exit", 0));
        return true;
      });
      return child;
    };
    const migrate = vi.fn(async () => {});
    const handle = await startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: () => true, // engine found, cluster already initialised
        mkdirSyncImpl: () => {},
        rmSyncImpl: () => {},
        readdirSyncImpl: () => [],
        pickPortImpl: async () => 6543,
        waitForReady: async () => {},
        ensureMigrated: migrate,
        log: () => {},
      })
    );
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(handle.config?.port).toBe(6543);
    expect(handle.config?.database).toBe("trivio");
    await handle.migrate!();
    expect(migrate).toHaveBeenCalledTimes(2);
    await handle.stop();
  });
```

`tests/unit/backup/pg-tools.pg.test.ts`:
```ts
// Real-Postgres check of the backup/restore database moves, using the engine
// bundled with the desktop app (desktop/embedded/bin, fetched by
// `npm run fetch:pg`). Skipped when that engine isn't on this machine.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startEmbeddedDatabase, type DatabaseHandle } from "../../../desktop/embedded/embedded-db";
import {
  appliedMigrations, connFromConfig, createDatabase, dataFingerprint, dropDatabase, dumpDatabase,
  restoreDatabase, sql, swapDatabases, type PgConn,
} from "../../../desktop/backup/pg-tools";

const embedded = resolve(__dirname, "../../../desktop/embedded");
const hasEngine = existsSync(join(embedded, "bin", process.platform === "win32" ? "initdb.exe" : "initdb"));

describe.skipIf(!hasEngine)("pg-tools against a scratch embedded Postgres", () => {
  let handle: DatabaseHandle;
  let conn: PgConn;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "trivio-pg-"));
    handle = await startEmbeddedDatabase({
      env: { ...process.env, TRIVIO_DB_DIR: join(dir, "db") },
      userDataDir: dir,
      resourcesDir: embedded,
      serverDir: resolve(__dirname, "../../.."),
      ensureMigrated: async () => {},
      log: () => {},
    });
    conn = connFromConfig(handle.config!);
    await createDatabase(conn, "trivio");
    await sql(conn, "trivio", `
      create table _prisma_migrations (migration_name text, finished_at timestamptz, rolled_back_at timestamptz);
      insert into _prisma_migrations values ('20260101000000_init', now(), null), ('20260201000000_two', now(), null);
      create table lines (entry int, debit numeric(19,4), credit numeric(19,4));
      insert into lines values (1, 100.5, 0), (1, 0, 100.5), (2, 42, 0), (2, 0, 42);
    `);
  }, 60_000);

  afterAll(async () => {
    await handle?.stop();
  });

  it("lists applied migrations in order", async () => {
    expect(await appliedMigrations(conn)).toEqual(["20260101000000_init", "20260201000000_two"]);
  });

  it("fingerprint ignores reads and changes on writes", async () => {
    const a = await dataFingerprint(conn);
    await sql(conn, "trivio", "select count(*) from lines");
    expect(await dataFingerprint(conn)).toBe(a);
    await sql(conn, "trivio", "insert into lines values (3, 1, 0), (3, 0, 1)");
    expect(await dataFingerprint(conn)).not.toBe(a);
  });

  it("dump → restore into a side DB → atomic swap brings the old data back, balanced", async () => {
    const dump = join(dir, "db.dump");
    await dumpDatabase(conn, dump);
    const before = await sql(conn, "trivio", "select count(*) from lines");
    await sql(conn, "trivio", "insert into lines values (9, 5, 0), (9, 0, 5)"); // changed after the backup

    await dropDatabase(conn, "trivio_restore");
    await createDatabase(conn, "trivio_restore");
    await restoreDatabase(conn, "trivio_restore", dump);
    await swapDatabases(conn, { live: "trivio", incoming: "trivio_restore", previous: "trivio_before_restore" });

    expect(await sql(conn, "trivio", "select count(*) from lines")).toBe(before);
    expect(
      await sql(conn, "trivio", "select count(*) from (select entry from lines group by entry having sum(debit) <> sum(credit)) x"),
    ).toBe("0");
    // the pre-restore data is kept aside until the next successful backup
    expect(await sql(conn, "trivio_before_restore", "select count(*) from lines where entry = 9")).toBe("2");
  });

  it("a corrupt dump fails pg_restore and leaves the live DB alone", async () => {
    const bad = join(dir, "bad.dump");
    await writeFile(bad, "not a dump");
    const live = await sql(conn, "trivio", "select count(*) from lines");
    await dropDatabase(conn, "trivio_restore");
    await createDatabase(conn, "trivio_restore");
    await expect(restoreDatabase(conn, "trivio_restore", bad)).rejects.toThrow(/pg_restore/);
    await dropDatabase(conn, "trivio_restore");
    expect(await sql(conn, "trivio", "select count(*) from lines")).toBe(live);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/embedded-db.test.ts tests/unit/backup/pg-tools.pg.test.ts`
Expected: FAIL. `handle.config` is undefined, and `pg-tools` cannot be resolved.

- [ ] **Step 3: Implement**

In `desktop/embedded/embedded-db.ts`, add after `stop` in `interface DatabaseHandle`:
```ts
  // Embedded only: the resolved engine config (binaries, port, credentials),
  // used by the backup feature to run pg_dump/pg_restore/psql against it.
  config?: EmbeddedDbConfig;
  // Embedded only: re-apply the Prisma migrations (after a restore swapped in
  // a database from an older app version).
  migrate?: () => Promise<void>;
```
In `startEmbeddedDatabase`, replace the step-4 `if (opts.ensureMigrated) { ... } else { ... }` block and the `return { ... }` with the code below. Keep the existing step-4 comment above `const migrate`.
```ts
  const migrate = () =>
    opts.ensureMigrated
      ? opts.ensureMigrated(cfg, opts.serverDir, opts.env)
      : ensureMigrated(
          cfg,
          opts.serverDir,
          opts.env,
          undefined,
          undefined,
          undefined,
          resolveHiddenNodeExecPath(opts.isPackaged === true, opts.resourcesDir, process.platform, exists)
        );
  await migrate();

  return {
    mode: "embedded",
    url: buildDatabaseUrl(cfg),
    host: cfg.host,
    port: cfg.port,
    dataDir: cfg.dataDir,
    config: cfg,
    migrate,
    stop: () => stopDatabaseProcess(server, log),
  };
```

`desktop/backup/pg-tools.ts`:
```ts
// Thin wrappers over the Postgres client tools bundled with the embedded
// engine (pg_dump, pg_restore, psql). Everything the backup feature does to the
// database goes through here.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { withEngineLibPath, withSafeLocale, type EmbeddedDbConfig } from "../embedded/embedded-db";

export interface PgConn {
  binDir: string;
  libDir?: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function connFromConfig(cfg: EmbeddedDbConfig): PgConn {
  return {
    binDir: dirname(cfg.postgresBinary),
    libDir: cfg.libDir,
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
  };
}

function tool(conn: PgConn, name: string): string {
  return join(conn.binDir, name + (process.platform === "win32" ? ".exe" : ""));
}

function target(conn: PgConn, db: string): string[] {
  return ["-h", conn.host, "-p", String(conn.port), "-U", conn.user, "-d", db];
}

// Only our own fixed names ever reach SQL; refuse anything else outright.
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`invalid database name: ${name}`);
  return `"${name}"`;
}

export function runPg(conn: PgConn, name: string, args: string[]): Promise<string> {
  const env = withSafeLocale(
    withEngineLibPath({ ...process.env, PGPASSWORD: conn.password, PGCONNECT_TIMEOUT: "10" }, conn.libDir),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(tool(conn, name), args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += String(d)));
    child.stderr.on("data", (d: Buffer) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${name} exited ${code}: ${err.trim()}`)),
    );
  });
}

export async function sql(conn: PgConn, db: string, query: string): Promise<string> {
  const out = await runPg(conn, "psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", ...target(conn, db), "-c", query]);
  return out.trim();
}

export async function dumpDatabase(conn: PgConn, outPath: string): Promise<void> {
  await runPg(conn, "pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "-f", outPath, ...target(conn, conn.database)]);
}

export async function restoreDatabase(conn: PgConn, db: string, dumpPath: string): Promise<void> {
  ident(db);
  await runPg(conn, "pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", ...target(conn, db), dumpPath]);
}

export async function createDatabase(conn: PgConn, name: string): Promise<void> {
  await sql(conn, "postgres", `create database ${ident(name)}`);
}

export async function dropDatabase(conn: PgConn, name: string): Promise<void> {
  await sql(conn, "postgres", `drop database if exists ${ident(name)} with (force)`);
}

// live → previous and incoming → live, both renames in ONE transaction, so a
// crash can never leave the app without a "trivio" database.
export async function swapDatabases(
  conn: PgConn,
  names: { live: string; incoming: string; previous: string },
): Promise<void> {
  const live = ident(names.live);
  const incoming = ident(names.incoming);
  const previous = ident(names.previous);
  await dropDatabase(conn, names.previous);
  await sql(
    conn,
    "postgres",
    `select pg_terminate_backend(pid) from pg_stat_activity
     where datname in ('${names.live}', '${names.incoming}') and pid <> pg_backend_pid()`,
  );
  await runPg(conn, "psql", [
    "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", ...target(conn, "postgres"),
    "-c", `alter database ${live} rename to ${previous}`,
    "-c", `alter database ${incoming} rename to ${live}`,
  ]);
}

// Changes only on data writes (inserts/updates/deletes), not on reads — so the
// backup's own queries don't count as "something changed". stats_reset moves
// if the statistics were ever reset (e.g. after a crash), which errs on the
// side of backing up.
export function dataFingerprint(conn: PgConn): Promise<string> {
  return sql(
    conn,
    conn.database,
    `select coalesce((select stats_reset::text from pg_stat_database where datname = current_database()), 'never')
       || '|' || (select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) from pg_stat_user_tables)`,
  );
}

export async function appliedMigrations(conn: PgConn, db = conn.database): Promise<string[]> {
  const out = await sql(
    conn,
    db,
    "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name",
  );
  return out ? out.split("\n") : [];
}
```

- [ ] **Step 4: Run the tests and the desktop typecheck**

First make sure the engine is present: `ls desktop/embedded/bin/initdb || npm run fetch:pg`.
Run: `npx vitest run tests/unit/embedded-db.test.ts tests/unit/backup/pg-tools.pg.test.ts && npm run typecheck:desktop`
Expected: PASS. The pg file reports 4 passed (not skipped), and there are no type errors.

- [ ] **Step 5: Commit**

```bash
git add desktop/embedded/embedded-db.ts desktop/backup/pg-tools.ts tests/unit/embedded-db.test.ts tests/unit/backup/pg-tools.pg.test.ts
git commit -m "feat(backup): pg_dump/pg_restore/psql wrappers with atomic database swap"
```

---

### Task 6: State file and secret store

**Files:**
- Create: `desktop/backup/state.ts`, `desktop/backup/secret-store.ts`
- Test: `tests/unit/backup/state.test.ts`

**Interfaces:**
- Consumes: `BackupErrorCode` and `ScryptParams` (Task 2).
- Produces:
  - `BackupState` (fields below) and `EMPTY_STATE`;
  - `loadState(file) → Promise<BackupState>`, `saveState(file, s) → Promise<void>`;
  - `SecretName = "google-token" | "key"`;
  - `SecretStoreLike { load(name): Promise<string|null>; save(name, v): Promise<void>; clear(name): Promise<void> }`;
  - `SecretCodec`;
  - `class FileSecretStore implements SecretStoreLike`;
  - `class MemorySecretStore implements SecretStoreLike`, for tests.

- [ ] **Step 1: Write the failing test**

`tests/unit/backup/state.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_STATE, loadState, saveState } from "../../../desktop/backup/state";
import { FileSecretStore } from "../../../desktop/backup/secret-store";

const scratch = () => mkdtemp(join(tmpdir(), "trivio-state-"));

// Reversible stand-in for Electron's safeStorage.
const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, "utf8").reverse(),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString("utf8"),
};

describe("state", () => {
  it("returns defaults when the file is missing or corrupt", async () => {
    const dir = await scratch();
    expect(await loadState(join(dir, "state.json"))).toEqual(EMPTY_STATE);
    await writeFile(join(dir, "state.json"), "{not json");
    expect(await loadState(join(dir, "state.json"))).toEqual(EMPTY_STATE);
  });

  it("saves atomically and loads back, filling fields added later", async () => {
    const dir = await scratch();
    const file = join(dir, "state.json");
    await saveState(file, { ...EMPTY_STATE, email: "a@b.c", keptCount: 3 });
    expect(await readdir(dir)).toEqual(["state.json"]); // no temp file left
    const { keptCount, ...older } = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify(older));
    const loaded = await loadState(file);
    expect(loaded.email).toBe("a@b.c");
    expect(loaded.keptCount).toBe(0);
    expect(keptCount).toBe(3);
  });
});

describe("FileSecretStore", () => {
  it("round-trips through the codec, never storing plaintext, and clears", async () => {
    const dir = await scratch();
    const store = new FileSecretStore(dir, codec);
    expect(await store.load("key")).toBeNull();
    await store.save("key", "c2VjcmV0");
    expect((await readFile(join(dir, "key.bin"))).toString("utf8")).not.toContain("c2VjcmV0");
    expect(await store.load("key")).toBe("c2VjcmV0");
    await store.clear("key");
    expect(await store.load("key")).toBeNull();
  });

  it("refuses to save when the OS keychain is unavailable", async () => {
    const store = new FileSecretStore(await scratch(), { ...codec, isEncryptionAvailable: () => false });
    await expect(store.save("key", "x")).rejects.toThrow(/keychain/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/backup/state.test.ts`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Implement**

`desktop/backup/state.ts`:
```ts
// userData/backup/state.json — what Settings → Backup shows instantly on open,
// plus the bits the scheduler needs between launches. Written atomically.

import { promises as fsp } from "node:fs";
import type { BackupErrorCode } from "./errors";
import type { ScryptParams } from "./keys";

export interface BackupState {
  email: string | null;
  folderId: string | null;
  pwSalt: string | null; // base64
  scrypt: ScryptParams | null;
  verifier: string | null;
  lastSuccessAt: string | null; // ISO 8601 UTC
  lastAttemptAt: string | null;
  lastCheckedAt: string | null;
  lastError: { code: BackupErrorCode; message: string } | null;
  failingSince: string | null;
  failureNotified: boolean;
  fingerprint: string | null;
  keptCount: number;
  cleanupPending: boolean; // a restore left trivio_before_restore / attachments_before_restore
}

export const EMPTY_STATE: BackupState = {
  email: null,
  folderId: null,
  pwSalt: null,
  scrypt: null,
  verifier: null,
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastCheckedAt: null,
  lastError: null,
  failingSince: null,
  failureNotified: false,
  fingerprint: null,
  keptCount: 0,
  cleanupPending: false,
};

export async function loadState(file: string): Promise<BackupState> {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    return { ...EMPTY_STATE, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export async function saveState(file: string, state: BackupState): Promise<void> {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
  await fsp.rename(tmp, file);
}
```

`desktop/backup/secret-store.ts`:
```ts
// Small secrets (the Google refresh token, the backup key) kept on disk only
// in encrypted form, using the OS keychain via Electron's safeStorage (passed
// in as `codec` so this file stays testable without Electron).

import { promises as fsp } from "node:fs";
import { join } from "node:path";

export type SecretName = "google-token" | "key";

export interface SecretStoreLike {
  load(name: SecretName): Promise<string | null>;
  save(name: SecretName, value: string): Promise<void>;
  clear(name: SecretName): Promise<void>;
}

export interface SecretCodec {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class FileSecretStore implements SecretStoreLike {
  constructor(private readonly dir: string, private readonly codec: SecretCodec) {}

  private file(name: SecretName): string {
    return join(this.dir, `${name}.bin`);
  }

  async load(name: SecretName): Promise<string | null> {
    try {
      return this.codec.decryptString(await fsp.readFile(this.file(name)));
    } catch {
      return null;
    }
  }

  async save(name: SecretName, value: string): Promise<void> {
    if (!this.codec.isEncryptionAvailable()) {
      throw new Error("The system keychain isn't available, so Trivio can't store the backup key safely.");
    }
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(name)}.tmp`;
    await fsp.writeFile(tmp, this.codec.encryptString(value));
    await fsp.rename(tmp, this.file(name));
  }

  async clear(name: SecretName): Promise<void> {
    await fsp.rm(this.file(name), { force: true });
  }
}

export class MemorySecretStore implements SecretStoreLike {
  readonly values = new Map<SecretName, string>();
  async load(name: SecretName) {
    return this.values.get(name) ?? null;
  }
  async save(name: SecretName, value: string) {
    this.values.set(name, value);
  }
  async clear(name: SecretName) {
    this.values.delete(name);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/backup/state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/backup/state.ts desktop/backup/secret-store.ts tests/unit/backup/state.test.ts
git commit -m "feat(backup): state file and keychain-backed secret store"
```

---

### Task 7: Google sign-in (loopback + PKCE)

**Files:**
- Create: `desktop/backup/google-auth.ts`
- Test: `tests/unit/backup/google-auth.test.ts`

**Interfaces:**
- Consumes: `BackupError` (Task 2); `SecretStoreLike` and `MemorySecretStore` (Task 6).
- Produces:
  - `OAuthClient { clientId; clientSecret }` and `SCOPES`;
  - helpers `pkcePair()`, `buildAuthUrl(o)`, `emailFromIdToken(t)`, `waitForAuthCode(state, timeoutMs)`;
  - `class GoogleAuth { connect(): Promise<{email}>; accessToken(): Promise<string>; forgetAccessToken(): void; disconnect(): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

`tests/unit/backup/google-auth.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  GoogleAuth, buildAuthUrl, emailFromIdToken, pkcePair, waitForAuthCode, SCOPES,
} from "../../../desktop/backup/google-auth";
import { MemorySecretStore } from "../../../desktop/backup/secret-store";

const client = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const idToken = (email: string) =>
  `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

function tokenEndpoint(responses: Array<{ status: number; body: unknown }>) {
  const calls: URLSearchParams[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/revoke")) return new Response("", { status: 200 });
    calls.push(new URLSearchParams(String(init?.body)));
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("google-auth helpers", () => {
  it("PKCE challenge is base64url(sha256(verifier))", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("auth URL asks for drive.file + email only, offline access, S256", () => {
    const u = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:5000", challenge: "ch", state: "st" }));
    expect(u.searchParams.get("scope")).toBe(SCOPES.join(" "));
    expect(SCOPES).toEqual(["https://www.googleapis.com/auth/drive.file", "openid", "email"]);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe("st");
  });

  it("reads the email from an id_token", () => {
    expect(emailFromIdToken(idToken("me@example.com"))).toBe("me@example.com");
  });

  it("loopback listener ignores a wrong state and resolves on the right one", async () => {
    const w = await waitForAuthCode("good", 5000);
    expect((await fetch(`${w.redirectUri}?state=bad&code=x`)).status).toBe(400);
    const ok = await fetch(`${w.redirectUri}?state=good&code=the-code`);
    expect(await ok.text()).toContain("Connected");
    await expect(w.code).resolves.toBe("the-code");
  });

  it("loopback listener reports a denied consent and a timeout", async () => {
    const denied = await waitForAuthCode("s", 5000);
    await fetch(`${denied.redirectUri}?state=s&error=access_denied`);
    await expect(denied.code).rejects.toMatchObject({ code: "AUTH_CANCELLED" });
    const slow = await waitForAuthCode("s", 30);
    await expect(slow.code).rejects.toMatchObject({ code: "AUTH_TIMEOUT" });
  });
});

describe("GoogleAuth", () => {
  it("connect: opens the browser, exchanges the code, stores the refresh token", async () => {
    const store = new MemorySecretStore();
    const { fetchImpl, calls } = tokenEndpoint([
      { status: 200, body: { access_token: "at1", expires_in: 3600, refresh_token: "rt1", id_token: idToken("me@x.com") } },
    ]);
    const openExternal = async (url: string) => {
      const u = new URL(url);
      await fetch(`${u.searchParams.get("redirect_uri")}?state=${u.searchParams.get("state")}&code=c1`);
    };
    const auth = new GoogleAuth(client, store, { fetch: fetchImpl, openExternal });
    await expect(auth.connect()).resolves.toEqual({ email: "me@x.com" });
    expect(await store.load("google-token")).toBe("rt1");
    expect(calls[0].get("code")).toBe("c1");
    expect(calls[0].get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await auth.accessToken()).toBe("at1"); // cached, no second call
    expect(calls).toHaveLength(1);
  });

  it("accessToken refreshes when expired and maps invalid_grant to AUTH_REVOKED", async () => {
    const store = new MemorySecretStore();
    await store.save("google-token", "rt1");
    let now = 1_000_000;
    const { fetchImpl } = tokenEndpoint([
      { status: 200, body: { access_token: "at2", expires_in: 3600 } },
      { status: 400, body: { error: "invalid_grant" } },
    ]);
    const auth = new GoogleAuth(client, store, { fetch: fetchImpl, openExternal: async () => {}, now: () => now });
    expect(await auth.accessToken()).toBe("at2");
    now += 3600_000;
    await expect(auth.accessToken()).rejects.toMatchObject({ code: "AUTH_REVOKED" });
  });

  it("accessToken without a stored token is NOT_CONNECTED; disconnect clears it", async () => {
    const store = new MemorySecretStore();
    const { fetchImpl } = tokenEndpoint([]);
    const auth = new GoogleAuth(client, store, { fetch: fetchImpl, openExternal: async () => {} });
    await expect(auth.accessToken()).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    await store.save("google-token", "rt");
    await auth.disconnect();
    expect(await store.load("google-token")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/backup/google-auth.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement**

`desktop/backup/google-auth.ts`:
```ts
// "Connect Google Drive": the installed-app OAuth flow. We open Google's
// consent page in the user's normal browser and catch the redirect on a
// one-time loopback listener (127.0.0.1:<random port>). PKCE protects the code
// exchange; a Desktop-type client secret is not confidential by Google's
// definition. Only the drive.file scope is requested: Trivio sees only the
// files it created.

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BackupError } from "./errors";
import type { SecretStoreLike } from "./secret-store";

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    state: o.state,
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return u.toString();
}

export function emailFromIdToken(idToken: string): string {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

const page = (title: string) =>
  `<!doctype html><meta charset="utf-8"><title>Trivio</title>` +
  `<body style="font-family:system-ui;padding:4rem;text-align:center"><h1>${title}</h1><p>You can return to Trivio.</p></body>`;

export function waitForAuthCode(
  state: string,
  timeoutMs: number,
): Promise<{ redirectUri: string; code: Promise<string>; close: () => void }> {
  return new Promise((resolveStart, rejectStart) => {
    let settle!: { resolve: (c: string) => void; reject: (e: Error) => void };
    const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
    code.catch(() => {}); // the caller may stop waiting; don't crash on an unobserved rejection
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400).end("state mismatch");
        return;
      }
      const got = url.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(got ? "Connected — you can close this tab" : "Sign-in was cancelled"));
      if (got) settle.resolve(got);
      else settle.reject(new BackupError("AUTH_CANCELLED", url.searchParams.get("error") ?? undefined));
      close();
    });
    const timer = setTimeout(() => {
      settle.reject(new BackupError("AUTH_TIMEOUT"));
      close();
    }, timeoutMs);
    function close() {
      clearTimeout(timer);
      server.close();
    }
    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolveStart({ redirectUri: `http://127.0.0.1:${port}`, code, close });
    });
  });
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

async function postToken(fetchImpl: typeof fetch, body: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  } catch (err) {
    throw new BackupError("OFFLINE", err instanceof Error ? err.message : String(err));
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new BackupError("AUTH_REVOKED");
    if (res.status >= 500) throw new BackupError("OFFLINE", `token endpoint ${res.status}`);
    throw new Error(`Google token error ${res.status}: ${String(json.error ?? "")} ${String(json.error_description ?? "")}`.trim());
  }
  return json as unknown as TokenResponse;
}

export class GoogleAuth {
  private cached: { token: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly client: OAuthClient,
    private readonly store: SecretStoreLike,
    private readonly deps: {
      openExternal: (url: string) => Promise<void> | void;
      fetch?: typeof fetch;
      now?: () => number;
      timeoutMs?: number;
    },
  ) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  async connect(): Promise<{ email: string }> {
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(16).toString("base64url");
    const wait = await waitForAuthCode(state, this.deps.timeoutMs ?? 5 * 60_000);
    try {
      await this.deps.openExternal(
        buildAuthUrl({ clientId: this.client.clientId, redirectUri: wait.redirectUri, challenge, state }),
      );
      const code = await wait.code;
      const t = await postToken(this.fetchImpl, {
        client_id: this.client.clientId,
        client_secret: this.client.clientSecret,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: wait.redirectUri,
      });
      if (!t.refresh_token) throw new Error("Google did not return a refresh token");
      await this.store.save("google-token", t.refresh_token);
      this.cached = { token: t.access_token, expiresAt: this.now() + t.expires_in * 1000 };
      return { email: emailFromIdToken(t.id_token ?? "") };
    } finally {
      wait.close();
    }
  }

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;
    const refreshToken = await this.store.load("google-token");
    if (!refreshToken) throw new BackupError("NOT_CONNECTED");
    const t = await postToken(this.fetchImpl, {
      client_id: this.client.clientId,
      client_secret: this.client.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    this.cached = { token: t.access_token, expiresAt: this.now() + t.expires_in * 1000 };
    return t.access_token;
  }

  // Drive answered 401: drop the cached token so the next call refreshes.
  forgetAccessToken(): void {
    this.cached = null;
  }

  async disconnect(): Promise<void> {
    const refreshToken = await this.store.load("google-token");
    this.cached = null;
    await this.store.clear("google-token");
    if (refreshToken) {
      await this.fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => {});
    }
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/backup/google-auth.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/backup/google-auth.ts tests/unit/backup/google-auth.test.ts
git commit -m "feat(backup): Google sign-in with loopback redirect and PKCE"
```

---

### Task 8: Drive client

**Files:**
- Create: `desktop/backup/drive-client.ts`
- Test: `tests/unit/backup/drive-client.test.ts`

**Interfaces:**
- Consumes: `BackupError` (Task 2).
- Produces:
  - `FOLDER_NAME`, `BACKUP_SUFFIX`;
  - `DriveFile { id; name; size: number; createdTime: string; appVersion: string | null }`;
  - `DriveLike { ensureFolder(knownId: string|null): Promise<string>; upload(folderId, name, filePath, appVersion): Promise<DriveFile>; list(folderId): Promise<DriveFile[]>; download(id, dest): Promise<void>; delete(id): Promise<void> }`;
  - `class DriveClient implements DriveLike`, constructed with `(deps: { token: () => Promise<string>; onUnauthorized?: () => void; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; chunkSize?: number })`.

- [ ] **Step 1: Write the failing test**

`tests/unit/backup/drive-client.test.ts`:
```ts
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
  const add = (name: string, parents: string[], data = Buffer.alloc(0), extra: any = {}) => {
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
      if (url.searchParams.get("alt") === "media") return new Response(f.data);
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/backup/drive-client.test.ts`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement**

`desktop/backup/drive-client.ts`:
```ts
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
        if (attempt === 0) {
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
      const res = await this.call(`${API}/files/${knownId}?fields=id,trashed`, {}, [200, 404]);
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
          offset = nextOffset(res.headers.get("range"));
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
    const res = await this.call(`${API}/files/${fileId}?alt=media`);
    if (!res.body) throw new Error("Drive returned an empty download");
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(destPath));
  }

  async delete(fileId: string): Promise<void> {
    await this.call(`${API}/files/${fileId}`, { method: "DELETE" }, [204, 404]);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/backup/drive-client.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/backup/drive-client.ts tests/unit/backup/drive-client.test.ts
git commit -m "feat(backup): Google Drive client with resumable upload"
```

---

### Task 9: Backup service — connect, password, scheduled backup, prune

**Files:**
- Create: `desktop/backup/backup-service.ts`
- Test: `tests/unit/backup/backup-service.test.ts`, `tests/unit/backup/fakes.ts`

**Interfaces:**
- Consumes: everything from Tasks 2, 4 and 6; `DriveLike` and `DriveFile` (Task 8).
- Produces:
  - the types `DbLike`, `ServerLike`, `AuthLike`, `ServiceDeps`, `BackupStatus`, `BackupProgress`, `BackupEntry` (exact shapes in the code below);
  - `class BackupService` with `init()`, `startSchedule()`, `stopSchedule()`, `status()`, `connect()`, `setPassword(pw)`, `isDue()`, `tick()`, `backupNow()`, `list()`, `restore(id, pw)`, `disconnect()`.

  `list`, `restore` and `disconnect` are implemented in Task 10. In this task they exist and throw `new Error("not implemented")`.

- [ ] **Step 1: Write the shared fakes**

`tests/unit/backup/fakes.ts`:
```ts
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
```

- [ ] **Step 2: Write the failing test**

`tests/unit/backup/backup-service.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BackupService } from "../../../desktop/backup/backup-service";
import { BackupError } from "../../../desktop/backup/errors";
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
    await expect(svc.setPassword("short")).rejects.toThrow(/at least 8/);
    await svc.setPassword("pw-12345678");
    expect(svc.status().passwordSet).toBe(true);
  });

  it("remembers the key across restarts (init reloads it from the secret store)", async () => {
    const t = await ready();
    const again = new BackupService(t.deps);
    await again.init();
    expect(again.status().passwordSet).toBe(true);
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
    expect(t.svc.status().keptCount).toBe(10);
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/backup/backup-service.test.ts`
Expected: FAIL, because the `backup-service` module cannot be resolved.

- [ ] **Step 4: Implement**

`desktop/backup/backup-service.ts`:
```ts
// The backup feature's brain: when to back up, what goes in a backup, how
// many to keep, and how to restore one. Every outside effect (Google, Drive,
// Postgres, the app server, notifications, the clock) is injected, so the
// whole flow is unit-tested with fakes. desktop/backup/wire.ts builds the real
// thing. See docs/superpowers/specs/2026-10-02-google-drive-backup-design.md.

import { randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { attachmentsFingerprint, backupFileName, packBackup, unpackBackup } from "./archive";
import type { DriveLike } from "./drive-client";
import { BackupError, toBackupError } from "./errors";
import { DEFAULT_SCRYPT, checkVerifier, derivePwKey, makeVerifier, normalizePassword, type ScryptParams } from "./keys";
import type { SecretStoreLike } from "./secret-store";
import { loadState, saveState, type BackupState } from "./state";

const DAY = 24 * 3600_000;
const NOTIFY_AFTER = 48 * 3600_000;
const KEEP = 10;

export interface AuthLike {
  connect(): Promise<{ email: string }>;
  disconnect(): Promise<void>;
}

export interface DbLike {
  dump(outPath: string): Promise<void>;
  fingerprint(): Promise<string>;
  appliedMigrations(): Promise<string[]>;
  restore(dumpPath: string): Promise<void>; // into trivio_restore (recreated)
  swapIn(): Promise<void>; // trivio→trivio_before_restore, trivio_restore→trivio
  undoSwap(): Promise<void>; // the reverse
  dropRestoreLeftovers(): Promise<void>; // drop trivio_restore
  dropPrevious(): Promise<void>; // drop trivio_before_restore
}

export interface ServerLike {
  stop(): Promise<void>;
  start(opts: { signOut: boolean }): Promise<void>;
}

export interface BackupStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  passwordSet: boolean;
  running: "backup" | "restore" | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastCheckedAt: string | null;
  lastError: { code: string; message: string } | null;
  failingSince: string | null;
  keptCount: number;
}

export type BackupProgress = {
  phase:
    | "dumping"
    | "encrypting"
    | "uploading"
    | "pruning"
    | "downloading"
    | "decrypting"
    | "restoring"
    | "restarting"
    | "done";
};

export interface BackupEntry {
  id: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  appVersion: string | null;
}

export interface ServiceDeps {
  dir: string; // userData/backup
  attachmentsDir: string; // userData/storage/attachments
  appVersion: string;
  configured: boolean; // a Google client ID was built in
  secrets: SecretStoreLike;
  auth: AuthLike;
  drive: DriveLike;
  db: DbLike;
  server: ServerLike;
  notify: (title: string, body: string) => void;
  onProgress?: (p: BackupProgress) => void;
  now?: () => Date;
  scrypt?: ScryptParams;
  keep?: number;
}

export class BackupService {
  private state!: BackupState;
  private pwKey: Buffer | null = null;
  private running: { kind: "backup" | "restore"; promise: Promise<void> } | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly d: ServiceDeps) {}

  private get stateFile() {
    return join(this.d.dir, "state.json");
  }
  private get tmp() {
    return join(this.d.dir, "tmp");
  }
  private now(): Date {
    return this.d.now ? this.d.now() : new Date();
  }
  private progress(phase: BackupProgress["phase"]) {
    this.d.onProgress?.({ phase });
  }
  private async update(patch: Partial<BackupState>): Promise<void> {
    this.state = { ...this.state, ...patch };
    await fsp.mkdir(this.d.dir, { recursive: true });
    await saveState(this.stateFile, this.state);
  }

  async init(): Promise<void> {
    this.state = await loadState(this.stateFile);
    await fsp.rm(this.tmp, { recursive: true, force: true });
    const stored = await this.d.secrets.load("key");
    if (stored && this.state.verifier) {
      const key = Buffer.from(stored, "base64");
      if (checkVerifier(key, this.state.verifier)) this.pwKey = key;
    }
  }

  startSchedule(everyMs = 3600_000, firstAfterMs = 60_000): void {
    const run = () => void this.tick();
    const first = setTimeout(run, firstAfterMs);
    const every = setInterval(run, everyMs);
    first.unref?.();
    every.unref?.();
    this.timers.push(first, every);
  }

  stopSchedule(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  status(): BackupStatus {
    const s = this.state;
    return {
      configured: this.d.configured,
      connected: !!s.email,
      email: s.email,
      passwordSet: !!this.pwKey,
      running: this.running?.kind ?? null,
      lastSuccessAt: s.lastSuccessAt,
      lastAttemptAt: s.lastAttemptAt,
      lastCheckedAt: s.lastCheckedAt,
      lastError: s.lastError,
      failingSince: s.failingSince,
      keptCount: s.keptCount,
    };
  }

  async connect(): Promise<{ email: string }> {
    if (!this.d.configured) throw new BackupError("NOT_CONFIGURED");
    const { email } = await this.d.auth.connect();
    await this.update({ email, lastError: null });
    return { email };
  }

  async setPassword(password: string): Promise<void> {
    if (normalizePassword(password).length < 8) throw new Error("Use at least 8 characters.");
    if (!this.state.email) throw new BackupError("NOT_CONNECTED");
    const params = this.d.scrypt ?? DEFAULT_SCRYPT;
    const pwSalt = randomBytes(16);
    await this.adoptKey(await derivePwKey(password, pwSalt, params), pwSalt, params);
  }

  private async adoptKey(key: Buffer, pwSalt: Buffer, params: ScryptParams): Promise<void> {
    await this.d.secrets.save("key", key.toString("base64"));
    this.pwKey = key;
    await this.update({ pwSalt: pwSalt.toString("base64"), scrypt: params, verifier: makeVerifier(key) });
  }

  isDue(): boolean {
    if (!this.d.configured || !this.state.email || !this.pwKey) return false;
    if (this.state.lastError?.code === "AUTH_REVOKED") return false;
    const now = this.now().getTime();
    const last = this.state.lastSuccessAt ? Date.parse(this.state.lastSuccessAt) : NaN;
    if (Number.isNaN(last) || last > now) return true;
    return now - last >= DAY;
  }

  async tick(): Promise<void> {
    if (this.running || !this.isDue()) return;
    await this.runBackup(false).catch(() => {}); // recorded in state; shown in Settings
  }

  async backupNow(): Promise<BackupStatus> {
    if (this.running?.kind === "restore") throw new BackupError("BUSY");
    await this.runBackup(true);
    return this.status();
  }

  private runBackup(force: boolean): Promise<void> {
    if (this.running?.kind === "backup") return this.running.promise;
    const promise = this.doBackup(force).finally(() => {
      this.running = null;
    });
    this.running = { kind: "backup", promise };
    return promise;
  }

  private requireReady(): void {
    if (!this.d.configured) throw new BackupError("NOT_CONFIGURED");
    if (!this.state.email) throw new BackupError("NOT_CONNECTED");
    if (!this.pwKey || !this.state.pwSalt || !this.state.scrypt) throw new BackupError("NO_PASSWORD");
  }

  private async doBackup(force: boolean): Promise<void> {
    this.requireReady();
    const startedAt = this.now();
    const work = join(this.tmp, `backup-${startedAt.getTime()}`);
    try {
      const fingerprint = `${await this.d.db.fingerprint()}|${await attachmentsFingerprint(this.d.attachmentsDir)}`;
      if (!force && fingerprint === this.state.fingerprint) {
        await this.update({ lastCheckedAt: startedAt.toISOString() });
        return;
      }
      await this.update({ lastAttemptAt: startedAt.toISOString() });
      await fsp.mkdir(work, { recursive: true });

      this.progress("dumping");
      const dumpPath = join(work, "db.dump");
      try {
        await this.d.db.dump(dumpPath);
      } catch (err) {
        throw toBackupError(err, "DUMP_FAILED");
      }
      const latestMigration = (await this.d.db.appliedMigrations()).at(-1) ?? "";

      this.progress("encrypting");
      const name = backupFileName(startedAt);
      const outPath = join(work, name);
      await packBackup({
        workDir: work,
        dumpPath,
        attachmentsDir: this.d.attachmentsDir,
        appVersion: this.d.appVersion,
        latestMigration,
        now: startedAt,
        key: { pwKey: this.pwKey!, pwSalt: Buffer.from(this.state.pwSalt!, "base64"), params: this.state.scrypt! },
        outPath,
      });

      this.progress("uploading");
      const folderId = await this.d.drive.ensureFolder(this.state.folderId);
      if (folderId !== this.state.folderId) await this.update({ folderId });
      const uploaded = await this.d.drive.upload(folderId, name, outPath, this.d.appVersion);
      const { size } = await fsp.stat(outPath);
      if (uploaded.size !== size) {
        throw new BackupError("BACKUP_FAILED", `Drive has ${uploaded.size} bytes, expected ${size}`);
      }

      this.progress("pruning");
      const all = await this.d.drive.list(folderId);
      const keep = this.d.keep ?? KEEP;
      for (const old of all.slice(keep)) await this.d.drive.delete(old.id);
      if (this.state.cleanupPending) await this.dropRestoreLeftovers();

      const doneAt = this.now().toISOString();
      await this.update({
        lastSuccessAt: doneAt,
        lastCheckedAt: doneAt,
        fingerprint,
        lastError: null,
        failingSince: null,
        failureNotified: false,
        keptCount: Math.min(all.length, keep),
        cleanupPending: false,
      });
      this.progress("done");
    } catch (err) {
      const e = toBackupError(err, "BACKUP_FAILED");
      const now = this.now();
      const failingSince = this.state.failingSince ?? now.toISOString();
      const notify = !this.state.failureNotified && now.getTime() - Date.parse(failingSince) >= NOTIFY_AFTER;
      await this.update({
        lastAttemptAt: now.toISOString(),
        lastError: { code: e.code, message: e.userMessage },
        failingSince,
        failureNotified: this.state.failureNotified || notify,
      });
      if (notify) this.d.notify("Trivio backups are failing", `${e.userMessage} Open Settings → Backup for details.`);
      console.error("[backup] failed:", e.message);
      throw e;
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
    }
  }

  private async dropRestoreLeftovers(): Promise<void> {
    await this.d.db.dropPrevious();
    await fsp.rm(`${this.d.attachmentsDir}_before_restore`, { recursive: true, force: true });
  }

  async list(): Promise<BackupEntry[]> {
    throw new Error("not implemented");
  }

  async restore(_id: string, _password: string): Promise<void> {
    throw new Error("not implemented");
  }

  async disconnect(): Promise<void> {
    throw new Error("not implemented");
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/unit/backup/backup-service.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: Commit**

```bash
git add desktop/backup/backup-service.ts tests/unit/backup/backup-service.test.ts tests/unit/backup/fakes.ts
git commit -m "feat(backup): backup service — schedule, change detection, upload, prune"
```

---

### Task 10: Backup service — list, restore, disconnect

**Files:**
- Modify: `desktop/backup/backup-service.ts` (replace the three `not implemented` methods)
- Test: `tests/unit/backup/backup-restore.test.ts`

**Interfaces:**
- Consumes: Task 9's `BackupService` internals and the fakes in `tests/unit/backup/fakes.ts`.
- Produces:
  - `list(): Promise<BackupEntry[]>`;
  - `restore(id, password): Promise<void>`, which resolves after the server has restarted;
  - `disconnect(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/backup/backup-restore.test.ts`:
```ts
import { describe, it, expect } from "vitest";
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/backup/backup-restore.test.ts`
Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement**

In `desktop/backup/backup-service.ts`:
1. Change the path import to `import { dirname, join } from "node:path";`.
2. Replace the three placeholder methods with:
```ts
  async list(): Promise<BackupEntry[]> {
    if (!this.state.email) throw new BackupError("NOT_CONNECTED");
    const folderId = await this.d.drive.ensureFolder(this.state.folderId);
    if (folderId !== this.state.folderId) await this.update({ folderId });
    return (await this.d.drive.list(folderId)).map((f) => ({
      id: f.id,
      name: f.name,
      createdAt: f.createdTime,
      sizeBytes: f.size,
      appVersion: f.appVersion,
    }));
  }

  restore(id: string, password: string): Promise<void> {
    if (this.running) return Promise.reject(new BackupError("BUSY"));
    const promise = this.doRestore(id, password).finally(() => {
      this.running = null;
    });
    this.running = { kind: "restore", promise };
    return promise;
  }

  private async doRestore(id: string, password: string): Promise<void> {
    if (!this.state.email) throw new BackupError("NOT_CONNECTED");
    const work = join(this.tmp, `restore-${this.now().getTime()}`);
    await fsp.mkdir(work, { recursive: true });
    try {
      this.progress("downloading");
      const src = join(work, "backup.trivio-backup");
      await this.d.drive.download(id, src);

      this.progress("decrypting");
      const unpacked = await unpackBackup({
        srcPath: src,
        workDir: work,
        getPwKey: (h) => derivePwKey(password, h.pwSalt, h.params),
      });
      const known = await this.d.db.appliedMigrations();
      const needs = unpacked.manifest.latestMigration;
      if (needs && !known.includes(needs)) throw new BackupError("NEWER_BACKUP");

      // Restore into the side database while the app keeps running.
      this.progress("restoring");
      try {
        await this.d.db.restore(unpacked.dumpPath);
      } catch (err) {
        await this.d.db.dropRestoreLeftovers().catch(() => {});
        throw new BackupError("RESTORE_FAILED", err instanceof Error ? err.message : String(err));
      }

      // Swap: attachments first (plain renames), then both databases in one transaction.
      await this.d.server.stop();
      const live = this.d.attachmentsDir;
      const previous = `${live}_before_restore`;
      let liveMoved = false;
      let newInPlace = false;
      try {
        await fsp.rm(previous, { recursive: true, force: true });
        await fsp.mkdir(dirname(live), { recursive: true });
        try {
          await fsp.rename(live, previous);
          liveMoved = true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        await fsp.rename(unpacked.attachmentsDir, live);
        newInPlace = true;
        await this.d.db.swapIn();
      } catch (err) {
        if (newInPlace) await fsp.rm(live, { recursive: true, force: true });
        if (liveMoved) await fsp.rename(previous, live);
        await this.d.db.dropRestoreLeftovers().catch(() => {});
        await this.d.server.start({ signOut: false });
        throw new BackupError("RESTORE_FAILED", err instanceof Error ? err.message : String(err));
      }

      this.progress("restarting");
      try {
        await this.d.server.start({ signOut: true });
      } catch (err) {
        // The restored database wouldn't start (e.g. its migration failed): put everything back.
        await this.d.server.stop().catch(() => {});
        await this.d.db.undoSwap();
        await this.d.db.dropRestoreLeftovers().catch(() => {});
        await fsp.rm(live, { recursive: true, force: true });
        if (liveMoved) await fsp.rename(previous, live);
        await this.d.server.start({ signOut: false });
        throw new BackupError("RESTORE_FAILED", err instanceof Error ? err.message : String(err));
      }

      await this.adoptKey(unpacked.pwKey, unpacked.pwSalt, unpacked.params);
      await this.update({ cleanupPending: true, fingerprint: null, lastError: null });
      this.progress("done");
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
    }
  }

  async disconnect(): Promise<void> {
    if (this.running) throw new BackupError("BUSY");
    await this.d.auth.disconnect();
    await this.d.secrets.clear("key");
    this.pwKey = null;
    await this.update({
      email: null,
      folderId: null,
      pwSalt: null,
      scrypt: null,
      verifier: null,
      fingerprint: null,
      lastError: null,
      failingSince: null,
      failureNotified: false,
    });
  }
```

- [ ] **Step 4: Run all backup tests**

Run: `npx vitest run tests/unit/backup`
Expected: PASS. Every backup test file passes, and the pg file runs when the engine is present.

- [ ] **Step 5: Commit**

```bash
git add desktop/backup/backup-service.ts tests/unit/backup/backup-restore.test.ts
git commit -m "feat(backup): restore with side-database swap and rollback; disconnect"
```

---

### Task 11: Electron wiring — main process, preload, build config, CI secrets

**Files:**
- Create: `desktop/backup/wire.ts`
- Modify: `desktop/main.ts`:
  - `startLocalServer` (≈ lines 274–396);
  - after `stopServer` (≈ 398);
  - `app.whenReady` (≈ 818);
  - `stopAll` (≈ 880).
- Modify: `desktop/preload.ts`, `desktop/build-electron.mjs`, `desktop/tsconfig.json`, `.github/workflows/desktop-release.yml`

**Interfaces:**
- Consumes:
  - `BackupService` and `ServiceDeps` (Tasks 9–10);
  - `GoogleAuth` (Task 7);
  - `DriveClient` (Task 8);
  - `FileSecretStore` (Task 6);
  - the `pg-tools` functions (Task 5);
  - `DatabaseHandle.config` and `.migrate` (Task 5);
  - `moveLegacyAttachments` (Task 1).
- Produces:
  - IPC invoke channels `backup:status`, `backup:connect`, `backup:disconnect`, `backup:setPassword`, `backup:backupNow`, `backup:list` and `backup:restore`;
  - every invoke resolves to `{ ok: true, value } | { ok: false, code, message }`;
  - the send channel `backup:progress`;
  - the preload `backup` object (its shape is `BackupBridge` in Task 12).

- [ ] **Step 1: Create `desktop/backup/wire.ts`**

```ts
// Electron-side glue for the backup feature: builds BackupService from the
// real Google / Drive / Postgres / server pieces and exposes it over IPC.
// Everything with logic lives in the (unit-tested) modules next to this file.

import { app, ipcMain, Notification, safeStorage, shell } from "electron";
import { join } from "node:path";
import type { DatabaseHandle } from "../embedded/embedded-db";
import { BackupService, type BackupProgress, type BackupStatus, type ServerLike } from "./backup-service";
import { DriveClient } from "./drive-client";
import { BackupError } from "./errors";
import { GoogleAuth } from "./google-auth";
import {
  appliedMigrations, connFromConfig, createDatabase, dataFingerprint, dropDatabase, dumpDatabase,
  restoreDatabase, swapDatabases,
} from "./pg-tools";
import { FileSecretStore } from "./secret-store";

// Injected at build time by desktop/build-electron.mjs (GitHub secrets for
// releases, .env.local for local builds). Empty → the feature reports "not
// configured" and stays out of the way.
const GOOGLE_CLIENT = {
  clientId: process.env.TRIVIO_GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.TRIVIO_GOOGLE_CLIENT_SECRET ?? "",
};

const RESTORE_DB = "trivio_restore";
const PREVIOUS_DB = "trivio_before_restore";

export async function createBackupService(o: {
  userData: string;
  attachmentsDir: string;
  db: DatabaseHandle;
  server: ServerLike;
  onProgress: (p: BackupProgress) => void;
}): Promise<BackupService> {
  if (!o.db.config) throw new Error("backup needs the embedded database");
  const conn = connFromConfig(o.db.config);
  const dir = join(o.userData, "backup");
  const secrets = new FileSecretStore(dir, safeStorage);
  const auth = new GoogleAuth(GOOGLE_CLIENT, secrets, { openExternal: (url) => shell.openExternal(url) });
  const drive = new DriveClient({ token: () => auth.accessToken(), onUnauthorized: () => auth.forgetAccessToken() });
  const service = new BackupService({
    dir,
    attachmentsDir: o.attachmentsDir,
    appVersion: app.getVersion(),
    configured: Boolean(GOOGLE_CLIENT.clientId && GOOGLE_CLIENT.clientSecret),
    secrets,
    auth,
    drive,
    db: {
      dump: (out) => dumpDatabase(conn, out),
      fingerprint: () => dataFingerprint(conn),
      appliedMigrations: () => appliedMigrations(conn),
      restore: async (dump) => {
        await dropDatabase(conn, RESTORE_DB);
        await createDatabase(conn, RESTORE_DB);
        await restoreDatabase(conn, RESTORE_DB, dump);
      },
      swapIn: () => swapDatabases(conn, { live: conn.database, incoming: RESTORE_DB, previous: PREVIOUS_DB }),
      undoSwap: () => swapDatabases(conn, { live: conn.database, incoming: PREVIOUS_DB, previous: RESTORE_DB }),
      dropRestoreLeftovers: () => dropDatabase(conn, RESTORE_DB),
      dropPrevious: () => dropDatabase(conn, PREVIOUS_DB),
    },
    server: o.server,
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show();
    },
    onProgress: o.onProgress,
  });
  await service.init();
  return service;
}

const UNAVAILABLE: BackupStatus = {
  configured: false,
  connected: false,
  email: null,
  passwordSet: false,
  running: null,
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastCheckedAt: null,
  lastError: null,
  failingSince: null,
  keptCount: 0,
};

type Result = { ok: true; value: unknown } | { ok: false; code: string; message: string };

export function registerBackupIpc(getService: () => BackupService | null): void {
  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, async (_e, ...args): Promise<Result> => {
      try {
        return { ok: true, value: await fn(...args) };
      } catch (err) {
        console.error(`[backup] ${channel} failed:`, err);
        if (err instanceof BackupError) return { ok: false, code: err.code, message: err.userMessage };
        return { ok: false, code: "BACKUP_FAILED", message: err instanceof Error ? err.message : String(err) };
      }
    });
  const svc = () => {
    const s = getService();
    if (!s) throw new BackupError("NOT_CONFIGURED");
    return s;
  };
  handle("backup:status", () => getService()?.status() ?? UNAVAILABLE);
  handle("backup:connect", () => svc().connect());
  handle("backup:disconnect", () => svc().disconnect());
  handle("backup:setPassword", (pw: string) => svc().setPassword(String(pw)));
  handle("backup:backupNow", () => svc().backupNow());
  handle("backup:list", () => svc().list());
  handle("backup:restore", (id: string, pw: string) => svc().restore(String(id), String(pw)));
}
```

- [ ] **Step 2: Wire it into `desktop/main.ts`**

(a) Add these imports next to the other local imports:
```ts
import { createBackupService, registerBackupIpc } from "./backup/wire";
import type { BackupService } from "./backup/backup-service";
import { moveLegacyAttachments } from "./storage-dir";
```

(b) Add this module state next to `let server` / `let dbHandle`:
```ts
// How the app server was launched, so a restore can stop and relaunch it on
// the same port (the window keeps its URL).
interface AppServerLaunch {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  url: string;
}
let appServerLaunch: AppServerLaunch | null = null;
let backupService: BackupService | null = null;
```

(c) In `startLocalServer`, right after the `WHISPER_HOME` env line, add:
```ts
  // Uploads live in the per-user data folder, not the replaced-on-update app
  // bundle (lib/storage.ts). Carry over anything an older version left behind.
  if (!env.TRIVIO_STORAGE_DIR) env.TRIVIO_STORAGE_DIR = join(app.getPath("userData"), "storage");
  const moved = await moveLegacyAttachments(
    join(dir, "storage", "attachments"),
    join(env.TRIVIO_STORAGE_DIR, "attachments"),
  );
  if (moved) console.log(`[desktop] moved ${moved} attachment(s) out of the app bundle`);
```

(d) In `startLocalServer`, find everything from the `console.log` that announces "starting app server" through the final `return url;`, and replace it with the code below:
- Remove the old inline pieces: `server = spawn(...)` with its stdout/stderr/exit handlers, `const url = ...`, `await waitForServer(url)` and the "ready" log. They now live in `spawnAppServer`.
- Keep the `childEnv` / `execArgv` / `cmd` setup above them unchanged.
```ts
  const url = `http://127.0.0.1:${port}`;
  appServerLaunch = { cmd, args: execArgv, cwd: dir, env: childEnv, url };
  await spawnAppServer(appServerLaunch);

  // Google Drive backup needs the embedded engine's tools and credentials.
  if (dbHandle?.config) {
    try {
      backupService = await createBackupService({
        userData: app.getPath("userData"),
        attachmentsDir: join(env.TRIVIO_STORAGE_DIR!, "attachments"),
        db: dbHandle,
        server: { stop: stopServerAndWait, start: restartAppServer },
        onProgress: (p) => mainWindow?.webContents.send("backup:progress", p),
      });
      backupService.startSchedule();
    } catch (err) {
      console.error("[desktop] backup unavailable:", err);
    }
  }
  return url;
}

async function spawnAppServer(launch: AppServerLaunch): Promise<void> {
  console.log(`[desktop] starting app server: ${launch.cmd} ${launch.args.join(" ")} @${launch.url}`);
  server = spawn(launch.cmd, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  server.stdout?.on("data", (d: Buffer) => {
    const s = String(d).trimEnd();
    if (s) console.log(`[next] ${s}`);
  });
  server.stderr?.on("data", (d: Buffer) => {
    const s = String(d).trimEnd();
    if (s) console.error(`[next:err] ${s}`);
  });
  server.on("exit", (code) => {
    console.log(`[desktop] app server exited code=${code ?? 0}`);
    server = null;
  });
  await waitForServer(launch.url);
  console.log(`[desktop] app server ready at ${launch.url}`);
}

// After a restore: bring the swapped-in database up to this app's schema, start
// the server again on the same port, and show the login page. signOut clears
// the session cookie, which belongs to the replaced database's user.
async function restartAppServer(opts: { signOut: boolean }): Promise<void> {
  if (!appServerLaunch) throw new Error("app server was never started");
  await dbHandle?.migrate?.();
  await spawnAppServer(appServerLaunch);
  if (opts.signOut) await mainWindow?.webContents.session.clearStorageData({ storages: ["cookies"] });
  await mainWindow?.loadURL(`${appServerLaunch.url}${opts.signOut ? "/login" : ""}`);
}
```
Before replacing, compare the existing spawn options and stdout/stderr log prefixes with the version above. If they differ, keep the existing ones inside `spawnAppServer`, so the move changes structure, not behaviour.

(e) Directly after `stopServer()`, add:
```ts
// Stop the app server and resolve once the process has actually exited, so
// its database connections are gone (a restore renames the database next).
function stopServerAndWait(): Promise<void> {
  const child = server;
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    stopServer();
  });
}
```

(f) In `app.whenReady().then(...)`, right after `registerIpc();`, add:
```ts
    registerBackupIpc(() => backupService);
```

(g) Make this the first line of `stopAll()`:
```ts
  backupService?.stopSchedule();
```

- [ ] **Step 3: Add the preload bridge**

In `desktop/preload.ts`:
1. Add these to `CHANNELS`:
```ts
  // Google Drive backup. Every invoke resolves to {ok,value}|{ok:false,code,message}.
  BACKUP_STATUS: "backup:status",
  BACKUP_CONNECT: "backup:connect",
  BACKUP_DISCONNECT: "backup:disconnect",
  BACKUP_SET_PASSWORD: "backup:setPassword",
  BACKUP_NOW: "backup:backupNow",
  BACKUP_LIST: "backup:list",
  BACKUP_RESTORE: "backup:restore",
  BACKUP_PROGRESS: "backup:progress",
```
2. Add this after the `ollama` const:
```ts
// Google Drive backup. The main process answers {ok,value} or {ok:false,code,
// message}; unwrap it here so the renderer gets a plain value or an Error whose
// message is ready to show and whose `code` identifies the failure.
async function invokeBackup<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as
    | { ok: true; value: T }
    | { ok: false; code: string; message: string };
  if (r.ok) return r.value;
  const err = new Error(r.message) as Error & { code?: string };
  err.code = r.code;
  throw err;
}

const backup = {
  status: () => invokeBackup(CHANNELS.BACKUP_STATUS),
  connect: () => invokeBackup(CHANNELS.BACKUP_CONNECT),
  disconnect: () => invokeBackup(CHANNELS.BACKUP_DISCONNECT),
  setPassword: (password: string) => invokeBackup(CHANNELS.BACKUP_SET_PASSWORD, password),
  backupNow: () => invokeBackup(CHANNELS.BACKUP_NOW),
  list: () => invokeBackup(CHANNELS.BACKUP_LIST),
  restore: (id: string, password: string) => invokeBackup(CHANNELS.BACKUP_RESTORE, id, password),
  onProgress(cb: (p: unknown) => void): () => void {
    const handler = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on(CHANNELS.BACKUP_PROGRESS, handler);
    return () => ipcRenderer.removeListener(CHANNELS.BACKUP_PROGRESS, handler);
  },
} as const;
```
3. Add `backup,` to `api`, after `ollama,`.

- [ ] **Step 4: Build config, tsconfig, CI**

`desktop/build-electron.mjs`:
1. Import `readFileSync` and `existsSync` from `node:fs`, merging them into the existing `node:fs` import.
2. Add this before `await Promise.all`:
```js
// Google OAuth client for Drive backup (desktop/backup/wire.ts). Release builds
// get it from GitHub secrets; local builds may put it in .env.local. Missing →
// empty strings → the backup card says "not configured".
function readEnvLocal() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
const envLocal = readEnvLocal();
const googleDefine = Object.fromEntries(
  ["TRIVIO_GOOGLE_CLIENT_ID", "TRIVIO_GOOGLE_CLIENT_SECRET"].map((k) => [
    `process.env.${k}`,
    JSON.stringify(process.env[k] ?? envLocal[k] ?? ""),
  ])
);
```
3. Add `define: googleDefine,` to the **main.ts** `build({...})` call only, not to the preload one.

`desktop/tsconfig.json`: add `"backup/*.ts"` and `"storage-dir.ts"` to `include`.

`.github/workflows/desktop-release.yml`: add these two lines to the job `env:` block that has `CSC_LINK: ${{ secrets.CSC_LINK }}` (macOS build), and to the one that has `WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}` (Windows build):
```yaml
      TRIVIO_GOOGLE_CLIENT_ID: ${{ secrets.TRIVIO_GOOGLE_CLIENT_ID }}
      TRIVIO_GOOGLE_CLIENT_SECRET: ${{ secrets.TRIVIO_GOOGLE_CLIENT_SECRET }}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck:desktop && npm run build:electron && npm run test:desktop && npx vitest run`
Expected:
- no type errors;
- `build:electron` reports success;
- the desktop shell test passes;
- all unit tests pass.

Then run `grep -c "process.env.TRIVIO_GOOGLE_CLIENT_ID" desktop/dist/main.cjs`.
Expected: `0`, because the `define` replaced it with a string literal.

- [ ] **Step 6: Commit**

```bash
git add desktop/backup/wire.ts desktop/main.ts desktop/preload.ts desktop/build-electron.mjs desktop/tsconfig.json .github/workflows/desktop-release.yml
git commit -m "feat(desktop): run Google Drive backup in the main process, expose it over IPC"
```

---

### Task 12: Settings card, restore dialog, register link

**Files:**
- Modify: `types/trivio-desktop.d.ts`, `lib/desktop.ts`
- Create:
  - `components/backup/restore-dialog.tsx`;
  - `components/backup/restore-from-drive-link.tsx`;
  - `app/(app)/settings/_components/backup-card.tsx`.
- Modify: `app/(app)/settings/page.tsx` (add the import, and mount the card after `<VoiceInputCard />` at line 145)
- Modify: `app/(auth)/register/page.tsx` (add the link after the "Sign in instead" `<Link>`, ≈ line 287)
- Test: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the preload `backup` object (Task 11).
- Produces:
  - the types `BackupBridge`, `BackupStatus`, `BackupEntry`, `BackupProgress`;
  - `getBackup(): BackupBridge | undefined`;
  - `<BackupCard />`;
  - `<RestoreDialog open onOpenChange confirmReplace />`;
  - `<RestoreFromDriveLink />`.

- [ ] **Step 1: Write the failing E2E check**

Append to `e2e/smoke.spec.ts`. It uses the file's shared `page`, like the voice test:
```ts
test("Settings shows the Google Drive backup card (desktop-only notice in the browser)", async () => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Backup to Google Drive" })).toBeVisible();
  await expect(page.getByText("Available in the Trivio desktop app.")).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/smoke.spec.ts -g "Google Drive backup"`.
If Playwright's bundled Chromium is missing on this machine, use the full-Chromium scratch config from earlier sessions instead.
Expected: FAIL, because the heading is not found.

- [ ] **Step 3: Types and accessor**

In `types/trivio-desktop.d.ts`, add before `export interface DesktopBridge`:
```ts
// Google Drive backup (desktop/backup). Methods reject with an Error whose
// message is ready to show and whose `code` names the failure.
export interface BackupStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  passwordSet: boolean;
  running: "backup" | "restore" | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastCheckedAt: string | null;
  lastError: { code: string; message: string } | null;
  failingSince: string | null;
  keptCount: number;
}

export interface BackupEntry {
  id: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  appVersion: string | null;
}

export interface BackupProgress {
  phase:
    | "dumping"
    | "encrypting"
    | "uploading"
    | "pruning"
    | "downloading"
    | "decrypting"
    | "restoring"
    | "restarting"
    | "done";
}

export interface BackupBridge {
  status: () => Promise<BackupStatus>;
  connect: () => Promise<{ email: string }>;
  disconnect: () => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  backupNow: () => Promise<BackupStatus>;
  list: () => Promise<BackupEntry[]>;
  restore: (id: string, password: string) => Promise<void>;
  onProgress: (cb: (p: BackupProgress) => void) => () => void;
}
```
Then add `backup?: BackupBridge;` to `DesktopBridge`. It is optional because an older shell running a newer web build has no `backup`.

In `lib/desktop.ts`:
1. Add `BackupBridge, BackupEntry, BackupProgress, BackupStatus` to the type import and to the `export type { ... }` line.
2. Append:
```ts
// The Google Drive backup sub-API, or undefined on the web / an older shell.
export function getBackup(): BackupBridge | undefined {
  return getDesktop()?.backup;
}
```

- [ ] **Step 4: Restore dialog**

`components/backup/restore-dialog.tsx`:
```tsx
"use client";

// Restore a Google Drive backup: (connect if needed) → pick a backup → enter
// its password → (confirm replacing current data) → progress. On success the
// desktop shell restarts the app server and loads the login page itself, so
// this dialog never "finishes" in place.

import { useEffect, useState } from "react";
import { getBackup, type BackupEntry, type BackupProgress } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const PHASE_LABEL: Record<BackupProgress["phase"], string> = {
  dumping: "Reading your data…",
  encrypting: "Encrypting…",
  uploading: "Uploading…",
  pruning: "Tidying old backups…",
  downloading: "Downloading backup…",
  decrypting: "Unlocking backup…",
  restoring: "Restoring your data…",
  restarting: "Restarting Trivio…",
  done: "Done",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function fmtSize(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

type Step = "connect" | "pick" | "confirm" | "working";

export function RestoreDialog({
  open,
  onOpenChange,
  confirmReplace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirmReplace: boolean; // Settings: there is data to replace
}) {
  const backup = getBackup();
  const [step, setStep] = useState<Step>("pick");
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<BackupProgress["phase"] | null>(null);

  async function load() {
    if (!backup) return;
    setError(null);
    const s = await backup.status();
    if (!s.connected) {
      setStep("connect");
      return;
    }
    setStep("pick");
    try {
      const list = await backup.list();
      setEntries(list);
      setChosen(list[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => backup?.onProgress((p) => setPhase(p.phase)), [backup]);

  async function connect() {
    if (!backup) return;
    setError(null);
    try {
      await backup.connect();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function restore() {
    if (!backup || !chosen) return;
    setError(null);
    setStep("working");
    setPhase("downloading");
    try {
      await backup.restore(chosen, password);
    } catch (e) {
      setError((e as Error).message);
      setStep("pick");
      setPhase(null);
    }
  }

  const busy = step === "working";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore from Google Drive</DialogTitle>
          <DialogDescription>
            {confirmReplace
              ? "Replaces all data on this computer with a backup."
              : "Set up this computer from one of your backups."}
          </DialogDescription>
        </DialogHeader>

        {step === "connect" && (
          <div className="space-y-3 text-sm">
            <p>Sign in with the Google account your backups are in.</p>
            <Button onClick={connect}>Connect Google Drive</Button>
          </div>
        )}

        {step === "pick" && (
          <div className="space-y-4 text-sm">
            {entries === null ? (
              <p className="text-muted-foreground">Loading backups…</p>
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground">No backups found in this Google account.</p>
            ) : (
              <div role="radiogroup" aria-label="Backups" className="max-h-56 space-y-1 overflow-y-auto">
                {entries.map((b) => (
                  <label key={b.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/40 px-3 py-2">
                    <input type="radio" name="backup" checked={chosen === b.id} onChange={() => setChosen(b.id)} />
                    <span className="flex-1">{fmtDate(b.createdAt)}</span>
                    <span className="text-muted-foreground text-xs">
                      {fmtSize(b.sizeBytes)}
                      {b.appVersion ? ` · v${b.appVersion}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {entries && entries.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="restore-password">Backup password</Label>
                <Input
                  id="restore-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {step === "confirm" && (
          <p className="text-sm">
            This replaces <strong>all data on this computer</strong> with the backup from{" "}
            {fmtDate(entries?.find((b) => b.id === chosen)?.createdAt ?? new Date().toISOString())}. Your current data is
            kept aside until the next successful backup.
          </p>
        )}

        {step === "working" && (
          <p className="text-sm" role="status" aria-live="polite">
            {phase ? PHASE_LABEL[phase] : "Working…"}
          </p>
        )}

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          {step === "pick" && entries && entries.length > 0 && (
            <Button
              disabled={!chosen || password.length === 0}
              onClick={() => (confirmReplace ? setStep("confirm") : void restore())}
            >
              Restore
            </Button>
          )}
          {step === "confirm" && (
            <>
              <Button variant="outline" onClick={() => setStep("pick")}>
                Back
              </Button>
              <Button variant="destructive" onClick={() => void restore()}>
                Replace my data
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`components/backup/restore-from-drive-link.tsx`:
```tsx
"use client";

// First-run shortcut: set this computer up from a Google Drive backup instead
// of creating a new account. Desktop app only.

import { useEffect, useState } from "react";
import { getBackup } from "@/lib/desktop";
import { RestoreDialog } from "./restore-dialog";

export function RestoreFromDriveLink() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const b = getBackup();
    if (b) void b.status().then((s) => setAvailable(s.configured)).catch(() => {});
  }, []);
  if (!available) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full text-center text-sm font-medium text-green-700 hover:underline"
      >
        Restore from Google Drive
      </button>
      <RestoreDialog open={open} onOpenChange={setOpen} confirmReplace={false} />
    </>
  );
}
```

- [ ] **Step 5: Settings card**

`app/(app)/settings/_components/backup-card.tsx`:
```tsx
"use client";

// Settings → Backup to Google Drive: connect, set the backup password, see
// when the last backup ran, back up now, restore, disconnect. All of it runs
// in the desktop shell (desktop/backup); a browser build only shows a notice.

import { useCallback, useEffect, useState } from "react";
import { CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { getBackup, type BackupStatus } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RestoreDialog } from "@/components/backup/restore-dialog";

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card shadow-card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <CloudUpload className="h-4 w-4 text-muted-foreground" />
        </div>
        <h2 className="font-semibold">Backup to Google Drive</h2>
      </div>
      <div className="space-y-4 text-sm">{children}</div>
    </div>
  );
}

export function BackupCard() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const refresh = useCallback(async () => {
    const b = getBackup();
    if (b) setStatus(await b.status());
  }, []);

  useEffect(() => {
    setIsDesktop(getBackup() !== undefined);
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  if (isDesktop === null) return null; // first render (SSR) — avoid a flash
  if (!isDesktop) {
    return (
      <Shell>
        <p className="text-muted-foreground">Available in the Trivio desktop app.</p>
      </Shell>
    );
  }
  const b = getBackup()!;
  if (!status) return null;

  if (!status.configured) {
    return (
      <Shell>
        <p className="text-muted-foreground">Google Drive backup isn&apos;t configured in this build.</p>
      </Shell>
    );
  }

  if (!status.connected) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          Encrypted daily backups of your books and attachments to your own Google Drive. Trivio can only see
          the files it creates there.
        </p>
        <Button disabled={busy} onClick={() => run(() => b.connect(), "Google Drive connected")}>
          Connect Google Drive
        </Button>
      </Shell>
    );
  }

  if (!status.passwordSet) {
    const tooShort = pw.normalize("NFC").length < 8;
    return (
      <Shell>
        <p>
          Connected as <strong>{status.email}</strong>. Choose a backup password.
        </p>
        <p className="text-muted-foreground">
          Backups are encrypted with it. <strong>If you forget it, your backups can&apos;t be restored</strong> — Trivio
          and Google can&apos;t recover it.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="backup-pw">Backup password</Label>
            <Input id="backup-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backup-pw2">Type it again</Label>
            <Input id="backup-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
        </div>
        {pw2 && pw !== pw2 && <p className="text-destructive">The passwords don&apos;t match.</p>}
        {tooShort && pw && <p className="text-muted-foreground text-xs">At least 8 characters.</p>}
        <Button
          disabled={busy || tooShort || pw !== pw2}
          onClick={() =>
            run(async () => {
              await b.setPassword(pw);
              setPw("");
              setPw2("");
              await b.backupNow();
            }, "Backup password set — first backup done")
          }
        >
          Set password and back up
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <p>
        Connected as <strong>{status.email}</strong>. Backs up once a day while Trivio is open, if anything
        changed, and keeps the last 10.
      </p>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-0.5">Last backup</dt>
          <dd>{when(status.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-0.5">Kept in Drive</dt>
          <dd>{status.keptCount}</dd>
        </div>
      </dl>
      {status.lastError && (
        <p role="alert" className="text-destructive">
          Last backup failed: {status.lastError.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {status.lastError?.code === "AUTH_REVOKED" ? (
          <Button disabled={busy} onClick={() => run(() => b.connect(), "Google Drive reconnected")}>
            Reconnect Google Drive
          </Button>
        ) : (
          <Button disabled={busy || status.running !== null} onClick={() => run(() => b.backupNow(), "Backed up")}>
            {status.running === "backup" || busy ? "Backing up…" : "Back up now"}
          </Button>
        )}
        <Button variant="outline" disabled={busy || status.running !== null} onClick={() => setRestoreOpen(true)}>
          Restore…
        </Button>
        <Button
          variant="ghost"
          disabled={busy || status.running !== null}
          onClick={() => run(() => b.disconnect(), "Disconnected. Your backups stay in Google Drive.")}
        >
          Disconnect
        </Button>
      </div>
      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} confirmReplace />
    </Shell>
  );
}
```

- [ ] **Step 6: Mount it**

`app/(app)/settings/page.tsx`:
1. Add `import { BackupCard } from "./_components/backup-card";` next to the `VoiceInputCard` import.
2. Insert this right after `<VoiceInputCard />`:
```tsx
          {/* Encrypted backups to the user's Google Drive (desktop app) */}
          <BackupCard />
```

`app/(auth)/register/page.tsx`:
1. Add `import { RestoreFromDriveLink } from "@/components/backup/restore-from-drive-link";`.
2. Insert `<RestoreFromDriveLink />` right after the "Sign in instead" `</Link>`.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npx vitest run && npx playwright test e2e/smoke.spec.ts`. For Playwright, use the same config as in Step 2.
Expected: no type or lint errors, unit tests pass, and all smoke tests pass, including the new one.

- [ ] **Step 8: Commit**

```bash
git add types/trivio-desktop.d.ts lib/desktop.ts components/backup "app/(app)/settings/_components/backup-card.tsx" "app/(app)/settings/page.tsx" "app/(auth)/register/page.tsx" e2e/smoke.spec.ts
git commit -m "feat(backup): Settings card, restore dialog, and first-run restore link"
```

---

### Task 13: Real-Drive check, then release

Needs the Google OAuth client from spec §9, which the user creates. **Never** point any of this at the real data folder `~/Library/Application Support/trivio-desktop`.

- [ ] **Step 1: Confirm the client exists**

Run: `gh secret list | grep TRIVIO_GOOGLE_CLIENT`. Both names must be listed.
Check that `.env.local` has `TRIVIO_GOOGLE_CLIENT_ID=` and `TRIVIO_GOOGLE_CLIENT_SECRET=` lines, without printing their values: `grep -c '^TRIVIO_GOOGLE_CLIENT_' .env.local` should print `2`.
If either check fails, stop and ask the user to complete spec §9.

- [ ] **Step 2: Build locally and run against a scratch profile**

Run `npm run build:desktop`. Then launch the built app (electron-builder prints the path) with an isolated data folder:
```bash
SCRATCH=$(mktemp -d)
"release/mac-arm64/Trivio.app/Contents/MacOS/Trivio" --user-data-dir="$SCRATCH/a"
```
In the window:
1. Register a test user.
2. Add a transaction with a receipt attachment.
3. Go to Settings → Backup, connect, and set a password.
4. Confirm a `trivio-….trivio-backup` file appears in Drive under "Trivio Backups".

- [ ] **Step 3: Restore into a second scratch profile**

Quit the app and launch it again with `--user-data-dir="$SCRATCH/b"`.
1. On the register page, choose "Restore from Google Drive" → connect → pick the backup → enter the password.
2. Expected:
   - the login page appears;
   - signing in as the test user shows the transaction, and its attachment opens;
   - Settings → Backup shows the account as connected with the password already set.

- [ ] **Step 4: Release (only when the user asks)**

Following the project rule (commit or push only when asked), wait for the user to request the release. Then:
```bash
git push origin main && git tag v0.1.25 && git push origin v0.1.25
```
Watch the "Desktop release" workflow, then install with the established flow: download the dmg → quit → copy → de-quarantine → verify → open.
