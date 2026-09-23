// Runs once per Next.js server process boot (Node.js runtime only — this
// hook also fires for the edge runtime, which has no Prisma access).
//
// The desktop app's embedded Postgres cluster is created fresh per install
// (see desktop/embedded/embedded-db.ts): `prisma migrate deploy` creates the
// schema, but nothing seeds it. TaxRegime is reference data the onboarding
// flow depends on (app/onboarding/page.tsx fetches it via
// trpc.org.getTaxRegimes), not per-organisation demo data, so it can't wait
// for an organisation to exist — it must be present before onboarding even
// renders. Seeding it here, on every boot, keeps it in sync for hosted/dev
// deployments too and is idempotent (upsert keyed on the regime's code).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { db } = await import("@/lib/db");
  const { seedTaxRegimes } = await import("@/server/services/tax-regime.service");

  try {
    await seedTaxRegimes(db);
  } catch (err) {
    console.error("[instrumentation] failed to seed tax regimes:", err);
  }
}
