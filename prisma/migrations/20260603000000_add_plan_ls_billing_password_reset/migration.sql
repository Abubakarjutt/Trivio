-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "LsSubscriptionStatus" AS ENUM ('active', 'cancelled', 'past_due', 'expired');

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN "plan" "Plan" NOT NULL DEFAULT 'FREE',
ADD COLUMN "lsCustomerId" TEXT,
ADD COLUMN "lsSubscriptionId" TEXT,
ADD COLUMN "lsSubscriptionStatus" "LsSubscriptionStatus";

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_lsSubscriptionId_key" ON "Organisation"("lsSubscriptionId");

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_email_idx" ON "PasswordResetToken"("email");
