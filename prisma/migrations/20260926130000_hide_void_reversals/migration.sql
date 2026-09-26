-- A voided entry's reversal used to stay isVoid=false while the original was
-- flagged isVoid=true, so every report (which skips isVoid rows) counted the
-- voided amount NEGATED. Flag existing reversals too: the pair still sits in
-- the ledger (void, don't delete) and nets to zero; reports now skip both.
-- A reversal is "VOID: <original description>" in the same organisation with
-- the same source, created when the original was voided.
UPDATE "JournalEntry" AS r
SET "isVoid" = true,
    "voidedAt" = COALESCE(r."voidedAt", r."createdAt"),
    "voidReason" = 'Reversal of ' || o."id"
FROM "JournalEntry" AS o
WHERE r."isVoid" = false
  AND o."isVoid" = true
  AND r."organisationId" = o."organisationId"
  AND r."source" = o."source"
  AND r."description" = 'VOID: ' || o."description"
  AND r."id" <> o."id"
  AND r."createdAt" >= o."createdAt";
