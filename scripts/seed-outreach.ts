/**
 * Seed Outreach for one organisation from the Python app's seller.md.
 *
 * Run: npx tsx scripts/seed-outreach.ts --org <organisationId> --seller ../linkedin-outreach/seller.md
 * Without --org it lists the organisations so you can pick one.
 * Uses DATABASE_URL from .env / .env.local. Safe to run more than once.
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { seedOutreach } from "../server/services/outreach/seed";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = new PrismaClient();
  try {
    const orgId = arg("org");
    if (!orgId) {
      const orgs = await db.organisation.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      console.log("Pass --org <id>. Organisations:");
      for (const o of orgs) console.log(`  ${o.id}  ${o.name}`);
      process.exitCode = 1;
      return;
    }
    const seller = arg("seller");
    if (!seller) throw new Error("Pass --seller <path to seller.md>.");
    const org = await db.organisation.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    });
    if (!org) throw new Error(`No organisation with id ${orgId}.`);
    const md = fs.readFileSync(path.resolve(seller), "utf8");
    const result = await seedOutreach(db, org.id, md, new Date());
    console.log(
      `Outreach for ${org.name}: settings ${result.settings}, ` +
        `${result.offersCreated} offer(s) and ${result.examplesCreated} voice example(s) added.`
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
