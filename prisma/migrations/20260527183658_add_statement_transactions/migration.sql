/*
  Warnings:

  - You are about to drop the `WebhookEvent` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "StatementFileType" AS ENUM ('PDF', 'CSV');

-- CreateEnum
CREATE TYPE "StatementImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "StatementTransactionType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "CrmLeadSource" AS ENUM ('WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'COLD_OUTREACH', 'EVENT', 'ADVERTISING', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmCompanySize" AS ENUM ('SOLO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'NOTE', 'TASK');

-- AlterTable
ALTER TABLE "Goal" ALTER COLUMN "targetDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "RecurringItem" ALTER COLUMN "type" DROP DEFAULT,
ALTER COLUMN "nextDueDate" SET DATA TYPE DATE;

-- DropTable
DROP TABLE "WebhookEvent";

-- CreateTable
CREATE TABLE "StatementImportBatch" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileType" "StatementFileType" NOT NULL,
    "status" "StatementImportStatus" NOT NULL DEFAULT 'PENDING',
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementTransaction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "type" "StatementTransactionType" NOT NULL,
    "category" TEXT NOT NULL,
    "mccCode" TEXT NOT NULL,
    "mccLabel" TEXT NOT NULL,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatementTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "companyName" TEXT,
    "jobTitle" TEXT,
    "estimatedValue" DECIMAL(19,4),
    "source" "CrmLeadSource" NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "tags" TEXT[],
    "convertedAt" TIMESTAMP(3),
    "convertedContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmCompany" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "size" "CrmCompanySize" NOT NULL DEFAULT 'SMALL',
    "tags" TEXT[],
    "notes" TEXT,
    "linkedContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPipeline" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPipelineStage" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmPipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDeal" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "contactId" TEXT NOT NULL,
    "crmCompanyId" TEXT,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "expectedCloseDate" DATE,
    "probability" INTEGER NOT NULL DEFAULT 50,
    "source" TEXT,
    "wonLostReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "contactId" TEXT,
    "dealId" TEXT,
    "crmCompanyId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatementImportBatch_organisationId_idx" ON "StatementImportBatch"("organisationId");

-- CreateIndex
CREATE INDEX "StatementTransaction_organisationId_idx" ON "StatementTransaction"("organisationId");

-- CreateIndex
CREATE INDEX "StatementTransaction_importBatchId_idx" ON "StatementTransaction"("importBatchId");

-- CreateIndex
CREATE INDEX "StatementTransaction_organisationId_date_idx" ON "StatementTransaction"("organisationId", "date");

-- CreateIndex
CREATE INDEX "StatementTransaction_organisationId_category_idx" ON "StatementTransaction"("organisationId", "category");

-- CreateIndex
CREATE INDEX "CrmLead_organisationId_status_idx" ON "CrmLead"("organisationId", "status");

-- CreateIndex
CREATE INDEX "CrmLead_organisationId_source_idx" ON "CrmLead"("organisationId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCompany_linkedContactId_key" ON "CrmCompany"("linkedContactId");

-- CreateIndex
CREATE INDEX "CrmCompany_organisationId_idx" ON "CrmCompany"("organisationId");

-- CreateIndex
CREATE INDEX "CrmPipeline_organisationId_idx" ON "CrmPipeline"("organisationId");

-- CreateIndex
CREATE INDEX "CrmPipelineStage_pipelineId_order_idx" ON "CrmPipelineStage"("pipelineId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CrmDeal_invoiceId_key" ON "CrmDeal"("invoiceId");

-- CreateIndex
CREATE INDEX "CrmDeal_organisationId_stageId_idx" ON "CrmDeal"("organisationId", "stageId");

-- CreateIndex
CREATE INDEX "CrmDeal_organisationId_pipelineId_idx" ON "CrmDeal"("organisationId", "pipelineId");

-- CreateIndex
CREATE INDEX "CrmActivity_organisationId_contactId_idx" ON "CrmActivity"("organisationId", "contactId");

-- CreateIndex
CREATE INDEX "CrmActivity_organisationId_dealId_idx" ON "CrmActivity"("organisationId", "dealId");

-- CreateIndex
CREATE INDEX "CrmActivity_organisationId_dueDate_idx" ON "CrmActivity"("organisationId", "dueDate");

-- AddForeignKey
ALTER TABLE "StatementImportBatch" ADD CONSTRAINT "StatementImportBatch_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementTransaction" ADD CONSTRAINT "StatementTransaction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementTransaction" ADD CONSTRAINT "StatementTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "StatementImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_convertedContactId_fkey" FOREIGN KEY ("convertedContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_linkedContactId_fkey" FOREIGN KEY ("linkedContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPipeline" ADD CONSTRAINT "CrmPipeline_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPipelineStage" ADD CONSTRAINT "CrmPipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "CrmPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_crmCompanyId_fkey" FOREIGN KEY ("crmCompanyId") REFERENCES "CrmCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "CrmPipeline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CrmPipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDeal" ADD CONSTRAINT "CrmDeal_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_crmCompanyId_fkey" FOREIGN KEY ("crmCompanyId") REFERENCES "CrmCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
