-- CreateEnum
CREATE TYPE "OutreachStage" AS ENUM ('QUEUED', 'REQUEST_SENT', 'CONNECTED', 'VALUE_SENT', 'ENGAGED', 'TEARDOWN', 'PILOT', 'WON', 'LOST', 'NURTURE', 'DNC');

-- CreateEnum
CREATE TYPE "OutreachDraftKind" AS ENUM ('CONNECTION_NOTE', 'VALUE_MESSAGE', 'REPLY');

-- CreateEnum
CREATE TYPE "OutreachDocKind" AS ENUM ('TEARDOWN_PREP', 'PROPOSAL');

-- CreateTable
CREATE TABLE "OutreachSettings" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sellerProfile" TEXT NOT NULL,
    "signalWeights" JSONB NOT NULL,
    "dailyCap" INTEGER NOT NULL DEFAULT 20,
    "weeklyCap" INTEGER NOT NULL DEFAULT 100,
    "cadence" JSONB NOT NULL,
    "hiringKeywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachOffer" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" DECIMAL(19,4),
    "fittingSignals" TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachProspect" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "companyWebsite" TEXT,
    "companySize" TEXT,
    "location" TEXT,
    "profileText" TEXT NOT NULL,
    "stack" TEXT[],
    "signals" JSONB NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "primarySignal" TEXT,
    "scoreReasons" TEXT[],
    "enrichmentStatus" TEXT NOT NULL,
    "stage" "OutreachStage" NOT NULL DEFAULT 'QUEUED',
    "stageChangedAt" TIMESTAMP(3) NOT NULL,
    "unansweredCount" INTEGER NOT NULL DEFAULT 0,
    "lightTouchDone" BOOLEAN NOT NULL DEFAULT false,
    "awaitingReply" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "lastTouchAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "crmLeadId" TEXT,
    "crmDealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "prospectId" TEXT,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDraft" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "kind" "OutreachDraftKind" NOT NULL,
    "variant" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "violations" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachConversation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "thread" TEXT NOT NULL,
    "analysis" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDoc" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "kind" "OutreachDocKind" NOT NULL,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachVoiceExample" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "prospectId" TEXT,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachVoiceExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachDnc" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "OutreachDnc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutreachSettings_organisationId_key" ON "OutreachSettings"("organisationId");

-- CreateIndex
CREATE INDEX "OutreachOffer_organisationId_idx" ON "OutreachOffer"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachProspect_crmLeadId_key" ON "OutreachProspect"("crmLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachProspect_crmDealId_key" ON "OutreachProspect"("crmDealId");

-- CreateIndex
CREATE INDEX "OutreachProspect_organisationId_stage_idx" ON "OutreachProspect"("organisationId", "stage");

-- CreateIndex
CREATE INDEX "OutreachProspect_organisationId_score_idx" ON "OutreachProspect"("organisationId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachProspect_organisationId_profileUrl_key" ON "OutreachProspect"("organisationId", "profileUrl");

-- CreateIndex
CREATE INDEX "OutreachEvent_organisationId_kind_at_idx" ON "OutreachEvent"("organisationId", "kind", "at");

-- CreateIndex
CREATE INDEX "OutreachEvent_prospectId_idx" ON "OutreachEvent"("prospectId");

-- CreateIndex
CREATE INDEX "OutreachDraft_organisationId_prospectId_kind_idx" ON "OutreachDraft"("organisationId", "prospectId", "kind");

-- CreateIndex
CREATE INDEX "OutreachConversation_organisationId_prospectId_idx" ON "OutreachConversation"("organisationId", "prospectId");

-- CreateIndex
CREATE INDEX "OutreachDoc_organisationId_idx" ON "OutreachDoc"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDoc_prospectId_kind_key" ON "OutreachDoc"("prospectId", "kind");

-- CreateIndex
CREATE INDEX "OutreachVoiceExample_organisationId_createdAt_idx" ON "OutreachVoiceExample"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDnc_organisationId_profileUrl_key" ON "OutreachDnc"("organisationId", "profileUrl");

-- AddForeignKey
ALTER TABLE "OutreachSettings" ADD CONSTRAINT "OutreachSettings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachOffer" ADD CONSTRAINT "OutreachOffer_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachProspect" ADD CONSTRAINT "OutreachProspect_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachProspect" ADD CONSTRAINT "OutreachProspect_crmLeadId_fkey" FOREIGN KEY ("crmLeadId") REFERENCES "CrmLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachProspect" ADD CONSTRAINT "OutreachProspect_crmDealId_fkey" FOREIGN KEY ("crmDealId") REFERENCES "CrmDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "OutreachProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDraft" ADD CONSTRAINT "OutreachDraft_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "OutreachProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachConversation" ADD CONSTRAINT "OutreachConversation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachConversation" ADD CONSTRAINT "OutreachConversation_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "OutreachProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDoc" ADD CONSTRAINT "OutreachDoc_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDoc" ADD CONSTRAINT "OutreachDoc_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "OutreachProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachVoiceExample" ADD CONSTRAINT "OutreachVoiceExample_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachVoiceExample" ADD CONSTRAINT "OutreachVoiceExample_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "OutreachProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachDnc" ADD CONSTRAINT "OutreachDnc_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

