-- GDPR compliance: gdprConsentAt on User + EXPORT action on AuditAction enum

ALTER TABLE "User" ADD COLUMN "gdprConsentAt" TIMESTAMP(3);

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXPORT';
