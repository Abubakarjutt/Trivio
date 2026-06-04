-- AlterEnum
ALTER TYPE "LsSubscriptionStatus" ADD VALUE 'paused';

-- AlterTable
ALTER TABLE "PasswordResetToken" ALTER COLUMN "token" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Organisation_lsCustomerId_idx" ON "Organisation"("lsCustomerId");
