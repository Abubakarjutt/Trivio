# EasyFinance → AutoAccounts Full Port

**Date:** 2026-06-03
**Scope:** Port all changes made in EasyFinance after commit `a45f35b` (mobile responsive design sync) to AutoAccounts.

---

## 1. Utility Libraries (`lib/`)

### `lib/currency.ts` (new)
Direct copy. Exports `formatCurrency(amount, currency?)` and `formatCurrencyK(amount, currency?)` using `Intl.NumberFormat`.

### `lib/plan.ts` (new)
Direct copy. Exports:
- Constants: `FREE_AI_LIMIT = 2`, `FREE_TX_LIMIT = 50`
- `isPro(plan)` predicate
- `checkAiExtractionLimit(orgId, plan)` — counts `statementImportBatch` rows this month
- `checkTransactionLimit(orgId, plan)` — counts `statementTransaction` rows this month

### `lib/lemonsqueezy.ts` (new)
Direct copy. Exports:
- `buildCheckoutUrl(orgId, email, plan)` — constructs a Lemon Squeezy checkout URL with `custom_data`
- `verifyWebhookSignature(rawBody, signature)` — HMAC-SHA256 verification

---

## 2. Prisma Schema

Add to `prisma/schema.prisma`:

```prisma
enum Plan {
  FREE
  PRO
}

enum LsSubscriptionStatus {
  active
  cancelled
  past_due
  expired
}
```

Add fields to `Organisation` model:
```prisma
plan                   Plan                  @default(FREE)
lsCustomerId           String?
lsSubscriptionId       String?               @unique
lsSubscriptionStatus   LsSubscriptionStatus?
```

Run `prisma migrate dev --name add_plan_and_ls_billing`.

---

## 3. Import Route Plan Enforcement (`app/api/pf/import/route.ts`)

After the existing auth + org lookup, insert a plan enforcement block:

1. Fetch `org.plan` from `db.organisation`
2. For CSV imports: call `checkTransactionLimit` — return 403 with `{ error, limitReached: "transactions" }` if exceeded
3. For PDF/image imports: call `checkAiExtractionLimit` — return 403 with `{ error, limitReached: "ai_extractions" }` if exceeded

No other changes to the import route logic.

---

## 4. Auth Pages Redesign

Replace these files with EasyFinance versions (direct copy):
- `app/(auth)/layout.tsx`
- `app/(auth)/login/page.tsx`
- `app/(auth)/register/page.tsx`
- `app/onboarding/page.tsx`

Create new files from EasyFinance:
- `app/(auth)/forgot-password/page.tsx`
- `app/(auth)/reset-password/page.tsx`
- `app/api/auth/forgot-password/route.ts`
- `app/api/auth/reset-password/route.ts`

---

## 5. Lemon Squeezy Webhook

### `app/api/webhooks/lemonsqueezy/route.ts` (new)
Direct copy from EasyFinance. Handles `subscription_created` and `subscription_updated` events:
- Verifies HMAC-SHA256 signature
- Upserts `Organisation` billing fields (`plan`, `lsCustomerId`, `lsSubscriptionId`, `lsSubscriptionStatus`)
- Falls back to user email lookup when `org_id` missing from `custom_data`

### `middleware.ts`
Add `/api/webhooks` to the public routes matcher so the webhook endpoint is not blocked by NextAuth.

---

## 6. Billing Settings Page

AutoAccounts already has `app/(app)/settings/billing/page.tsx` as a dedicated page (not a tab). Replace its content with the `billing-tab.tsx` content from EasyFinance, adapted as a standalone page:
- Shows current plan (FREE/PRO)
- Shows usage stats (AI extractions used, transactions imported this month)
- Shows Upgrade CTA for FREE users (links to LS checkout URL via `buildCheckoutUrl`)
- Shows "You're on Pro" confirmation for PRO users

### `server/routers/org.ts`
Expose `id` in the `org.get` query return shape — required by the billing page to construct the checkout URL.

---

## 7. Feature Gating — Budgets

Update `app/(app)/budgets/page.tsx`:
- Fetch `org.plan` via tRPC `org.get`
- If `plan === "FREE"`: render an upgrade prompt card instead of the budget content
- If `plan === "PRO"`: render the existing budget page as normal

No `ask/` page exists in AutoAccounts — skip that gate.

---

## 8. Visual Theme

### `app/globals.css`
Update only the CSS variable values in `:root` (and `.dark` if present) to the forest-green theme. Keep AutoAccounts' Tailwind v4 `@import "tailwindcss"` syntax — do NOT replace with v3 `@tailwind base/components/utilities` directives.

Color values to apply:
```
--background: 48 19% 95%        /* #F4F3EF cream */
--foreground: 225 21% 7%        /* #0F1117 ink */
--primary: 153 59% 25%          /* #1A6644 forest green */
--primary-foreground: 0 0% 100%
--secondary: 150 33% 94%        /* #EBF5F0 green-dim */
--secondary-foreground: 225 21% 7%
--muted: 150 33% 94%
--muted-foreground: 223 9% 46%  /* #6B7180 */
--accent: 150 33% 94%
--accent-foreground: 225 21% 7%
--border: 45 18% 87%            /* #E4E1D8 warm border */
--input: 45 18% 87%
--ring: 153 59% 25%
```

### `app/layout.tsx`
Update Google Font imports from the AutoAccounts fonts to EasyFinance fonts:
- `Fraunces` (variable `--font-display`, weights 300/400/500/700)
- `DM_Sans` (variable `--font-sans`, weights 300–700)
- `DM_Mono` (variable `--font-mono`, weights 300/400/500)

Update `<body>` className to apply the new font variables.

---

## Out of Scope

- `server/services/pdf-statement.service.ts` — intentionally different (AutoAccounts uses Gemini + PII redaction; EasyFinance uses Ollama)
- `server/services/image-statement.service.ts` — same reason
- `server/services/statement-parser.service.ts` — already identical
- `app/(app)/ask/` feature gate — no ask page in AutoAccounts
- EasyFinance-specific docs and plan files
- `cloudflare/email-worker/` changes

---

## Migration Steps (in order)

1. Schema changes + migration
2. Utility libs (currency, plan, lemonsqueezy)
3. Import route enforcement
4. Webhook handler + middleware
5. Billing settings page + org router
6. Feature gate (budgets)
7. Auth pages
8. Visual theme (globals.css + layout.tsx)
