-- A personal-finance transaction can pay into a savings goal.
ALTER TABLE "StatementTransaction" ADD COLUMN "goalId" TEXT;

CREATE INDEX "StatementTransaction_goalId_idx" ON "StatementTransaction"("goalId");

ALTER TABLE "StatementTransaction" ADD CONSTRAINT "StatementTransaction_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
