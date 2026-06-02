-- AlterEnum
ALTER TYPE "StatementFileType" ADD VALUE 'EMAIL';

-- AlterTable: add column as nullable first to allow backfill of existing rows
ALTER TABLE "Organisation" ADD COLUMN "emailImportToken" TEXT;

-- Backfill existing rows with unique tokens
UPDATE "Organisation" SET "emailImportToken" = replace(gen_random_uuid()::text, '-', '') WHERE "emailImportToken" IS NULL;

-- Enforce NOT NULL now that all rows are populated
ALTER TABLE "Organisation" ALTER COLUMN "emailImportToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_emailImportToken_key" ON "Organisation"("emailImportToken");

-- CreateIndex
CREATE INDEX "Organisation_emailImportToken_idx" ON "Organisation"("emailImportToken");
