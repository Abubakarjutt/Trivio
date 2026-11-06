-- CreateEnum
CREATE TYPE "CategoryRuleKind" AS ENUM ('COUNTERPARTY', 'MERCHANT');

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "counterpartySecret" TEXT;

-- AlterTable
ALTER TABLE "SmsImportItem" ADD COLUMN     "notificationClosedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StatementTransaction" ADD COLUMN     "needsCategory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ruleKind" "CategoryRuleKind",
ADD COLUMN     "ruleLabel" TEXT,
ADD COLUMN     "ruleMatchKey" TEXT;

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "CategoryRuleKind" NOT NULL,
    "matchKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryRule_organisationId_idx" ON "CategoryRule"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRule_organisationId_kind_matchKey_key" ON "CategoryRule"("organisationId", "kind", "matchKey");

-- CreateIndex
CREATE INDEX "StatementTransaction_organisationId_needsCategory_idx" ON "StatementTransaction"("organisationId", "needsCategory");

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing SMS should not all pop up as new notifications.
UPDATE "SmsImportItem" SET "notificationClosedAt" = NOW() WHERE "notificationClosedAt" IS NULL;
