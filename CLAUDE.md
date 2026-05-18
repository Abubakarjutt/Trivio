# AutoAccounts — Claude Code Context

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
- **AI**: Anthropic Claude API (claude-sonnet-4-6) for document extraction
- **Storage**: AWS S3 (MinIO locally)
- **Email**: Resend
- **Payments**: Stripe
- **Local dev**: Docker Compose

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

## Current Sprint

See [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — Sprint 0 (scaffold) is next.

---

## gstack

Use the `/browse` skill from gstack for all web browsing. **Never use `mcp__claude-in-chrome__*` tools.**

### First-time setup (run once per machine)

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
```

### Available gstack skills

`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
