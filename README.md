# AutoAccounts

A modern, full-stack SaaS accounting application built for freelancers, solopreneurs, and small businesses. AutoAccounts provides proper double-entry bookkeeping behind a simple, intuitive UI — no accounting degree required.

## Features

- **Double-Entry Bookkeeping** — Every transaction creates balanced journal entries (debits = credits), ensuring your books are always accurate.
- **Invoicing (AR)** — Create, send, and track customer invoices. Generate PDF invoices with one click.
- **Bills (AP)** — Record supplier bills, track what you owe, and manage payment due dates.
- **AI Document Extraction** — Upload receipts or invoices and let AI extract line items, dates, totals, and supplier info automatically. Uses local Ollama models (vision-capable) for privacy.
- **Bank Reconciliation** — Import bank statements (CSV) and match transactions against your books.
- **Financial Reports** — Profit & Loss, Balance Sheet, Trial Balance, AR/AP Aging, and Tax Summary reports.
- **Multi-Currency** — Set your base currency during onboarding; supports all major currencies.
- **Tax Regimes** — Configure VAT, GST, Sales Tax, or other tax schemes with multiple rates.
- **Chart of Accounts** — Auto-generated based on your business type with full customization.
- **Contact Management** — Track customers and suppliers with contact details.
- **Subscription Billing** — Free tier with usage limits, paid plans via Stripe integration.
- **Audit Trail** — Every action is logged for accountability and compliance.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) + TypeScript |
| API | tRPC (end-to-end type safety) |
| Database | PostgreSQL 16 + Prisma ORM |
| Auth | NextAuth.js v5 (credentials + OAuth) |
| UI | Tailwind CSS + shadcn/ui + Radix Primitives |
| Queue | BullMQ + Redis |
| AI | Ollama (local LLM — gemma4:e4b or any vision model) |
| Storage | AWS S3 (MinIO for local development) |
| Email | Resend (MailHog for local dev) |
| Payments | Stripe (subscriptions + webhooks) |
| Testing | Vitest (unit/integration) + Playwright (E2E) |

## Prerequisites

- **Node.js** 18+ (recommended: 20+)
- **Docker** & **Docker Compose** (for local services)
- **Ollama** (optional, for AI extraction) — [Install Ollama](https://ollama.com)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Abubakarjutt/AutoAccounting.git
cd AutoAccounting
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start local services

This spins up PostgreSQL, Redis, MinIO (S3-compatible storage), and MailHog (email testing):

```bash
docker compose up -d
```

### 4. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and set:
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- Other values can stay as defaults for local development

### 5. Set up the database

```bash
npx prisma migrate dev
npm run db:seed
```

### 6. Start the development server

```bash
npm run dev
```

Visit **http://localhost:3000** — register an account and go through the onboarding wizard.

### 7. (Optional) Set up AI extraction

Pull a vision-capable model with Ollama:

```bash
ollama pull gemma4:e4b
```

Start the extraction worker in a separate terminal:

```bash
npx tsx server/workers/extraction.worker.ts
```

Now you can upload receipts/invoices and have AI extract the data automatically.

## Project Structure

```
AutoAccounts/
├── app/                    # Next.js App Router pages
│   ├── (app)/              # Authenticated app routes
│   │   ├── dashboard/      # Main dashboard
│   │   ├── invoices/       # Invoice management (AR)
│   │   ├── bills/          # Bill management (AP)
│   │   ├── contacts/       # Customer & supplier contacts
│   │   ├── accounts/       # Chart of accounts
│   │   ├── transactions/   # Journal entries & CSV import
│   │   ├── reconciliation/ # Bank reconciliation
│   │   ├── reports/        # Financial reports
│   │   ├── extract/        # AI document extraction
│   │   └── settings/       # Org settings & billing
│   ├── (auth)/             # Login & registration
│   ├── (marketing)/        # Public pages (pricing)
│   ├── api/                # API routes (tRPC, auth, uploads)
│   └── onboarding/         # First-time setup wizard
├── server/
│   ├── routers/            # tRPC routers (API logic)
│   ├── services/           # Business logic layer
│   │   ├── accounting.service.ts   # Double-entry engine
│   │   ├── extraction.service.ts   # AI extraction (Ollama)
│   │   ├── invoice.service.ts      # Invoice lifecycle
│   │   ├── bill.service.ts         # Bill lifecycle
│   │   ├── report.service.ts       # Financial reports
│   │   └── reconciliation.service.ts
│   ├── workers/            # Background job processors
│   └── trpc.ts             # tRPC context & middleware
├── components/ui/          # shadcn/ui components
├── lib/                    # Shared utilities & config
├── prisma/
│   ├── schema.prisma       # Database schema
│   ├── migrations/         # SQL migrations
│   └── seed.ts             # Seed data (tax regimes, currencies)
├── tests/
│   ├── unit/               # Vitest unit tests
│   └── e2e/                # Playwright E2E tests
├── docker-compose.yml      # Local dev services
└── docs/                   # Architecture & requirements docs
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (hot reload) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
| `npm run typecheck` | TypeScript type checking |
| `npm run test` | Run unit/integration tests (Vitest) |
| `npm run test:e2e` | Run E2E tests (Playwright) |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed database with initial data |
| `npm run db:studio` | Open Prisma Studio (DB GUI) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_URL` | Yes | App URL (http://localhost:3000 for dev) |
| `NEXTAUTH_SECRET` | Yes | Random secret for JWT signing |
| `REDIS_URL` | Yes | Redis connection string |
| `AWS_S3_ENDPOINT` | Yes | S3/MinIO endpoint |
| `AWS_S3_BUCKET` | Yes | S3 bucket name |
| `AWS_ACCESS_KEY_ID` | Yes | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | S3 secret key |
| `OLLAMA_BASE_URL` | No | Ollama API URL (default: http://localhost:11434) |
| `OLLAMA_MODEL` | No | Ollama model name (default: gemma4:e4b) |
| `STRIPE_SECRET_KEY` | No | Stripe API key (for paid plans) |
| `RESEND_API_KEY` | No | Resend API key (for emails) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth secret |

## Key Design Decisions

- **Void, don't delete** — Posted transactions are never hard-deleted. They are reversed with a voiding journal entry to maintain audit integrity.
- **Monetary precision** — All amounts stored as `NUMERIC(19,4)` in PostgreSQL. Never uses floating point for money.
- **Organisation scoping** — Every database row is scoped to an `organisationId`. All queries enforce multi-tenancy.
- **AI requires confirmation** — Extracted data is always presented for user review before saving. Never auto-saves.
- **Local AI** — Uses Ollama for document extraction, keeping sensitive financial documents on your own hardware.

## Local Development Services

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Job queue (BullMQ) |
| MinIO (API) | 9000 | S3-compatible file storage |
| MinIO (Console) | 9001 | MinIO web UI |
| MailHog (SMTP) | 1025 | Email capture |
| MailHog (Web) | 8025 | Email viewer UI |
| Ollama | 11434 | Local AI inference |

## License

This project is proprietary. All rights reserved.
