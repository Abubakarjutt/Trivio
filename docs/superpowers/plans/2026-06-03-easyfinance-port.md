# EasyFinance → AutoAccounts Full Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all EasyFinance changes (after commit `a45f35b`) to AutoAccounts — plan limits, Lemon Squeezy billing, auth redesign, and forest-green visual theme.

**Architecture:** Eight sequential task groups following the spec migration order: schema first (everything depends on it), then libs, import enforcement, webhook, billing UI, feature gate, auth pages, and finally visual theme. The LS billing system is self-contained: `lib/lemonsqueezy.ts` → webhook route → `org.get` tRPC query → billing page → budget gate.

**Tech Stack:** Next.js 15 App Router, Prisma + PostgreSQL, tRPC, NextAuth v5, Tailwind v4, Lemon Squeezy, Resend, bcryptjs

---

### Task 1: Prisma Schema — Plan / Billing / PasswordResetToken

**Files:**
- Modify: `prisma/schema.prisma`
- New migration: `prisma/migrations/<timestamp>_add_plan_ls_billing_password_reset/`

- [ ] **Step 1: Add enums and Organisation billing fields**

Open `prisma/schema.prisma`. Find the block of existing enums near the top. Add these two enums (place them with the other enums):

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

Then find the `Organisation` model and add four fields inside it (after `emailImportToken`):

```prisma
  plan                   Plan                  @default(FREE)
  lsCustomerId           String?
  lsSubscriptionId       String?               @unique
  lsSubscriptionStatus   LsSubscriptionStatus?
```

- [ ] **Step 2: Add PasswordResetToken model**

At the bottom of `prisma/schema.prisma`, append:

```prisma
model PasswordResetToken {
  id        String   @id @default(cuid())
  email     String
  token     String   @unique @default(cuid())
  expires   DateTime
  createdAt DateTime @default(now())

  @@index([email])
}
```

- [ ] **Step 3: Run migration**

```bash
cd /Users/Apple/projects/AutoAccounts
npx prisma migrate dev --name add_plan_ls_billing_password_reset
```

Expected: migration created and applied, Prisma client regenerated.

- [ ] **Step 4: Verify TypeScript compilation picks up new types**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors (only pre-existing ones are acceptable).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add Plan/LsSubscriptionStatus enums, org billing fields, PasswordResetToken"
```

---

### Task 2: Utility Libraries — currency, plan, lemonsqueezy, resend

**Files:**
- Create: `lib/currency.ts`
- Create: `lib/plan.ts`
- Create: `lib/lemonsqueezy.ts`
- Create: `lib/resend.ts`

- [ ] **Step 1: Install resend package**

```bash
cd /Users/Apple/projects/AutoAccounts
npm install resend
```

Expected: `resend` added to `package.json` dependencies.

- [ ] **Step 2: Create `lib/currency.ts`**

```typescript
export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCurrencyK(amount: number, currency = "USD"): string {
  if (amount >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(amount / 1000) + "k";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
```

- [ ] **Step 3: Create `lib/plan.ts`**

```typescript
import { db } from "@/lib/db";

export const FREE_AI_LIMIT = 2;
export const FREE_TX_LIMIT = 50;

export type PlanType = "FREE" | "PRO";

export function isPro(plan: PlanType): boolean {
  return plan === "PRO";
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function checkAiExtractionLimit(
  orgId: string,
  plan: PlanType
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const used = await db.statementImportBatch.count({
    where: {
      organisationId: orgId,
      createdAt: { gte: startOfMonth() },
    },
  });
  if (plan === "PRO") return { allowed: true, used, limit: null };
  return { allowed: used < FREE_AI_LIMIT, used, limit: FREE_AI_LIMIT };
}

export async function checkTransactionLimit(
  orgId: string,
  plan: PlanType
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const used = await db.statementTransaction.count({
    where: {
      organisationId: orgId,
      createdAt: { gte: startOfMonth() },
    },
  });
  if (plan === "PRO") return { allowed: true, used, limit: null };
  return { allowed: used < FREE_TX_LIMIT, used, limit: FREE_TX_LIMIT };
}
```

- [ ] **Step 4: Create `lib/lemonsqueezy.ts`**

```typescript
import crypto from "crypto";

const CHECKOUT_BASE = `https://trivio-ai.lemonsqueezy.com/checkout/buy/${process.env.LEMONSQUEEZY_CHECKOUT_UUID}`;

export function buildCheckoutUrl(email: string, orgId: string): string {
  const params = new URLSearchParams({
    "checkout[email]": email,
    "checkout[custom][org_id]": orgId,
  });
  return `${CHECKOUT_BASE}?${params.toString()}`;
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Create `lib/resend.ts`**

```typescript
import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  await resend.emails.send({
    from: "AutoAccounts <onboarding@resend.dev>",
    to: email,
    subject: "Reset your AutoAccounts password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0F1117;">
        <div style="margin-bottom: 24px;">
          <span style="font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em;">AutoAccounts</span>
        </div>
        <h1 style="font-size: 1.5rem; font-weight: 600; margin: 0 0 8px;">Reset your password</h1>
        <p style="color: #6B7180; margin: 0 0 24px; line-height: 1.6;">
          We received a request to reset your password. Click the button below to choose a new one.
          This link expires in <strong>1 hour</strong>.
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; background: #1A6644; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9375rem;">
          Reset password
        </a>
        <p style="color: #9CA3AF; font-size: 0.8125rem; margin: 24px 0 0; line-height: 1.6;">
          If you didn't request this, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #E4E1D8; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 0.75rem; margin: 0;">© 2026 AutoAccounts</p>
      </div>
    `,
  });
}
```

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "lib/(currency|plan|lemonsqueezy|resend)" | head -10
```

Expected: no output (no errors in the new files).

- [ ] **Step 7: Commit**

```bash
git add lib/currency.ts lib/plan.ts lib/lemonsqueezy.ts lib/resend.ts package.json package-lock.json
git commit -m "feat: add currency, plan, lemonsqueezy, and resend utility libs"
```

---

### Task 3: Import Route — Plan Enforcement

**Files:**
- Modify: `app/api/pf/import/route.ts`

- [ ] **Step 1: Read the current import route**

Read `app/api/pf/import/route.ts` and locate the section after auth validation and org lookup where `organisationId` is confirmed. This is where the plan enforcement block goes.

- [ ] **Step 2: Add the plan enforcement block**

At the top of `route.ts`, add the import for plan helpers alongside existing imports:

```typescript
import { checkAiExtractionLimit, checkTransactionLimit } from "@/lib/plan";
```

Then, after the line where `organisationId` is resolved and confirmed (just before the file-type detection / `isCsv` logic), insert:

```typescript
  // ── Plan enforcement ─────────────────────────────────────────────────────
  const org = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { plan: true },
  });
  const plan = (org?.plan ?? "FREE") as "FREE" | "PRO";

  if (isCsv) {
    const { allowed, used, limit } = await checkTransactionLimit(organisationId, plan);
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Free plan limit reached: ${used}/${limit} transactions imported this month. Upgrade to Pro for unlimited imports.`,
          limitReached: "transactions",
        },
        { status: 403 }
      );
    }
  } else {
    const { allowed, used, limit } = await checkAiExtractionLimit(organisationId, plan);
    if (!allowed) {
      return NextResponse.json(
        {
          error: `Free plan limit reached: ${used}/${limit} AI extractions used this month. Upgrade to Pro for unlimited extractions.`,
          limitReached: "ai_extractions",
        },
        { status: 403 }
      );
    }
  }
  // ─────────────────────────────────────────────────────────────────────────
```

Note: `isCsv` must already be defined before this block (it's set from the file extension check). Verify the order in the file — if `isCsv` is derived after the auth block but before further processing, the enforcement block goes immediately after `isCsv` is first set.

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "pf/import" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/pf/import/route.ts
git commit -m "feat(import): enforce plan limits on CSV and AI extraction imports"
```

---

### Task 4: Lemon Squeezy Webhook + Middleware

**Files:**
- Create: `app/api/webhooks/lemonsqueezy/route.ts`
- Modify: `middleware.ts`

- [ ] **Step 1: Create webhook handler**

Create `app/api/webhooks/lemonsqueezy/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/lemonsqueezy";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("X-Signature") ?? "";
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName: string = payload?.meta?.event_name ?? "";
  const orgId: string = payload?.meta?.custom_data?.org_id ?? "";
  const userEmail: string = payload?.data?.attributes?.user_email ?? "";
  const subscriptionId: string = payload?.data?.id ?? "";
  const customerId: string = String(payload?.data?.attributes?.customer_id ?? "");
  const status: string = payload?.data?.attributes?.status ?? "";

  let org: { id: string } | null = null;
  if (orgId) {
    org = await db.organisation.findFirst({ where: { id: orgId }, select: { id: true } });
  } else if (userEmail) {
    const user = await db.user.findUnique({
      where: { email: userEmail },
      select: { organisationId: true },
    });
    if (user?.organisationId) {
      org = { id: user.organisationId };
    }
  }

  if (!org) {
    return NextResponse.json({ ok: true });
  }

  switch (eventName) {
    case "subscription_created":
    case "subscription_updated":
      await db.organisation.update({
        where: { id: org.id },
        data: {
          plan: status === "expired" || status === "cancelled" ? "FREE" : "PRO",
          lsCustomerId: customerId,
          lsSubscriptionId: subscriptionId,
          lsSubscriptionStatus: mapStatus(status),
        },
      });
      break;

    case "subscription_cancelled":
      await db.organisation.update({
        where: { id: org.id },
        data: { lsSubscriptionStatus: "cancelled" },
      });
      break;

    case "subscription_expired":
      await db.organisation.update({
        where: { id: org.id },
        data: {
          plan: "FREE",
          lsSubscriptionStatus: "expired",
          lsSubscriptionId: null,
        },
      });
      break;
  }

  return NextResponse.json({ ok: true });
}

function mapStatus(status: string): "active" | "cancelled" | "past_due" | "expired" {
  if (status === "active") return "active";
  if (status === "cancelled") return "cancelled";
  if (status === "past_due") return "past_due";
  return "expired";
}
```

- [ ] **Step 2: Update middleware to expose forgot/reset-password routes**

Read `middleware.ts`. The current `PUBLIC_PREFIXES` array is:
```typescript
const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth", "/api/trpc", "/api/chat", "/pricing", "/api/webhooks"];
```

Add `/forgot-password` and `/reset-password`:
```typescript
const PUBLIC_PREFIXES = ["/login", "/register", "/forgot-password", "/reset-password", "/api/auth", "/api/trpc", "/api/chat", "/pricing", "/api/webhooks"];
```

(Note: `/api/webhooks` is already present, so the LS webhook is already public — no change needed there.)

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "webhooks|middleware" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/lemonsqueezy/route.ts middleware.ts
git commit -m "feat: add Lemon Squeezy webhook handler and expose forgot/reset-password routes"
```

---

### Task 5: org.ts tRPC Router + Billing Settings Page

**Files:**
- Modify: `server/routers/org.ts`
- Modify: `app/(app)/settings/billing/page.tsx`

- [ ] **Step 1: Augment `org.get` to return plan and usage stats**

Open `server/routers/org.ts`. The current `org.get` procedure uses `orgProcedure` and returns the full Prisma org with `taxRegime`. Update it to also compute and return billing fields:

```typescript
  get: orgProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const org = await ctx.db.organisation.findUnique({
      where: { id: ctx.organisationId },
      include: { taxRegime: { include: { rates: true } } },
    });

    const [aiExtractionsUsed, transactionsUsed] = await Promise.all([
      ctx.db.statementImportBatch.count({
        where: { organisationId: ctx.organisationId, createdAt: { gte: monthStart } },
      }),
      ctx.db.statementTransaction.count({
        where: { organisationId: ctx.organisationId, createdAt: { gte: monthStart } },
      }),
    ]);

    return { ...org, aiExtractionsUsed, transactionsUsed };
  }),
```

- [ ] **Step 2: Replace billing page content**

Replace the entire content of `app/(app)/settings/billing/page.tsx` with:

```tsx
"use client";

import { trpc } from "@/lib/trpc/client";
import { buildCheckoutUrl } from "@/lib/lemonsqueezy";
import { useSession } from "next-auth/react";

const FREE_AI_LIMIT = 2;
const FREE_TX_LIMIT = 50;

const FEATURES = [
  "Unlimited AI statement extractions",
  "Unlimited transaction imports",
  "Budget & Goals tracking",
  "Full reports & CSV export",
];

export default function BillingPage() {
  const { data: session } = useSession();
  const { data: org } = trpc.org.get.useQuery();

  if (!org) {
    return (
      <div className="flex flex-col min-h-full">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border/40 bg-background/95 backdrop-blur px-8 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Billing &amp; Subscription</h1>
            <p className="text-sm text-muted-foreground">Manage your plan</p>
          </div>
        </header>
        <main className="flex-1 px-8 py-8">
          <div className="text-sm text-muted-foreground">Loading...</div>
        </main>
      </div>
    );
  }

  const isPro = org.plan === "PRO";
  const checkoutUrl =
    session?.user?.email && org.id
      ? buildCheckoutUrl(session.user.email, org.id)
      : "#";

  const aiUsed = org.aiExtractionsUsed ?? 0;
  const txUsed = org.transactionsUsed ?? 0;

  return (
    <div className="flex flex-col min-h-full">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border/40 bg-background/95 backdrop-blur px-8 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Billing &amp; Subscription</h1>
          <p className="text-sm text-muted-foreground">Manage your plan</p>
        </div>
      </header>

      <main className="flex-1 px-8 py-8 max-w-lg space-y-4">

        {/* Plan badge */}
        <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
              Current plan
            </p>
            <p className="text-lg font-semibold">{isPro ? "Pro" : "Free"}</p>
            {isPro && org.lsSubscriptionStatus === "cancelled" && (
              <p className="text-xs text-amber-600 mt-1">
                Cancelled — access until end of billing period
              </p>
            )}
          </div>
          <span
            className="px-3 py-1 rounded-full text-xs font-bold"
            style={{
              background: isPro ? "#EBF5F0" : "hsl(var(--muted))",
              color: isPro ? "#1A6644" : "hsl(var(--muted-foreground))",
            }}
          >
            {isPro ? "PRO" : "FREE"}
          </span>
        </div>

        {/* Usage stats — Free only */}
        {!isPro && (
          <div className="rounded-xl border border-border/40 bg-card p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              This month&apos;s usage
            </p>

            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">AI statement extractions</span>
                <span className="font-semibold">{aiUsed} / {FREE_AI_LIMIT}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min((aiUsed / FREE_AI_LIMIT) * 100, 100)}%`,
                    background: aiUsed >= FREE_AI_LIMIT ? "#EF4444" : "#1A6644",
                  }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Transactions imported</span>
                <span className="font-semibold">{txUsed} / {FREE_TX_LIMIT}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min((txUsed / FREE_TX_LIMIT) * 100, 100)}%`,
                    background: txUsed >= FREE_TX_LIMIT ? "#EF4444" : "#1A6644",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* CTA */}
        {isPro ? (
          <a
            href="https://app.lemonsqueezy.com/my-orders"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-full h-11 rounded-xl text-sm font-semibold border border-border/40 text-foreground hover:border-border transition-colors"
          >
            Manage subscription →
          </a>
        ) : (
          <div className="space-y-3">
            <a
              href={checkoutUrl}
              className="inline-flex items-center justify-center w-full h-11 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "#1A6644" }}
            >
              Upgrade to Pro — $9/month
            </a>
            <ul className="space-y-1.5">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-green-600">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "billing|org\.ts" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/routers/org.ts "app/(app)/settings/billing/page.tsx"
git commit -m "feat(billing): add LS billing page and expose plan/usage stats in org.get"
```

---

### Task 6: Feature Gate — Budgets

**Files:**
- Modify: `app/(app)/budgets/page.tsx`

- [ ] **Step 1: Read the current budgets page**

Read `app/(app)/budgets/page.tsx` to understand the component structure. The current `BudgetsPage` renders a full budget management UI with `trpc.budgets.list`, create/archive/delete mutations.

- [ ] **Step 2: Add plan gate at the top of `BudgetsPage`**

At the top of the `BudgetsPage` component (before the existing `trpc.budgets.list.useQuery` hooks), add a plan query and early return:

Add to the imports at the top of the file:
```typescript
import { Zap } from "lucide-react";
```

At the start of the `BudgetsPage` function body, before the existing hooks, add:

```typescript
  const { data: orgData } = trpc.org.get.useQuery();

  if (orgData && orgData.plan !== "PRO") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          title="Budgets"
          description="Set spending limits by category and track utilization."
        />
        <div className="rounded-2xl border border-border/40 bg-card p-8 text-center max-w-md mx-auto">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mx-auto mb-4">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <h2 className="font-semibold text-lg mb-2">Pro feature</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Budget tracking is available on the Pro plan. Upgrade to set spending limits and track utilization across categories.
          </p>
          <a
            href="/settings/billing"
            className="inline-flex items-center justify-center h-10 px-6 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#1A6644" }}
          >
            Upgrade to Pro →
          </a>
        </div>
      </div>
    );
  }
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "budgets" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/budgets/page.tsx"
git commit -m "feat(budgets): gate budgets page behind Pro plan"
```

---

### Task 7: Auth Pages Redesign — Layout, Login, Register, Forgot/Reset Password

**Files:**
- Create: `app/(auth)/layout.tsx`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/register/page.tsx`
- Create: `app/(auth)/forgot-password/page.tsx`
- Create: `app/(auth)/reset-password/page.tsx`
- Create: `app/api/auth/forgot-password/route.ts`
- Create: `app/api/auth/reset-password/route.ts`

**Important import difference:** EasyFinance uses `@/components/ui/use-toast` — AutoAccounts uses `@/lib/hooks/use-toast`. All auth page copies use the AutoAccounts path.

- [ ] **Step 1: Create `app/(auth)/layout.tsx`**

```tsx
import { Fraunces, Outfit } from "next/font/google";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  style: ["normal", "italic"],
  weight: ["300", "400", "500", "600", "700"],
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"],
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${fraunces.variable} ${outfit.variable} min-h-screen`} style={{ fontFamily: "var(--font-sans)" }}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Replace `app/(auth)/login/page.tsx`**

Copy the full content of `/Users/Apple/projects/EasyFinance/app/(auth)/login/page.tsx` and make two changes:
1. Change `import { useToast } from "@/components/ui/use-toast";` → `import { useToast } from "@/lib/hooks/use-toast";`
2. Change all occurrences of "Trivio" to "AutoAccounts" (in heading text and the "Back to trivio-ai.com" link — change to "Back to autoaccounts.app" or simply remove the external link)

- [ ] **Step 3: Replace `app/(auth)/register/page.tsx`**

Copy the full content of `/Users/Apple/projects/EasyFinance/app/(auth)/register/page.tsx` and make two changes:
1. Change `import { useToast } from "@/components/ui/use-toast";` → `import { useToast } from "@/lib/hooks/use-toast";`
2. Change all occurrences of "Trivio" to "AutoAccounts"

- [ ] **Step 4: Create `app/(auth)/forgot-password/page.tsx`**

Copy the full content of `/Users/Apple/projects/EasyFinance/app/(auth)/forgot-password/page.tsx` and change:
- `import { useToast } from "@/components/ui/use-toast";` → `import { useToast } from "@/lib/hooks/use-toast";`

- [ ] **Step 5: Create `app/(auth)/reset-password/page.tsx`**

Copy the full content of `/Users/Apple/projects/EasyFinance/app/(auth)/reset-password/page.tsx` and change:
- `import { useToast } from "@/components/ui/use-toast";` → `import { useToast } from "@/lib/hooks/use-toast";`

- [ ] **Step 6: Create `app/api/auth/forgot-password/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/resend";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalised = email.toLowerCase().trim();

    const user = await db.user.findUnique({ where: { email: normalised } });
    if (!user) {
      return NextResponse.json({ success: true });
    }

    await db.passwordResetToken.deleteMany({ where: { email: normalised } });

    const token = await db.passwordResetToken.create({
      data: {
        email: normalised,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${token.token}`;
    await sendPasswordResetEmail(normalised, resetUrl);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[forgot-password]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
```

- [ ] **Step 7: Create `app/api/auth/reset-password/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();

    if (!token || !password || typeof token !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const resetToken = await db.passwordResetToken.findUnique({ where: { token } });

    if (!resetToken) {
      return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
    }

    if (resetToken.expires < new Date()) {
      await db.passwordResetToken.delete({ where: { token } });
      return NextResponse.json({ error: "Reset link has expired. Please request a new one." }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await db.user.update({
      where: { email: resetToken.email },
      data: { hashedPassword },
    });

    await db.passwordResetToken.delete({ where: { token } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[reset-password]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
```

- [ ] **Step 8: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "\(auth\)|forgot|reset-password" | head -10
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add "app/(auth)/layout.tsx" "app/(auth)/login/page.tsx" "app/(auth)/register/page.tsx" \
        "app/(auth)/forgot-password/page.tsx" "app/(auth)/reset-password/page.tsx" \
        "app/api/auth/forgot-password/route.ts" "app/api/auth/reset-password/route.ts"
git commit -m "feat(auth): redesign auth pages, add forgot/reset password flow"
```

> **Note — `app/onboarding/page.tsx` excluded:** AutoAccounts' onboarding is architecturally incompatible with EasyFinance's. AutoAccounts collects `businessType`, `taxRegimeId`, and `fiscalYearStartMonth` and seeds the chart of accounts. Replacing it with EasyFinance's simpler 2-step flow would break core accounting setup. Leave the AutoAccounts onboarding untouched.

---

### Task 8: Visual Theme — globals.css Colors + layout.tsx Fonts

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Update `:root` color variables in `app/globals.css`**

Open `app/globals.css`. Find the `:root { ... }` block inside `@layer base`. Replace only the following variable values (keep all other variables and the Tailwind v4 `@import` / `@theme inline` structure untouched):

```css
    --background: 48 19% 95%;       /* #F4F3EF cream */
    --foreground: 225 21% 7%;       /* #0F1117 ink */
    --card: 0 0% 100%;
    --card-foreground: 225 21% 7%;
    --popover: 0 0% 100%;
    --popover-foreground: 225 21% 7%;
    --primary: 153 59% 25%;         /* #1A6644 forest green */
    --primary-foreground: 0 0% 100%;
    --secondary: 150 33% 94%;       /* #EBF5F0 green-dim */
    --secondary-foreground: 225 21% 7%;
    --muted: 150 33% 94%;
    --muted-foreground: 223 9% 46%; /* #6B7180 */
    --accent: 150 33% 94%;
    --accent-foreground: 225 21% 7%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 45 18% 87%;           /* #E4E1D8 warm border */
    --input: 45 18% 87%;
    --ring: 153 59% 25%;
```

Do NOT touch `--radius`, sidebar variables, the `@theme inline` block, or the `@import` / `@plugin` lines.

- [ ] **Step 2: Update fonts in `app/layout.tsx`**

Open `app/layout.tsx`. The current imports are `DM_Serif_Display`, `Plus_Jakarta_Sans`, `JetBrains_Mono` with variables `--font-serif`, `--font-sans`, `--font-mono`.

Replace the three font imports and their const declarations with:

```typescript
import { Fraunces, DM_Sans, DM_Mono } from "next/font/google";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-mono",
  display: "swap",
});
```

Update the `<html>` className to use the new variable names:
```tsx
<html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${dmMono.variable}`}>
```

Keep `TRPCReactProvider`, `ToastProvider`, `ToastViewport`, and the `metadata` export unchanged.

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "globals|layout" | head -10
```

Expected: no errors.

- [ ] **Step 4: Full TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -30
```

Expected: no new errors introduced by this port.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/layout.tsx
git commit -m "feat(theme): apply forest-green design tokens and update to Fraunces/DM Sans fonts"
```

---

## Environment Variables to Add

After completing all tasks, add these to `.env.local` (they are needed for the new features):

```
LEMONSQUEEZY_CHECKOUT_UUID=<your-ls-variant-uuid>
LEMONSQUEEZY_WEBHOOK_SECRET=<your-ls-webhook-signing-secret>
RESEND_API_KEY=<your-resend-api-key>
```
