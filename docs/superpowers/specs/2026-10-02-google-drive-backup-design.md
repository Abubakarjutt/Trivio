# Google Drive Backup & Restore — Design

**Date:** 2026-10-02
**Status:** Approved in conversation; awaiting written-spec review
**Scope:** Trivio desktop app (Electron + embedded Postgres), macOS and Windows

## 1. Goal

Let a user back up all their Trivio data to their own Google Drive and restore it — on the
same computer (roll back) or on a new one (set up in one step). One computer uses the data
at a time; this is backup, not live multi-device sync.

### Decisions (from the user)

| Topic | Decision |
|---|---|
| Purpose | Backup & restore, one computer at a time |
| Schedule | Automatic daily while the app is open, only if something changed, plus a "Back up now" button |
| Retention | Keep the newest **10** backups; delete older ones |
| Encryption | Yes, with a backup password. A forgotten password means backups cannot be restored |
| Restore entry points | First-run screen (fresh install) **and** Settings → Backup |
| Google OAuth client | The developer creates it (steps in §9) and ships it in the build |
| Architecture | Approach A: the Electron main process does backup/restore and talks to the Drive REST API directly |

### Assumptions

- Backed up: the whole `trivio` database and the uploaded attachments.
- Not backed up: per-computer settings outside the DB (voice/AI model files, Ollama models,
  window state, the Google token itself).

### Non-goals

- Simultaneous use on two computers, or merging changes.
- Choosing what to back up.
- Other cloud providers.
- Changing the backup password. In v1, the user disconnects and starts fresh.

## 2. Architecture

The main process owns the embedded Postgres and the Next.js server lifecycle. It is the only
process that can safely do "stop server → replace DB → start server", so all backup code
lives there, in `desktop/backup/`:

| Module | Responsibility | Depends on |
|---|---|---|
| `google-auth.ts` | Loopback + PKCE sign-in in the system browser; token refresh; revoke on disconnect; refresh token persisted with `safeStorage` at `userData/backup/google-token.bin` | Electron `safeStorage`, `shell` |
| `drive-client.ts` | Find/create the "Trivio Backups" folder; resumable upload; paged list; download; delete. Plain `fetch` against Drive REST v3 | `fetch`, an access-token provider |
| `archive.ts` | `pg_dump` + attachments → tar → AES-256-GCM stream, and the reverse; header/manifest read and write; key derivation | embedded `pg_dump`/`pg_restore`, Node `crypto` |
| `backup-service.ts` | Hourly due-check, change fingerprint, back up now, single-flight, pruning, restore orchestration, status/state file | the three above + server start/stop hooks from `main.ts` |

**UI** stays in the Next.js app:

- **Settings → Backup** card (`app/(app)/settings/_components/backup-card.tsx`).
- A "Restore from Google Drive" link on `app/(auth)/register/page.tsx`, shown only in the
  desktop app, opening a restore dialog.

Both call `window.trivio.backup.*`, exposed by `desktop/preload.ts` and served by
`ipcMain.handle("backup:*")` in `desktop/main.ts`. Outside the desktop app, the card shows
"Available in the desktop app" and the register link is hidden.

**IPC surface** (`window.trivio.backup`):

```ts
status(): Promise<BackupStatus>          // connected email, last success/attempt/error, count kept, running?
connect(): Promise<{ email: string }>    // runs the browser sign-in
disconnect(): Promise<void>              // revokes token, clears key + verifier; Drive files are left alone
setPassword(pw: string): Promise<void>   // first time only (v1)
backupNow(): Promise<BackupStatus>       // joins an in-flight run if one exists
list(): Promise<BackupEntry[]>           // id, createdAt, sizeBytes, appVersion
restore(id: string, pw: string): Promise<void> // resolves after the server has restarted
onProgress(cb: (p: BackupProgress) => void): () => void
```

### Attachment storage fix (prerequisite)

`lib/storage.ts` currently stores uploads at `process.cwd()/storage`. In the desktop app that
is inside the app bundle, so every update wipes them. The fix:

- `STORAGE_ROOT = process.env.TRIVIO_STORAGE_DIR ?? path.join(process.cwd(), "storage")`.
- `desktop/main.ts` sets `TRIVIO_STORAGE_DIR = userData/storage` in the server env.
- On startup, the main process moves any existing `<bundle>/storage/attachments` into
  `userData/storage/attachments` once. This is a no-op today, since there are 0 attachments.

## 3. Backup file format

File name: `trivio-<UTC ISO, colons→dashes>.trivio-backup`, e.g.
`trivio-2026-10-02T14-30-00Z.trivio-backup`.

```
HEADER (plaintext, 60 bytes)
  magic      8 B   "TRIVIOBK"
  version    1 B   0x01
  scrypt N   4 B   uint32 BE (131072 = 2^17)
  scrypt r   1 B   8
  scrypt p   1 B   1
  pwSalt    16 B   the salt used to derive pwKey from the password (fixed per connection)
  fileSalt  16 B   random per file
  nonce     12 B   random per file
  reserved   1 B   0x00
BODY   AES-256-GCM ciphertext of a tar stream; the 60 header bytes are the GCM AAD
  manifest.json   { formatVersion, appVersion, latestMigration, createdAt,
                    attachmentCount, dbDumpSha256 }
  db.dump         pg_dump --format=custom --no-owner --no-privileges
  attachments/…   contents of userData/storage/attachments
TRAILER
  tag       16 B   GCM auth tag
```

### Keys

- `pwKey = scrypt(password, pwSalt, 32, {N, r, p})`. This is slow by design (~0.3 s), and it
  runs only when the password is set or a restore is done.
- `fileKey = HKDF-SHA256(pwKey, salt = fileSalt, info = "trivio-backup-v1", 32)`. This is
  fast and new for every file.
- On `setPassword`:
  - pick a random `pwSalt` and derive `pwKey`;
  - store `pwKey` wrapped by `safeStorage` at `userData/backup/key.bin`, so daily backups
    run unattended;
  - store `pwSalt` and a **verifier** in `state.json`. The verifier is AES-GCM of the
    constant `"trivio-backup-verifier"` under `pwKey`.
- The password itself is never stored.
- Restore on any machine reads `pwSalt` from the file header, then derives `pwKey` and
  `fileKey` from the typed password. This is why first-run restore needs nothing but the
  password.
- Because the header is the AAD, any change to the header or body fails the tag check. The
  user sees "Wrong password or damaged backup". Decryption writes to a temp file, and nothing
  is used until the tag verifies.
- `latestMigration` is the newest applied row in `_prisma_migrations`. A backup whose
  migration is unknown to the installed app is refused with "This backup was made by a newer
  Trivio. Update Trivio first."

## 4. Flows

### 4.1 Connect

1. Start an HTTP listener on `127.0.0.1:<ephemeral port>`. Generate a PKCE verifier and
   challenge (S256) and a `state` value.
2. `shell.openExternal` opens Google's auth URL with scope
   `https://www.googleapis.com/auth/drive.file openid email`, `access_type=offline` and
   `prompt=consent`.
3. Handle the redirect:
   - check `state`;
   - show the "Connected — you can close this tab" page;
   - close the listener.

   The whole step times out after 5 minutes.
4. Exchange the code for tokens, read the email from the id_token, and persist the refresh
   token via `safeStorage`.
5. The card asks for a backup password (twice, at least 8 characters, with a "cannot be
   recovered" warning), then runs the first backup.

### 4.2 Daily backup

- **When:** on app start and every hour. If connected, a password is set, and the last
  *successful* backup is more than 24 h old, run a backup unless the fingerprint is
  unchanged.
- **Fingerprint:** `xact_commit` from `pg_stat_database` for `trivio`, plus a sha256 of the
  sorted `(relative path, size, mtime)` list of attachments.
  - Read-only transactions also bump `xact_commit`, so changes are over-reported, never
    under-reported. That is acceptable, because an unneeded backup is cheap.
  - Stats reset when Postgres restarts, so any value that differs from the stored one counts
    as "changed".
- **Unchanged:** record `lastCheckedAt` and stop.
- **Run:**
  1. `pg_dump` against the live DB into `userData/backup/tmp`. The dump is an MVCC-consistent
     snapshot.
  2. Stream through tar → encrypt into `tmp/<name>.trivio-backup`.
  3. Resumable upload to the folder. Confirm the `size` reported by Drive equals the local
     size.
  4. Prune: list the folder, sort by `createdTime`, and delete everything beyond the newest
     10.
  5. Delete the temp files, store the new fingerprint, set `lastSuccessAt`, and drop any
     `*_before_restore` leftovers (§4.3 step 8).
- **Single-flight:** only one run at a time. `backupNow()` during a run returns the same
  promise.
- **Pruning** runs only after a confirmed upload, and never as a way to free space.

### 4.3 Restore

Entry points:
- Settings → Backup → "Restore…". This needs a confirmation.
- The register page → "Restore from Google Drive". This needs no confirmation, since there is
  no data yet. It first runs the Connect sign-in, without the password step.

Steps:
1. `list()` shows the backups (date, size, app version). The user picks one and enters the
   password.
2. Download to `tmp`, then decrypt and untar to `tmp/restore/`. A wrong password or damaged
   file stops here, with nothing changed.
3. Check `manifest.latestMigration` and `dbDumpSha256`.
4. Settings path only: confirm "This replaces all data on this computer."
5. `stopServer()`. Run `CREATE DATABASE trivio_restore`, then
   `pg_restore --no-owner --no-privileges -d trivio_restore db.dump`.
6. Close any remaining connections to `trivio`, because `RENAME` needs zero connections. Use
   `pg_terminate_backend`, scoped to that database. Then:
   - `ALTER DATABASE trivio RENAME TO trivio_before_restore`;
   - `ALTER DATABASE trivio_restore RENAME TO trivio`;
   - rename `storage/attachments` → `storage/attachments_before_restore`;
   - move `tmp/restore/attachments` → `storage/attachments`.
7. `startServer()`. The existing startup runs `prisma migrate deploy`, which upgrades a backup
   from an older version. Navigate to `/login`, where the user signs in with the account that
   came back with the data.
8. The `*_before_restore` database and folder are dropped after the next successful backup.
9. If anything fails in steps 5–6:
   - drop `trivio_restore`;
   - undo whichever renames happened;
   - restart the server;
   - report "Restore failed — your data was not changed."

### 4.4 Disconnect

- Revoke the token at Google.
- Delete `google-token.bin`, `key.bin` and the verifier.
- Stop scheduling.

Files already in Drive are left in place, and the card says so.

## 5. Errors

| Situation | User sees | Behaviour |
|---|---|---|
| Offline / Drive 5xx | "Last backup failed — no connection. Will retry." | Within a run, resumable upload retries up to 3 times with backoff; otherwise retry at the next hourly check |
| `invalid_grant` (token revoked/expired) | "Reconnect Google Drive" banner | Daily backups pause until reconnect |
| Drive quota exceeded (`storageQuotaExceeded`) | "Google Drive is full" | No pruning to make room |
| Wrong password / tampered file | "Wrong password or damaged backup" | Nothing changed |
| Backup from a newer app | "Update Trivio first" | Nothing changed |
| `pg_dump` / `pg_restore` fails | "Backup failed" / "Restore failed — your data was not changed" | stderr goes to the app log; rollback per §4.3 |
| App quits mid-backup | — | `tmp/` is cleared on next start; Drive discards the abandoned resumable session |
| 3 consecutive daily failures | Red status + one system notification | No further action |
| No client ID in build | "Google Drive backup isn't configured in this build" | Card disabled; nothing else affected |

**State file** `userData/backup/state.json`:

```
{ email, folderId, pwSalt, verifier, lastSuccessAt, lastAttemptAt, lastError,
  lastCheckedAt, fingerprint, consecutiveFailures, keptCount }
```

Timestamps are ISO 8601 UTC. The file is written atomically: write a temp file, then rename.

## 6. Configuration

- `desktop/build-electron.mjs` injects the build-time constants `TRIVIO_GOOGLE_CLIENT_ID` and
  `TRIVIO_GOOGLE_CLIENT_SECRET`.
  - Release builds read them from GitHub Actions secrets.
  - Local builds read them from `.env.local`.
  - A Desktop-type client secret is not confidential by Google's definition. PKCE protects
    the code exchange.
- No new npm dependencies are planned. tar is a minimal ustar writer/reader, unless an
  existing dependency already provides one. The plan checks `node_modules` before deciding.

## 7. Testing

Vitest, offline:

- **`archive`:**
  - The round trip is byte-identical.
  - These are rejected:
    - a wrong password;
    - a flipped byte in the header, body or tag;
    - a bad magic or version;
    - a manifest with an unknown migration.
- **`backup-service`** (fake Drive, fake clock, fake dumper):
  - Skips when the fingerprint is unchanged.
  - Runs when the last success is more than 24 h old.
  - Prunes to 10 only after a confirmed upload, and never after a failure.
  - `backupNow` joins an in-flight run.
  - Sends one notification after the 3rd consecutive failure.
  - Clears `tmp/` on start.
- **`drive-client`** (fake HTTP server):
  - Resumable upload, including resume after a 503.
  - Folder find-or-create.
  - Paged list.
  - Delete.
  - `invalid_grant` and quota errors map to typed errors.
- **`google-auth`:**
  - PKCE S256 values.
  - Loopback redirect handling: rejects a `state` mismatch, and times out.
  - Token persistence via an injected `safeStorage`.
- **Real Postgres** (embedded binaries, scratch cluster):
  - Seed balanced journals, then back up, wipe, restore and swap. Check that debits equal
    credits for every entry and that the attachments match.
  - Test the rollback path by injecting a corrupt dump.
- **E2E smoke:** Settings → Backup renders "Available in the desktop app" in the browser
  build.

**Manual pre-release check** on the installed app, against a real Drive:
- connect;
- back up now;
- check that the file appears in Drive;
- restore into a **scratch** userData directory, never the real one;
- log in.

## 8. Files touched (expected)

- **New:**
  - `desktop/backup/{google-auth,drive-client,archive,backup-service}.ts` and their tests;
  - `app/(app)/settings/_components/backup-card.tsx`;
  - a restore dialog component.
- **Changed:**
  - `desktop/main.ts`: IPC handlers, storage env, start/stop hooks, the one-time
    attachments move;
  - `desktop/preload.ts`;
  - `lib/storage.ts`;
  - `app/(app)/settings/page.tsx`;
  - `app/(auth)/register/page.tsx`;
  - `desktop/build-electron.mjs`;
  - the release workflow in `.github/workflows`, which passes the secrets to the build.

## 9. Google Cloud setup (developer, ~10 minutes)

1. Go to https://console.cloud.google.com → project picker → **New project** → name it
   "Trivio" → Create.
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience):
   - User type **External**.
   - App name "Trivio", support email and developer contact: your email.
   - Under **Data access → Add scopes**, add `.../auth/drive.file`, `openid` and `email`.
4. **Audience → Publish app**, so the status is **In production**. Verification is not
   required for these non-sensitive scopes.
   - **Do not leave it in "Testing"**: in Testing, refresh tokens expire after 7 days and
     daily backups would silently stop.
5. **Clients → Create client** → Application type **Desktop app** → name "Trivio Desktop" →
   Create. Copy the **Client ID** and **Client secret**.
6. Provide them for builds:
   ```bash
   gh secret set TRIVIO_GOOGLE_CLIENT_ID      # paste the client ID
   gh secret set TRIVIO_GOOGLE_CLIENT_SECRET  # paste the client secret
   ```
   For local development, add the same two lines to `.env.local`.
