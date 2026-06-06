# How to Operate the GDPR Compliance Layer

Operator guide for verifying, maintaining, and extending GDPR compliance on AutoAccounts and EasyFinance. Assumes familiarity with the codebase and database access.

---

## How to Set Up the Automated Chat Purge Cron

The `POST /api/cron/purge-chats` route exists in both apps and must be triggered externally by a scheduler.

### Prerequisites

- The app is deployed and reachable over HTTPS
- `CRON_SECRET` env var is set in the deployment environment

### Steps

1. Choose a value for `CRON_SECRET` if not already set (generate a random 64-char hex string):

   ```bash
   openssl rand -hex 32
   ```

2. Add it to the deployment env (`.env.prod` or your hosting platform's env config):

   ```
   CRON_SECRET=<your-secret-here>
   ```

3. Add the cron job to the server (for VPS/Linux deployments, edit crontab):

   ```bash
   crontab -e
   ```

   Add this line (runs at 02:00 UTC daily):

   ```
   0 2 * * * curl -s -X POST -H "x-cron-secret: YOUR_CRON_SECRET" https://your-domain.com/api/cron/purge-chats >> /var/log/app-cron.log 2>&1
   ```

4. Test the route manually before relying on the cron:

   ```bash
   curl -s -X POST \
     -H "x-cron-secret: YOUR_CRON_SECRET" \
     https://your-domain.com/api/cron/purge-chats | jq .
   ```

### Verification

A successful response looks like:

```json
{
  "ok": true,
  "deleted": 0,
  "orgs": 3,
  "cutoff": "2025-06-06T02:00:00.000Z"
}
```

- `ok: true` — authenticated and ran without error
- `deleted: 0` — no messages older than 365 days (expected on first run)
- `orgs` — number of organisations scanned

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `{"error":"Unauthorized"}` (401) | Wrong or missing `x-cron-secret` | Check `CRON_SECRET` env var matches the header value |
| `curl: (6) Could not resolve host` | Wrong domain | Verify the URL and that the app is running |
| Response hangs | App is down or overloaded | Check app health logs |

---

## How to Verify a User's Consent Record

Use this to confirm that consent was recorded correctly for a specific user — useful when responding to a subject access request or investigating a missing `gdprConsentAt`.

### Steps

1. Look up the user in the database:

   ```sql
   SELECT id, email, "gdprConsentAt"
   FROM "User"
   WHERE email = 'user@example.com';
   ```

2. Check the audit log for their consent event:

   ```sql
   SELECT id, "organisationId", "userId", action, "entityType", metadata, "ipAddress", "createdAt"
   FROM "AuditLog"
   WHERE "userId" = '<user-id>'
     AND "entityType" = 'GdprConsent'
   ORDER BY "createdAt" DESC
   LIMIT 5;
   ```

   For AutoAccounts (which uses `after` instead of `metadata`):

   ```sql
   SELECT id, "organisationId", "userId", action, "entityType", after, "createdAt"
   FROM "AuditLog"
   WHERE "userId" = '<user-id>'
     AND "entityType" = 'GdprConsent'
   ORDER BY "createdAt" DESC
   LIMIT 5;
   ```

3. The `metadata` / `after` column should contain:

   ```json
   {
     "consentAt": "2026-06-05T14:23:00.000Z",
     "policyVersion": "2026-06",
     "ipAddress": "203.0.113.1"
   }
   ```

### If the consent record is missing

The user registered during a transient DB error, or before the consent recording was added. To re-record:

1. Trigger `gdpr.recordConsent` via tRPC from the server side, or
2. Manually backfill `User.gdprConsentAt` and insert an `AuditLog` row with a note explaining the backfill.

---

## How to Process a Subject Access Request (SAR)

A subject access request (Art. 15) requires you to provide a user with all data you hold about them.

### Steps

1. Instruct the user to use the self-service export in Settings → Privacy → "Download my data". This produces a complete JSON export instantly.

2. If the user cannot access their account:
   - Verify identity via email confirmation
   - Run the export manually via tRPC or direct DB queries using the tables listed in [`gdpr-reference.md`](./gdpr-reference.md) under "Data Export"

3. Respond within 30 days (GDPR Art. 12 requirement).

4. The data export automatically writes an `EXPORT` audit log entry. If you export manually, add an audit log entry manually.

---

## How to Process a Right to Erasure Request (Art. 17)

### Self-service (preferred)

Instruct the user to go to Settings → Privacy → "Delete Account". The UI walks them through the confirmation and performs the erasure.

### Manual erasure (if user cannot access their account)

1. Write the audit log entry **first** (before any deletion):

   ```sql
   INSERT INTO "AuditLog" ("id", "organisationId", "userId", "action", "entityType", "entityId", "after", "createdAt")
   VALUES (
     gen_random_uuid(),
     '<org-id>',
     '<user-id>',
     'DELETE',
     'Account',
     '<user-id>',
     '{"reason": "GDPR Art. 17 erasure — manual, per support ticket #XXXX"}',
     NOW()
   );
   ```

   For EasyFinance (uses `metadata` column):

   ```sql
   INSERT INTO "AuditLog" ("id", "organisationId", "userId", "action", "entityType", "entityId", "metadata", "createdAt")
   VALUES (
     gen_random_uuid(),
     '<org-id>',
     '<user-id>',
     'DELETE',
     'Account',
     '<user-id>',
     '{"reason": "GDPR Art. 17 erasure — manual, per support ticket #XXXX"}',
     NOW()
   );
   ```

2. Anonymise the user row:

   ```sql
   UPDATE "User"
   SET
     name = 'Deleted User',
     email = 'deleted-' || id || '@deleted.invalid',
     "hashedPassword" = NULL,
     image = NULL
   WHERE id = '<user-id>';
   ```

3. If the user is the only member of their organisation, delete the organisation:

   ```sql
   -- Verify they're the only user
   SELECT COUNT(*) FROM "User" WHERE "organisationId" = '<org-id>';

   -- If count = 1, delete the org (cascades all org data)
   DELETE FROM "Organisation" WHERE id = '<org-id>';
   ```

4. Delete active sessions:

   ```sql
   DELETE FROM "Session" WHERE "userId" = '<user-id>';
   ```

### Verification

After erasure, confirm the audit log entry survived:

```sql
SELECT id, "organisationId", action, "entityType", "createdAt"
FROM "AuditLog"
WHERE "userId" = '<user-id>'
  AND action = 'DELETE'
  AND "entityType" = 'Account';
```

The `organisationId` column should be `null` (set by the cascade `SetNull` rule).

---

## How to Read the Audit Log

The audit log is viewable in the app UI at Settings → Privacy → "Recent Activity" (shows last 50 events). For deeper queries, use SQL directly.

### Useful queries

**Last 20 events for a user:**

```sql
SELECT action, "entityType", "entityId", metadata, "createdAt"
FROM "AuditLog"
WHERE "userId" = '<user-id>'
ORDER BY "createdAt" DESC
LIMIT 20;
```

**All deletion events (for DPA reporting):**

```sql
SELECT u.email, al.action, al."entityType", al."entityId", al."createdAt"
FROM "AuditLog" al
LEFT JOIN "User" u ON al."userId" = u.id
WHERE al.action = 'DELETE'
  AND al."entityType" = 'Account'
ORDER BY al."createdAt" DESC;
```

**Orphaned audit rows (accounts that were deleted):**

```sql
SELECT id, "userId", action, "entityType", "createdAt"
FROM "AuditLog"
WHERE "organisationId" IS NULL
ORDER BY "createdAt" DESC;
```

These orphaned rows are expected — they belong to users whose organisations were erased under Art. 17. Do not delete them.

---

## How to Extend the Audit Log

To add a new audit event type in AutoAccounts:

1. Add the value to the `AuditAction` enum in `prisma/schema.prisma`:

   ```prisma
   enum AuditAction {
     CREATE  UPDATE  VOID  DELETE  EXPORT  LOGIN  LOGOUT
     MY_NEW_ACTION  // add here
   }
   ```

2. Create a migration:

   ```bash
   npx prisma migrate dev --name add_audit_action_my_new_action
   ```

   Or write a manual migration if you need `IF NOT EXISTS`:

   ```sql
   ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MY_NEW_ACTION';
   ```

3. Update the `writeAuditLog` type signature in `server/routers/gdpr.ts`:

   ```typescript
   action: "CREATE" | "UPDATE" | "VOID" | "DELETE" | "EXPORT" | "LOGIN" | "LOGOUT" | "MY_NEW_ACTION";
   ```

4. Call `writeAuditLog` at the appropriate site.

For EasyFinance, repeat steps 1-2 in the EasyFinance repo (no `VOID` in the enum; use `metadata` instead of `after`).

---

## How to Rotate the CRON_SECRET

1. Generate a new secret:

   ```bash
   openssl rand -hex 32
   ```

2. Update the env var in the deployment environment.

3. Restart the app so the new value is picked up from `process.env.CRON_SECRET`.

4. Update the crontab entry on the server to use the new secret:

   ```bash
   crontab -e
   ```

5. Test with the new secret before removing the old crontab entry.

There is no rotation window required — the old cron job will simply 401 until the crontab is updated, which is safe (no data is lost, the next successful run will catch up on any deletion backlog).
