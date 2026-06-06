-- Add LOGIN and LOGOUT to AuditAction enum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGIN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGOUT';

-- Make organisationId nullable on AuditLog so audit rows survive org deletion
ALTER TABLE "AuditLog" ALTER COLUMN "organisationId" DROP NOT NULL;
