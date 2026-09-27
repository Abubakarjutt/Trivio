-- Personal Finance pay cycles: a "month" runs until the user closes it.
CREATE TABLE "PfCycle" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PfCycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PfCycle_organisationId_startDate_key" ON "PfCycle"("organisationId", "startDate");

ALTER TABLE "PfCycle" ADD CONSTRAINT "PfCycle_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
