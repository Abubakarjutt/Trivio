-- CreateEnum
CREATE TYPE "SmsSourceStatus" AS ENUM ('ACTIVE', 'NO_ACCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "SmsImportStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'DISMISSED', 'FAILED', 'NO_TRANSACTION');

-- AlterEnum
ALTER TYPE "StatementFileType" ADD VALUE 'SMS';

-- CreateTable
CREATE TABLE "SmsSource" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "senderIds" TEXT[],
    "lastRowId" BIGINT,
    "lastSyncedAt" TIMESTAMP(3),
    "status" "SmsSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsImportItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "messageGuid" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "parsedJson" JSONB NOT NULL,
    "status" "SmsImportStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "errorMessage" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsSource_organisationId_key" ON "SmsSource"("organisationId");

-- CreateIndex
CREATE INDEX "SmsImportItem_organisationId_status_idx" ON "SmsImportItem"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SmsImportItem_organisationId_messageGuid_key" ON "SmsImportItem"("organisationId", "messageGuid");

-- AddForeignKey
ALTER TABLE "SmsSource" ADD CONSTRAINT "SmsSource_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsImportItem" ADD CONSTRAINT "SmsImportItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsImportItem" ADD CONSTRAINT "SmsImportItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SmsSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsImportItem" ADD CONSTRAINT "SmsImportItem_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "StatementImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

