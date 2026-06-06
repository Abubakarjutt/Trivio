# GDPR Design Decisions — Why It Works This Way

This document explains the non-obvious architectural choices made during the GDPR compliance implementation. It is for developers who need to maintain, extend, or audit the compliance layer.

---

## The Audit Log Survival Paradox

**The problem:** GDPR Art. 17 requires us to delete a user's data when they invoke the right to erasure. GDPR Art. 30 requires us to maintain records of processing — including deletions. These two requirements conflict: if we delete the organisation and its data in a cascade, we also destroy the audit log entry that proves the deletion happened.

**The solution:** `AuditLog.organisationId` is nullable with `onDelete: SetNull`. The sequence is:

1. Write the deletion audit log entry *before* the transaction begins.
2. Inside the transaction, delete the organisation. The cascade deletes transactions, budgets, chat sessions, etc.
3. Because `AuditLog → Organisation` uses `onDelete: SetNull`, the audit row is *not* deleted — its `organisationId` column is set to `null`.

The audit trail now reads: "on 2026-06-05, user `abc123` deleted their account (GDPR Art. 17 erasure)" — orphaned from the organisation but intact and queryable.

**Why not write the audit log inside the transaction?** If we wrote the audit log inside `db.$transaction()`, it would be cascade-deleted along with the organisation at the moment the transaction commits. Writing it outside (before) means the row exists in the DB before the cascade fires.

**Migration required:** Both repos needed `ALTER TABLE "AuditLog" ALTER COLUMN "organisationId" DROP NOT NULL`. This is a non-breaking migration — no existing rows have null `organisationId`, and null is now a legal value.

---

## Pre-Transaction Audit Write

The pattern used in `deleteAccount`:

```typescript
// Step 1: write audit log (outside any transaction)
await writeAuditLog({ ..., action: "DELETE", ... });

// Step 2: run the destructive transaction
await ctx.db.$transaction(async (tx) => {
  await tx.user.update(...);        // anonymise PII
  await tx.organisation.delete(...)  // cascades all org data
  await tx.session.deleteMany(...);  // kill active sessions
});
```

This is intentional. The audit log write in step 1 commits immediately to the database. If the transaction in step 2 fails and rolls back, the audit log entry remains — recording the *attempt*. This is acceptable: an attempted erasure that failed is still a relevant event for compliance records.

The alternative (write inside the transaction) would mean the audit log rolls back with everything else on failure, leaving no trace. That's worse from a compliance standpoint.

---

## Email Confirmation vs. "DELETE" Text

**AutoAccounts:** User types the literal string `"DELETE"`.

**EasyFinance:** User types their account email address, which the server validates case-insensitively against `User.email` in the database.

**Why the difference?** EasyFinance's confirmation is stronger — it proves the user knows their account email, which adds a second factor of identity beyond the session. This matters when the server-side account state (the email) may differ from what the user remembers (they may have changed their email recently). The mismatch would surface before erasure.

AutoAccounts uses the simpler "DELETE" pattern — sufficient for session-authenticated operations, but does not provide the second-factor email check. Either approach satisfies Art. 17's intent (deliberate, confirmed action), but EasyFinance's is more resistant to session hijacking scenarios.

---

## In-Memory Rate Limiting

Rate limits are enforced using a module-level `Map<string, Bucket>` (a token bucket) rather than a Redis-backed limiter.

**Why in-memory?** AutoAccounts already uses Redis for BullMQ queues, so Redis is available. However, the GDPR operations (export, delete) are individually low-frequency — at most a handful of calls per user per day. Adding a Redis dependency for these two endpoints would increase operational complexity with negligible benefit.

**Trade-off:** In-memory rate limits are *per process*. In a horizontally scaled deployment (multiple Next.js instances behind a load balancer), each instance maintains its own counter. A determined user could bypass the limit by hitting different instances. For the current single-instance deployment on both apps, this is not a concern.

**When to revisit:** If either app scales to multiple Node.js processes behind a load balancer, switch `exportRateLimiter` and `deletionRateLimiter` to use `ioredis` with `INCR`/`EXPIRE` commands for cross-process consistency.

---

## Login/Logout Audit Events

Login and logout events are captured via NextAuth's `events` callbacks in `lib/auth.ts`, not in the tRPC layer.

**Why NextAuth events and not tRPC?** The login endpoint is not a tRPC procedure — it is handled by NextAuth's internal `signIn` flow. There is no tRPC hook available. NextAuth exposes a structured `events` object for this purpose.

**The signOut difference:** The `signOut` event receives the raw JWT token object (for JWT strategy), not the session. User ID must be extracted from `token.id` with a type guard:

```typescript
async signOut(message) {
  const userId = ("token" in message ? message.token?.id : undefined) as string | undefined;
```

This is a NextAuth v5 quirk — the `signOut` message type is a union of session and token shapes depending on the session strategy configured.

**Fire-and-forget:** Both handlers use `await writeAuditLog(...)` but the `writeAuditLog` function itself swallows errors. A database write failure during login audit will not prevent the user from logging in.

---

## Consent Awaited, Not Fire-and-Forget

The consent mutation on the register page is called with `await` and a `.catch()`:

```typescript
await recordConsent.mutateAsync().catch(() => {
  // non-blocking — consent can be re-recorded from support if needed
});
```

**Why await?** The previous implementation used `void recordConsent.mutate()` — fire and forget. If the mutation call failed (network issue, transient DB error), the user would be signed in with no consent recorded. The app would have no legal basis for processing their data under Art. 7.

**Why `.catch()`?** The `await` ensures the mutation completes before the register flow proceeds. The `.catch()` ensures that a transient consent-recording failure does not block the user from finishing registration — they are still created, and support can re-trigger consent recording if needed.

**The trade-off:** A user who registers during a DB outage may have a missing `gdprConsentAt`. This is a known risk, acceptable because the consent checkbox UI still documents their intent, and the re-trigger path is available via support tooling.

---

## Automated Chat Purge — Cron vs. Scheduled Job

Chat messages are purged via a `POST /api/cron/purge-chats` HTTP endpoint rather than a BullMQ scheduled job (AutoAccounts) or a database-level scheduled procedure.

**Why HTTP cron?** Both apps need to run on different infrastructure (EasyFinance on Hostinger VPS; AutoAccounts not yet deployed). An HTTP endpoint is infrastructure-agnostic — any scheduler (OS cron, GitHub Actions, Cron-job.org, EasyCron) can trigger it with a simple `curl` call. BullMQ scheduled jobs would require the BullMQ worker process to be running continuously, adding operational overhead.

**Security:** The endpoint is authenticated by a shared secret in the `x-cron-secret` header. The `CRON_SECRET` env var must be set before the cron job is configured. Any request without the correct secret returns 401.

**Audit trail per org:** The purge writes one audit log entry per organisation where messages were deleted, attributing the deletion to the first user found in that org. This gives compliance officers a per-org retention-enforcement record.

---

## Schema Differences Between Apps

The two apps diverged slightly in their AuditLog schema:

| Aspect | AutoAccounts | EasyFinance |
|--------|-------------|-------------|
| Payload columns | `before Json?`, `after Json?` | `metadata Json?`, `ipAddress String?` |
| AuditAction values | `CREATE UPDATE VOID DELETE EXPORT LOGIN LOGOUT` | `CREATE UPDATE DELETE EXPORT LOGIN LOGOUT` |
| `writeAuditLog` signature | Takes `db: PrismaClient` as first param | Uses module-level `db` |

**Why the difference?** AutoAccounts was built first with a more generic double-entry bookkeeping audit model (`before`/`after` state snapshots). EasyFinance was built later as a simplified PF module and used a flatter `metadata` field. The divergence was intentional — each app records what's meaningful for its domain — rather than an oversight.

**Implication for cross-repo changes:** When adding new audit log events, the field names differ. AutoAccounts uses `after: { ... }`. EasyFinance uses `metadata: { ... }`. The session summary in CLAUDE.md tracks this mapping.
