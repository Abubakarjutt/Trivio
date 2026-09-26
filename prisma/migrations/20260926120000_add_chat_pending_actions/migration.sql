-- AI chat write actions wait here for the user's Approve/Reject.
CREATE TYPE "ChatActionStatus" AS ENUM ('PENDING', 'EXECUTING', 'APPROVED', 'REJECTED', 'FAILED');

CREATE TABLE "ChatPendingAction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "status" "ChatActionStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "summary" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatPendingAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatPendingAction_messageId_idx" ON "ChatPendingAction"("messageId");
CREATE INDEX "ChatPendingAction_conversationId_idx" ON "ChatPendingAction"("conversationId");
CREATE INDEX "ChatPendingAction_organisationId_status_idx" ON "ChatPendingAction"("organisationId", "status");

ALTER TABLE "ChatPendingAction" ADD CONSTRAINT "ChatPendingAction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
