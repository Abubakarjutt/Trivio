# GDPR Compliance Reference

Complete inventory of every GDPR control implemented across AutoAccounts and EasyFinance (the "PF module"). Both apps share the same compliance architecture with minor schema differences noted below.

**Policy version in effect:** 2026-06

---

## Implemented GDPR Articles

| Article | Right / Obligation | Status |
|---------|-------------------|--------|
| Art. 5(e) | Storage limitation (data retention) | ✅ |
| Art. 7 | Lawfulness — consent with record | ✅ |
| Art. 13 | Transparency — privacy notice at point of collection | ✅ |
| Art. 16 | Rectification (self-service not yet available; contact-us path) | ⚠️ partial |
| Art. 17 | Erasure — right to be forgotten | ✅ |
| Art. 20 | Portability — machine-readable data export | ✅ |
| Art. 30 | Records of processing — audit log | ✅ |

---

## Controls Inventory

### 1. Privacy Policy (Art. 13)

| Item | AutoAccounts | EasyFinance |
|------|-------------|-------------|
| URL | `/privacy` | `/privacy` |
| Auth required | No | No |
| Linked from register page | Yes | Yes |

Both middleware configs include `/privacy` in `PUBLIC_PREFIXES` so unauthenticated users can read it before registering.

**Files:**
- `middleware.ts` — `PUBLIC_PREFIXES` array
- `app/(marketing)/privacy/page.tsx` (AutoAccounts)
- `app/(auth)/register/page.tsx` — consent checkbox + link

---

### 2. Consent Recording (Art. 7)

Consent is recorded at registration and stored as a timestamped, IP-tagged audit log entry.

**Trigger:** `gdpr.recordConsent` tRPC mutation, called from the register page via `await recordConsent.mutateAsync().catch(() => {})` (awaited to guarantee recording before the user's session is fully established; catch makes it non-blocking on transient failures).

**What's stored:**

| Field | Where | Value |
|-------|-------|-------|
| `User.gdprConsentAt` | User row | Timestamp of consent |
| `AuditLog.action` | AuditLog row | `CREATE` |
| `AuditLog.entityType` | AuditLog row | `GdprConsent` |
| `AuditLog.entityId` | AuditLog row | userId |
| IP address | EasyFinance: `AuditLog.ipAddress` / AutoAccounts: `AuditLog.after.ipAddress` | First IP from `x-forwarded-for` or `x-real-ip` |
| Policy version | EasyFinance: `AuditLog.metadata.policyVersion` / AutoAccounts: `AuditLog.after.policyVersion` | `"2026-06"` |

**Files:**
- `server/routers/gdpr.ts` — `recordConsent` procedure
- `app/(auth)/register/page.tsx` — caller

---

### 3. Data Export / Portability (Art. 20)

Returns a JSON object with all personal and organisational data. Rate-limited to 3 requests per hour per user.

**Endpoint:** `gdpr.exportData` (tRPC mutation, org-scoped)

**AutoAccounts export includes:**
- `user` — id, name, email, role, createdAt, gdprConsentAt
- `organisation` — id, name, currency, createdAt
- `invoices` — id, number, status, totalAmount (string), createdAt (up to 500)
- `bills` — id, number, status, totalAmount (string), createdAt (up to 500)
- `contacts` — id, name, email, type, createdAt
- `journalEntries` — id, description, date, createdAt (up to 500)
- `budgets` — id, name, category, limitAmount (string), period, createdAt
- `chatHistory` — id, role, content, createdAt (up to 1000)
- `exportedAt` — ISO timestamp of the export

**EasyFinance export includes:**
- `user`, `organisation` (same fields)
- `transactions` — statement transactions with amounts as strings
- `budgets` — monthly limit as string
- `chatHistory` — same

Monetary values (`Decimal`) are serialized as strings to avoid float precision loss.

Every export writes an `EXPORT` audit log entry.

**Rate limit:** 3 exports / hour / user (in-memory, per process)

**Files:**
- `server/routers/gdpr.ts` — `exportData` procedure
- `server/middleware/rateLimit.ts` (AutoAccounts) / `server/lib/rateLimit.ts` (EasyFinance) — `exportRateLimiter`
- `app/(app)/settings/_components/privacy-tab.tsx` — "Download my data" button

---

### 4. Right to Erasure (Art. 17)

Deletes or anonymises all personal data for a user and their organisation.

**Endpoint:** `gdpr.deleteAccount` (tRPC mutation, authenticated)

**Identity verification:**
- AutoAccounts: user must type the literal string `"DELETE"` (UI enforces it; server validates `z.literal("DELETE")`)
- EasyFinance: user must type their account email address (server compares case-insensitively against `User.email`)

**Rate limit:** 2 attempts / hour / user

**What happens on deletion:**

1. Audit log written **before** the transaction (survives cascade)
2. Transaction begins:
   - `User.name` → `"Deleted User"`
   - `User.email` → `deleted-{userId}@deleted.invalid`
   - `User.hashedPassword` → `null`
   - `User.image` → `null`
   - If the user is the only member of their org: `Organisation` is deleted (cascades all associated data)
   - `Session` rows for the user are deleted

3. The `AuditLog` row written in step 1 survives with `organisationId = null` (see schema section below).

**Files:**
- `server/routers/gdpr.ts` — `deleteAccount` procedure
- `app/(app)/settings/_components/privacy-tab.tsx` — "Delete Account" card

---

### 5. Audit Log (Art. 30)

Every significant operation creates an immutable audit log entry.

**Schema (AutoAccounts):**
```prisma
model AuditLog {
  id             String        @id @default(cuid())
  organisationId String?                          // nullable — survives org deletion
  organisation   Organisation? @relation(..., onDelete: SetNull)
  userId         String
  user           User          @relation(...)
  action         AuditAction
  entityType     String
  entityId       String?
  before         Json?
  after          Json?
  createdAt      DateTime      @default(now())
}

enum AuditAction {
  CREATE  UPDATE  VOID  DELETE  EXPORT  LOGIN  LOGOUT
}
```

**Schema (EasyFinance):**
```prisma
model AuditLog {
  // same structure, with these differences:
  metadata       Json?        // instead of before/after
  ipAddress      String?      // top-level IP column
  // no VOID in AuditAction enum
}
```

**`organisationId` is nullable.** When an organisation is deleted (Art. 17 erasure), its audit rows are not cascade-deleted — `organisationId` is set to `null` instead. This preserves the deletion audit trail as required for legal accountability.

**Actions logged:**

| Action | Trigger |
|--------|---------|
| `LOGIN` | NextAuth `signIn` event |
| `LOGOUT` | NextAuth `signOut` event |
| `CREATE` | Consent recording (`entityType: "GdprConsent"`) |
| `EXPORT` | Data export (`entityType: "Organisation"`) |
| `DELETE` | Account deletion (`entityType: "Account"`) |
| `DELETE` | Chat purge (`entityType: "ChatMessage"`) |

**writeAuditLog helper:** Fire-and-forget pattern — failures are silently caught so that audit log unavailability never breaks the user's main operation.

**Files:**
- `server/routers/gdpr.ts` — `writeAuditLog` + `auditLog` query procedure
- `lib/auth.ts` — NextAuth `events` block (login/logout)
- `prisma/schema.prisma` — `AuditLog` model + `AuditAction` enum

---

### 6. Automated Data Retention (Art. 5(e))

Chat messages older than 12 months are automatically deleted nightly.

**Endpoint:** `POST /api/cron/purge-chats`

**Authentication:** `x-cron-secret` header must match `CRON_SECRET` env var (returns 401 otherwise).

**What it does:**
1. Computes a cutoff date 365 days in the past
2. Iterates all organisations
3. Deletes `ChatMessage` rows older than the cutoff for each org
4. Writes a `DELETE / ChatMessage` audit log entry per org that had deletions

**Response:**
```json
{
  "ok": true,
  "deleted": 1234,
  "orgs": 42,
  "cutoff": "2025-06-06T02:00:00.000Z"
}
```

**EasyFinance (deployed on Hostinger VPS):** Cron job runs at 02:00 UTC daily:
```
0 2 * * * curl -s -X POST -H "x-cron-secret: $CRON_SECRET" https://app.trivio-ai.com/api/cron/purge-chats >> /var/log/easyfinance-cron.log 2>&1
```

**AutoAccounts:** Route exists at `app/api/cron/purge-chats/route.ts`. Cron job must be configured when AutoAccounts is deployed to a server.

**Files:**
- `app/api/cron/purge-chats/route.ts` — route handler
- `server/routers/gdpr.ts` — `purgeOldChatMessages` procedure (manual trigger, org-scoped)

---

### 7. Rate Limiting

All GDPR-sensitive endpoints are rate-limited using an in-memory token-bucket implementation.

| Limiter | Limit | Window | Endpoint |
|---------|-------|--------|----------|
| `exportRateLimiter` | 3 requests | 1 hour | `gdpr.exportData` |
| `deletionRateLimiter` | 2 requests | 1 hour | `gdpr.deleteAccount` |

**Implementation:** Module-level `Map<string, Bucket>`. Keys are `${userId}:${operation}`. Works correctly in a persistent Node.js process (Docker). Not shared across multiple server instances — use Redis if horizontally scaling.

**On limit exceeded:** Throws `TRPCError({ code: "TOO_MANY_REQUESTS" })` with a message including seconds remaining.

**Files:**
- `server/middleware/rateLimit.ts` (AutoAccounts)
- `server/lib/rateLimit.ts` (EasyFinance)

---

### 8. Password Security

Passwords are hashed with bcrypt at cost factor 12 before storage. Password reset tokens expire after 1 hour (stored in `PasswordResetToken.expires`).

---

## Schema Migrations

| Migration | Repo | Effect |
|-----------|------|--------|
| `20260606_audit_action_login_logout` | AutoAccounts | Adds `LOGIN`, `LOGOUT` to `AuditAction` enum; makes `AuditLog.organisationId` nullable |
| `20260606_audit_log_set_null` | EasyFinance | Makes `AuditLog.organisationId` nullable |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | Yes (when cron is used) | Secret for authenticating `POST /api/cron/purge-chats` |
| `NEXTAUTH_SECRET` | Yes | Used for session signing |

---

## UI Entry Points

| Feature | Location |
|---------|----------|
| Privacy policy | `/privacy` (public) |
| Download my data | Settings → Privacy tab |
| View audit log | Settings → Privacy tab |
| Delete account | Settings → Privacy tab |
