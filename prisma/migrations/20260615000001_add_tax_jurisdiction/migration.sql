-- AddColumn
ALTER TABLE "Organisation" ADD COLUMN IF NOT EXISTS "taxJurisdiction" TEXT;
