<p align="center">
  <img src="./docs/assets/trivio-banner.svg" alt="Trivio — Accounting, made simple" width="100%" />
</p>

<h3 align="center">Accounting, made simple.</h3>

<p align="center">
  <a href="https://github.com/Abubakarjutt/Trivio/releases/latest">
    <img src="https://img.shields.io/badge/release-latest-blue" alt="Release" />
  </a>
  <a href="https://github.com/Abubakarjutt/Trivio/actions/workflows/ci.yml">
    <img src="https://github.com/Abubakarjutt/Trivio/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" />
  </a>
  <a href="https://nextjs.org">
    <img src="https://img.shields.io/badge/Next.js-15-black" alt="Next.js 15" />
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/badge/node-20%2B-green" alt="Node 20+" />
  </a>
  <a href="#two-products-one-codebase">
    <img src="https://img.shields.io/badge/platform-Web%20·%20macOS-cyan" alt="Platform: Web and macOS" />
  </a>
</p>

<p align="center">
  <strong>Smart accounting for freelancers, solopreneurs, and small businesses.</strong>
</p>

---

Trivio puts proper **double-entry bookkeeping** behind a friendly interface — with
**AI that reads your receipts and bank statements**, and a **native macOS desktop app**
that runs your entire stack offline. No accounting degree required.

It's **free and open source** ([MIT](./LICENSE)). Self-host it, extend it, or use it as-is.

## ✨ Why Trivio

- **No learning curve** — a modern UI built for people who _run_ a business, not accountants.
- **Always balanced** — every transaction is a balanced journal entry (debits = credits). It's enforced in code.
- **Privacy by default** — AI extraction runs on a local model by default, so your financial documents never leave your machine.
- **Runs anywhere** — the web app deploys to any host; the desktop app bundles its own database and a local AI model, so it works offline after a one-time model download.

## 🚀 How it works

1. **Set up in minutes** — pick a business type; Trivio builds a ready-to-go chart of accounts and tax regime.
2. **Feed it documents** — drop in receipts, invoices, or a bank statement; AI drafts the entry.
3. **Review & post** — you confirm every entry, and your books stay mathematically correct.

## ✨ Features

| Feature                      | What you get                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| **Double-entry bookkeeping** | Balanced journal entries on every transaction — your books are always correct.     |
| **Invoices & AR**            | Create, send, and track customer invoices with one-click PDFs.                     |
| **Bills & AP**               | Record supplier bills and keep payment due dates in check.                         |
| **AI document extraction**   | Upload a receipt, invoice, or statement — AI drafts the entry; you just confirm.   |
| **Bank reconciliation**      | Import CSV statements and match transactions to your records.                      |
| **Financial reports**        | P&L, balance sheet, cash flow, trial balance, AR/AP aging, and tax summary.        |
| **Multi-currency**           | Choose a base currency at onboarding; every major currency is supported.           |
| **Tax regimes**              | Configure VAT, GST, Sales Tax, or custom schemes with multiple rates.              |
| **Chart of accounts**        | Auto-generated for your business type, and fully customizable.                     |
| **Contacts**                 | Track customers and suppliers in one place.                                        |
| **Recurring & planning**     | Recurring transactions, budgets, goals, watchlists, and personal-finance tracking. |
| **AI chat assistant**        | Ask questions about your books, grounded in your own data.                         |
| **Audit trail**              | Every action is logged for accountability and compliance.                          |

## 🧠 Privacy-first AI

Trivio's AI reads receipts, invoices, and bank statements, and it's built to keep
your data where you want it:

- **Local by default (Ollama).** A vision-capable model (e.g. `gemma4:e4b`) runs
  entirely on your machine — no API key. The model downloads once on first launch,
  then runs with no network. This is what the desktop app uses.
- **Cloud when you opt in (Gemini).** Set a `GEMINI_API_KEY` to use a hosted model
  instead. Trivio auto-selects: cloud when a key is present, otherwise the local engine.
- **You always confirm.** Extracted data is presented for review before anything is
  saved. Trivio never auto-posts an AI-suggested entry.

## 💻 Two products, one codebase

Trivio ships as two products that **share 100% of the application code**:

- **Web app** — the Next.js application at the repository root. Deploy it anywhere:
  a Node host, a container, or a serverless runtime.
- **Desktop app (macOS & Windows)** — an Electron shell in [`desktop/`](./desktop/README.md)
  that boots the _same_ app inside a native window. It bundles an embedded PostgreSQL
  engine and a local Ollama model, so it runs **offline** after a one-time model download — no `docker compose up`,
  no external database. A single switch, `DESKTOP_MODE`, chooses between **dev**,
  **local** (boots the compiled server), and **remote** (thin client to a hosted URL).

The desktop shell is the only thing that differs — everything the UI and backend do is
identical to the web app. See [`desktop/README.md`](./desktop/README.md) for the full
build, signing, and notarization guide.

### Download the desktop app

Installers are published to [GitHub Releases](https://github.com/Abubakarjutt/Trivio/releases) (macOS `.dmg`/`.zip`, and Windows `setup.exe` + portable `.exe`), and linked from the landing
page. After the first release the buttons point at `/releases/latest`, which always resolves
to the newest build.

> [!NOTE]
> **First launch downloads the local AI model once** (the Gemma weights, a few hundred MB),
> then everything — bookkeeping, reports, and the AI assistant — runs offline. The embedded
> database needs no network at all.
>
> **Signing.** A _signed & notarized_ macOS build opens cleanly on any Mac; an _unsigned_ one
> shows a Gatekeeper warning (right-click → Open, or `xattr -d com.apple.quarantine Trivio.app`).
> An _unsigned_ Windows build runs but SmartScreen shows a "protected your PC" prompt (click
> **More info → Run anyway**). Set the Apple / Windows signing secrets in the Actions settings
> to ship signed, warning-free installers.

### Build the desktop app yourself

```bash
# 1. Fetch the embedded PostgreSQL engine (platform-specific binary)
npm run fetch:pg

# 2. Develop: native window + `next dev` (fast HMR loop)
npm run dev:desktop

# 3. Build a signed & notarized .dmg
#    Requires a Developer ID identity + Apple notary creds:
#    CSC_NAME / CSC_LINK / CSC_KEY_PASSWORD and APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
npm run build:desktop
#   → release/Trivio-<version>-arm64.dmg

# Windows (run on Windows, or let CI do it on windows-latest):
npm run build:desktop:win
# → release/Trivio-<version>-win-x64-setup.exe (+ portable .exe)
```

### Publishing a release

Pushing a version tag (e.g. `v1.2.3`) triggers
[`.github/workflows/desktop-release.yml`](./.github/workflows/desktop-release.yml), which
builds and publishes the macOS `.dmg`/`.zip` (plus `latest-mac.yml`, `.blockmap`), then a second job
builds the Windows `setup.exe`/portable `.exe` and appends them to the same release — the feed
that powers in-app auto-updates. (Signing is optional: without the Apple/Windows secrets the build
still ships, just unsigned.)

```bash
git tag v1.2.3
git push origin main v1.2.3
```

> [!NOTE]
> The certificate in `CSC_LINK` must be a **Developer ID Application** identity (not
> "Apple Development"), or Gatekeeper will block the `.dmg` on other machines.

## 🏁 Quick start

### Prerequisites

- **Node.js** 20+
- **Docker** & **Docker Compose** (for local services)
- **Ollama** _(optional)_ — for local AI extraction. [Install Ollama](https://ollama.com)

### 1 · Clone the repository

```bash
git clone https://github.com/Abubakarjutt/Trivio.git
cd Trivio
```

### 2 · Install dependencies

```bash
npm install
```

### 3 · Start local services

Spins up PostgreSQL, Redis, MinIO (S3-compatible storage), and MailHog (email testing):

```bash
docker compose up -d
```

### 4 · Configure the environment

```bash
cp .env.example .env.local
```

Then set at least:

- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `CRON_SECRET` — generate with `openssl rand -hex 32`

Everything else can stay at its default for local development.

### 5 · Set up the database

```bash
npx prisma migrate dev
npm run db:seed
```

### 6 · Start the development server

```bash
npm run dev
```

Visit **http://localhost:3000**, create an account, and walk through the onboarding wizard.

### 7 · (Optional) Enable local AI extraction

```bash
ollama pull gemma4:e4b                       # a vision-capable model
npx tsx server/workers/extraction.worker.ts   # in a second terminal — the BullMQ worker
```

Now you can upload receipts and invoices and have the AI extract the data for you.

## 🧱 Tech stack

| Layer         | Choice                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------- |
| **Framework** | Next.js 15 (App Router) · React 19 · TypeScript                                                |
| **API**       | [tRPC](https://trpc.io/) v11 — end-to-end type safety                                          |
| **Database**  | PostgreSQL 16 · [Prisma](https://www.prisma.io/) ORM                                           |
| **Auth**      | [NextAuth.js](https://authjs.dev/) v5 — credentials + Google OAuth                             |
| **UI**        | Tailwind CSS · [shadcn/ui](https://ui.shadcn.com/) · Radix UI                                  |
| **State**     | [TanStack React Query](https://tanstack.com/query)                                             |
| **Queue**     | [BullMQ](https://docs.bullmq.io/) · Redis                                                      |
| **AI**        | Ollama (local, default) · Gemini (cloud) — privacy-first, user-confirmed                       |
| **Storage**   | AWS S3 (MinIO for local development)                                                           |
| **Email**     | Resend (MailHog for local development)                                                         |
| **Payments**  | Stripe · Lemon Squeezy                                                                         |
| **PDF**       | `@react-pdf/renderer` · `pdfjs-dist`                                                           |
| **Testing**   | [Vitest](https://vitest.dev/) (unit/integration) · [Playwright](https://playwright.dev/) (E2E) |
| **Desktop**   | Electron · electron-builder (macOS)                                                            |

## 🏛️ Design principles

These invariants are enforced in the codebase and are the reason the books are always
trustworthy. Please preserve them when contributing.

- **Balanced double-entry.** Every transaction must be a balanced journal entry (debits
  equal credits). The `AccountingService` throws if they don't — never bypass this.
- **Monetary precision.** All amounts are stored as `NUMERIC(19,4)`. Floating point is
  never used for money.
- **Organisation scoping.** Every database row carries an `organisationId`; all queries
  are scoped to the authenticated organisation. This is how multi-tenancy works.
- **Void, don't delete.** Posted transactions are never hard-deleted. They are reversed
  with a voiding journal entry to preserve audit integrity.
- **AI requires confirmation.** Extracted data is always reviewed by the user before it
  is saved. Trivio never auto-posts.
- **Privacy-first AI.** Extraction runs on a local model by default, keeping sensitive
  documents on the user's own hardware.

## 🧰 Local development

### Services

`docker compose up -d` provisions the following services for a zero-config local setup:

| Service         |  Port   | Purpose                         |
| --------------- | :-----: | ------------------------------- |
| App (Next.js)   | `3000`  | The web application             |
| PostgreSQL      | `5432`  | Primary database                |
| Redis           | `6379`  | BullMQ job queue                |
| MinIO (API)     | `9000`  | S3-compatible file storage      |
| MinIO (Console) | `9001`  | MinIO web UI                    |
| MailHog (Web)   | `8025`  | View captured emails            |
| MailHog (SMTP)  | `1025`  | Catch emails locally            |
| Ollama          | `11434` | Local AI inference _(optional)_ |

### Environment variables

The full list lives in [`.env.example`](./.env.example). The core ones:

| Variable                                                                             | Required | Description                                                                       |
| ------------------------------------------------------------------------------------ | :------: | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                       |    ✔     | Postgres connection (ignored on the desktop app, which uses an embedded database) |
| `NEXTAUTH_SECRET`                                                                    |    ✔     | Random secret for signing sessions — `openssl rand -base64 32`                    |
| `NEXTAUTH_URL`                                                                       |    ✔     | Public URL of the app                                                             |
| `CRON_SECRET`                                                                        |    ✔     | Protects scheduled-job endpoints                                                  |
| `REDIS_URL`                                                                          |    ✔     | Redis connection string for BullMQ                                                |
| `AWS_S3_ENDPOINT` / `AWS_S3_BUCKET` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`  |    ✔     | S3 / MinIO storage                                                                |
| `GEMINI_API_KEY`                                                                     |    –     | Enables the cloud AI backend (Gemini). Auto-selected when present.                |
| `OLLAMA_HOST` / `OLLAMA_MODEL`                                                       |    –     | Local AI engine — default `http://127.0.0.1:11434` / `gemma4:e4b`                 |
| `AI_PROVIDER`                                                                        |    –     | `gemini` · `ollama` · _auto_ (cloud when a key is set, else local)                |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |    –     | Subscriptions & webhooks                                                          |
| `LEMONSQUEEZY_CHECKOUT_UUID` / `LEMONSQUEEZY_WEBHOOK_SECRET`                         |    –     | Billing                                                                           |
| `RESEND_API_KEY` / `EMAIL_FROM`                                                      |    –     | Transactional email                                                               |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                                          |    –     | Google OAuth                                                                      |
| `SKIP_EMAIL_VERIFICATION`                                                            |    –     | Dev convenience only — **never** set in production                                |

### Handy scripts

| Command                              | What it does                          |
| ------------------------------------ | ------------------------------------- |
| `npm run dev`                        | Start the Next.js dev server          |
| `npm run build` / `npm start`        | Production build / start              |
| `npx prisma migrate dev`             | Create & apply a dev migration        |
| `npm run db:seed`                    | Seed a demo organisation              |
| `npm run db:studio`                  | Open the Prisma Studio GUI            |
| `npm test`                           | Run the Vitest unit/integration suite |
| `npm run test:e2e`                   | Run the Playwright E2E suite          |
| `npm run typecheck` / `npm run lint` | Type-check / lint                     |

## 🧪 Testing

```bash
npm run test          # unit + integration (Vitest)
npm run test:e2e      # end-to-end (Playwright)
npm run typecheck     # TypeScript check
```

CI runs the full suite on every push and pull request — see
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## 📁 Project structure

```
.
├── app/                     # Next.js App Router
│   ├── (app)/               # Authenticated app (dashboard, invoices, bills, …)
│   ├── (auth)/              # Login, register, password reset
│   ├── (marketing)/         # Public pages (pricing, privacy, blog)
│   ├── api/                 # API routes (tRPC, auth, uploads, webhooks)
│   └── onboarding/          # First-time setup wizard
├── server/
│   ├── routers/             # tRPC routers (API logic)
│   ├── services/            # Business logic (accounting, AI, email, …)
│   └── workers/             # BullMQ workers (AI extraction)
├── lib/                     # Shared utilities, Prisma client, auth
├── prisma/                  # Schema, migrations, seed
├── desktop/                 # Electron shell for the macOS app
└── docs/                    # Requirements, architecture, and this README's assets
```

## 📚 Documentation

| Document                                                     | What it covers                               |
| ------------------------------------------------------------ | -------------------------------------------- |
| [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md)               | Functional & non-functional requirements     |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)               | System design and domain model               |
| [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) | Sprint-by-sprint roadmap                     |
| [desktop/README.md](./desktop/README.md)                     | Building, signing & notarizing the macOS app |

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository and create a branch from `main`.
2. Make your change and add or update tests.
3. Ensure `npm run typecheck`, `npm test`, and `npm run lint` all pass.
4. Open a pull request describing what and why.

Please respect the [design principles](#design-principles) above — especially the
double-entry and multi-tenancy invariants.

## 📜 License

Trivio is open source under the **[MIT License](./LICENSE)**. Use it, fork it,
self-host it, and build commercial products on top of it.

---

<p align="center">
  <sub>
    <a href="https://github.com/Abubakarjutt/Trivio">Trivio</a> ·
    <a href="https://github.com/Abubakarjutt/Trivio/releases">Releases</a> ·
    <a href="https://github.com/Abubakarjutt/Trivio/issues">Issues</a> ·
    <a href="./LICENSE">MIT License</a>
  </sub>
</p>
