# AutoAccounts — Codex Context

## Project Summary

AutoAccounts is a SaaS accounting web app for non-accountants (freelancers, solopreneurs, small businesses). It provides double-entry bookkeeping behind a simple UI, AI-powered receipt/invoice extraction, bank reconciliation, AR/AP management, and financial reporting.

## Key Documents

- [Requirements](docs/REQUIREMENTS.md) — functional and non-functional requirements
- [Architecture](docs/ARCHITECTURE.md) — tech stack, system design, domain model
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) — sprint-by-sprint task list

## Tech Stack (quick reference)

- **Framework**: Next.js 15 (App Router) + TypeScript
- **API**: tRPC
- **DB**: PostgreSQL 16 + Prisma ORM
- **Auth**: NextAuth.js v5
- **UI**: Tailwind CSS + shadcn/ui
- **Queue**: BullMQ + Redis
- **AI**: Anthropic Codex API (Codex-sonnet-4-6) for document extraction
- **Storage**: AWS S3 (MinIO locally)
- **Email**: Resend
- **Payments**: Stripe
- **Local dev**: Docker Compose
- **Desktop**: Electron + electron-builder (macOS); wraps the Next.js app — see `desktop/`

## Desktop (macOS)

The web app is also shipped as a native macOS app (`desktop/`): an Electron
shell that boots the app's own server inside a native window — UI and backend
are unchanged. Run modes via `DESKTOP_MODE`: **dev** (loads `next dev`),
**local** (boots the Next.js `standale` server from `desktop/dist-server`),
**remote** (loads an already-hosted URL — thin client).

The embedded server runs on a private loopback port via `ELECTRON_RUN_AS_NODE`
(no separate `node` binary shipped) and loads credentials from
`~/.trivio/.env` (copy `.env.example` there). Sign & notarize with `CSC_NAME`
+ `APPLE_*` (entitlements are already wired for hardened runtime).
Full details: [`desktop/README.md`](desktop/README.md).

## Critical Invariants

- **Every transaction must be a balanced double-entry journal entry** — debits must equal credits. `AccountingService` must throw if they don't. Never bypass this.
- **Monetary values always stored as `NUMERIC(19,4)`** — never use floats for money.
- **Every DB row has `organisationId`** — all queries must be scoped to the authenticated user's organisation.
- **AI extraction always requires user confirmation** — never auto-save extracted data.
- **Void, don't delete** — posted transactions are voided (reversal journal), never hard-deleted.

## Dev Commands

```bash
# Start local services
docker compose up -d

# Run the app
npm run dev

# DB migrations
npx prisma migrate dev

# Tests
npm run test          # Vitest unit/integration
npm run test:e2e      # Playwright E2E
```

```bash
# macOS desktop (Electron) — full details in desktop/README.md
npm run dev:desktop           # native window + `next dev` (fast loop)
npm run build:desktop         # next build + assemble + electron-builder -> release/*.dmg
```

## Current Sprint

See [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — Sprint 0 (scaffold) is next.
