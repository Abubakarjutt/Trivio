-- Voice input in the AI chat (local speech-to-text).
ALTER TABLE "User" ADD COLUMN "voiceInputEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "voiceModel" TEXT NOT NULL DEFAULT 'small';
ALTER TABLE "User" ADD COLUMN "voiceLanguage" TEXT NOT NULL DEFAULT 'auto';
