-- Web research: the Brave Search key and the research note saved with a prospect.
ALTER TABLE "OutreachSettings" ADD COLUMN "searchApiKey" TEXT;
ALTER TABLE "OutreachProspect" ADD COLUMN "research" TEXT;
