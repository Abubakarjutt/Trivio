-- Add isSampleData flag to core accounting tables so sample data can be
-- selectively cleared when the user enters their first real transaction.

ALTER TABLE "Contact" ADD COLUMN "isSampleData" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN "isSampleData" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Bill" ADD COLUMN "isSampleData" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JournalEntry" ADD COLUMN "isSampleData" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BankAccount" ADD COLUMN "isSampleData" BOOLEAN NOT NULL DEFAULT false;