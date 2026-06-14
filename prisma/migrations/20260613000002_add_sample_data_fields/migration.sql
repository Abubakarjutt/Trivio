ALTER TABLE "Organisation" ADD COLUMN "hasSampleData" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StatementTransaction" ADD COLUMN "isSampleData" BOOLEAN NOT NULL DEFAULT false;
