-- Add MANUAL to StatementFileType enum, so a manually-added transaction has a
-- batch to belong to (StatementTransaction.importBatchId is required).
ALTER TYPE "StatementFileType" ADD VALUE IF NOT EXISTS 'MANUAL';
