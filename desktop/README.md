# Trivio for macOS — desktop shell

Trivio for macOS wraps the existing Next.js web app in a native macOS window
via **Electron**. The UI is unchanged; we add a native window, menu bar,
document-style lifecycle, and an installable `.app` / `.dmg`.

Because the backend is a real Node server (tRPC, Prisma/Postgres, BullMQ/Redis,
AI extraction), the shell **boots the app's own server** instead of pretending
to be a static client. There are three run modes, and a single switch
(`DESKTOP_MODE`) chooses between them.

```
┌──────────────────────────────────────────────────────────────┐
│  Trivio.app (Electron main process — Node)                    │
│                                                                │
│  1. boot the app's server on 127.0.0.1:<free port>            │
│  2. open a BrowserWindow → http://127.0.0.1:<port>            │
│                                                                │
│  modes:                                                         │
│   dev    load the `next dev` server (http://127.0.0.1:3000)   │
│   local  boot .next/standalone (compiled to dist-server/)      │
│   remote load an already-hosted URL (thin client, no server)   │
└──────────────────────────────────────────────────────────────┘
```

## Prerequisites

Node 20+ and, for the desktop toolchain:

```bash
npm install            # pulls in electron, electron-builder, esbuild
```

The desktop app still needs Postgres and Redis (for `local`/`dev` modes) — or a
reachable hosted instance (for `remote` mode). See
[Backend strategy](#backend-strategy).

---

## 1. Run in development (fastest, HMR)

Boots a real `next dev` server and loads it in a native window. Requires the
same env a developer would use for `npm run dev` (a local DB, Redis, an
`NEXTAUTH_SECRET`, API keys in `.env`).

```bash
npm run dev:desktop
```

This:
1. compiles the shell → `desktop/dist/*.cjs`
2. starts `next dev` and waits for `127.0.0.1:3000`
3. launches Electron pointed at that dev server

To point it at a different dev port: `DEV_SERVER_URL=http://127.0.0.1:PORT`.

## 2. Run a built app locally (server, no `next dev`)

Assembles the production-standalone server and runs it through the shell:

```bash
npm run build          # produces .next/standale (output: "standalone" is set)
npm run build:server   # assembles desktop/dist-server/ (server.js + static + public)
npm run dev:desktop:local
```

`dev:desktop:local` sets `DESKTOP_MODE=local`, so the shell boots
`desktop/dist-server/server.js` on a random loopback port and loads it. Great
for smoke-testing the packaged server tree before you build the `.dmg`.

## 3. Build an installable app

```bash
npm run build:desktop
# → release/Trivio-0.1.0-arm64.dmg  (+ .app, .zip)
```

`build:desktop` runs, in order:
1. `next build` (standale output)
2. `build:electron` (compile main + preload)
3. `gen:icon` (rebuild `desktop/build/icon.icns`)
4. `build:server` (assemble `desktop/dist-server/`)
5. `electron-builder --config desktop/electron-builder.yml --mac`

The result at `release/` is a real, installable macOS app: a `.dmg` you can
double-click, an `.app` in your Dock, an arm64 binary.

---

## Configuring the desktop app

The embedded server loads env in this order (later wins, real process env wins
for `PORT`/`HOSTNAME`):

1. the real process environment
2. `TRIVIO_ENV_FILE` — an explicit path to a `.env`
3. `~/.trivio/.env` — the user's per-machine credentials (**recommended**)
4. `<app>/<server-dir>/.env` — a template copied from `.env.example`

For a production build, drop a `.env` at `~/.trivio/.env`:

```ini
DATABASE_URL=postgresql://...@host:5432/...
REDIS_URL=redis://...
NEXTAUTH_SECRET=...
CRON_SECRET=...
ANTHROPIC_API_KEY=...
# ...any values from .env.example
```

`remote` mode doesn't need these (the server is elsewhere).

The shell sets `AUTH_TRUST_HOST=true` and `NEXTAUTH_URL=http://127.0.0.1:<port>`
for the embedded server so OAuth callbacks and session reads validate over the
loopback origin the window loads from.

---

## Backend strategy

Trivio is a full-stack SaaS: Postgres, Redis/BullMQ, S3/MinIO, and AI extraction
are server-side. The desktop app must reach them somehow. You have two real
choices, both supported:

- **Thin client (recommended for shipping).** `DESKTOP_MODE=remote` loads your
  hosted web app (`https://app.trivio-ai.com` or your own
  `ELECTRON_REMOTE_URL`). The desktop binary is just a native window + deep
  links + updates on top of the web app — like the Linear/Notion desktop apps.
  No local DB/Redis. Small, fast, uniform.
- **Full local stack.** `DESKTOP_MODE=local` boots the embedded Next.js
  standalone server. Point `DATABASE_URL`/`REDIS_URL` at hosted Postgres/Redis
  (still recommended even in local mode — a bundled Postgres binary is a lot
  of work and not in scope here).

`npm run build:desktop` produces a **local-mode** binary by default. To ship a
thin client instead, set `DESKTOP_MODE=remote` on the launch (see the scripts
below) or add a launch flag — see "Packaging a remote client".

### Packaging a remote (thin-client) build

```bash
# point remote mode at a hosted URL at launch time
DESKTOP_MODE=remote ELECTRON_REMOTE_URL=https://app.trivio-ai.com \
  electron desktop/dist/main.cjs
```

To ship a pre-configured thin client, add it to `desktop/electron-builder.yml`
under `extraMetadata`/a launch wrapper, or ship a small launcher that sets
`DESKTOP_MODE=remote` before invoking the app.

---

## Signing & notarization

The `electron-builder.yml` already enables **hardened runtime** with the
correct entitlements (`desktop/entitlements.mac.*.plist`). An unsigned /
ad-hoc-signed app will trigger macOS Gatekeeper ("unidentified developer").
For distribution, set one of these before building:

```bash
# Developer ID certificate (recommended) + notarytool
CSC_NAME="Your Name (TEAMID)"                       # or CSC_LINK/CSC_KEY_PASSWORD
APPLE_ID=you@example.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=ABCDE12345
xcrun notarytool submit release/Trivio.app \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
  --password "@keychain:app-specific-password" --wait
```

electron-builder reads `CSC_*` and the `APPLE_*` vars automatically and will
notarize for you when they are present.

---

## Menu & window

- **Traffic-light chrome** (`titleBarStyle: hiddenInset`) on a 1360×900 window
  with a safe top inset so the native buttons never overlap content.
- Application menu: About / Open in Browser / Hide-Quit; Edit; View
  (Reload, DevTools, zoom, fullscreen); Window.
- **Single instance**: a second launch focuses the existing window.
- **External links** (anything that is not the 127.0.0.1 loopback) open in the
  user's default browser, not in-app.
- A small, explicit contextBridge API is exposed as `window.trivioDesktop`
  (`isDesktop`, `openExternal`, `openItem`, `navigate`, `showMessageBox`,
  `platform`, `versions`) for any future native integrations.

---

## File map

```
desktop/
  main.ts                 Electron main process (mode dispatch, server boot, window, menu)
  preload.ts              contextBridge (window.trivioDesktop)
  dev.mjs                 dev:desktop orchestrator (next dev + electron)
  build-electron.mjs      esbuild: main/preload → desktop/dist/*.cjs
  assemble-server.mjs     .next/standale → desktop/dist-server/
  tsconfig.json           type-checks the shell in isolation
  electron-builder.yml    macOS .dmg/.app packaging config
  entitlements.mac.plist            hardened-runtime entitlements (main)
  entitlements.mac.inherit.plist    inherited entitlements (helpers)
  build/
    icon-generator.mjs    dependency-free 1024×1024 → icns (macOS sips/iconutil)
    icon.icns             the built icon (regenerate with `npm run gen:icon`)
```

---

## Troubleshooting

- **`Embedded server not found`** → run `npm run build && npm run build:server`
  first, or use `DESKTOP_MODE=remote` / `DESKTOP_MODE=dev`.
- **Gatekeeper "unidentified developer"** → sign + notarize, or right-click →
  Open from a terminal: `xattr -dr com.apple.quarantine Trivio.app`.
- **Login/session fails in `local` mode** → confirm `AUTH_TRUST_HOST=true`
  (the shell sets this automatically) and that `DATABASE_URL`/`REDIS_URL` reach
  a real server.
- **White window / 404 assets** → run `npm run build:server` (it copies
  `.next/static` and `public` next to `server.js`).
- **`/api/health` never answers** → check the `[next:err]` logs; usually DB or
  Redis is unreachable. The shell polls `/api/health` for up to 60s before
  giving up.
- **Want a Tauri build instead** → see "Alternative: Tauri" below. The shell
  logic (mode dispatch, server boot, `ELECTRON_RUN_AS_NODE` trick) maps almost
  1:1 onto Tauri's sidecar model; only the packaging + window layer differs.

---

## Alternative: Tauri (lighter, Rust-based)

Electron was chosen because the main process **is** Node.js, so it can host the
app's own server (`ELECTRON_RUN_AS_NODE`) with zero extra shelling. Tauri
produces smaller binaries but requires a Rust sidecar to run the Node server
and would re-architect the launch path. The `DESKTOP_MODE` abstraction is the
seam at which a Tauri port would slot in.

## Limitations / next steps

- `local` mode still expects Postgres + Redis to be reachable (a bundled DB
  binary is out of scope).
- No auto-updater wired yet (add `electron-updater` + an update feed).
- No tray / dock extras beyond the standard app menu.
- No deep-link scheme yet (`trivio://`) — the IPC + `navigate` bridge is in
  place; register the scheme in `main.ts` and the OS via the builder config.
