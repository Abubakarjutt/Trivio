-- DropIndex
DROP INDEX "Organisation_emailImportToken_idx";

-- DropIndex
DROP INDEX "Organisation_emailImportToken_key";

-- AlterTable
ALTER TABLE "Organisation" DROP COLUMN "emailImportToken";

