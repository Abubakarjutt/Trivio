// Boots a throwaway Postgres for the QA suite through the desktop app's own
// embedded-engine code path (initdb → postgres → prisma migrate deploy), seeds
// reference data, and after the run fails if any tRPC procedure went untested.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";
import { PrismaClient } from "@prisma/client";
import { startEmbeddedDatabase, type DatabaseHandle } from "@/desktop/embedded/embedded-db";
import { seedTaxRegimes } from "@/server/services/tax-regime.service";
import { UNTESTABLE } from "./untestable";

declare module "vitest" {
  export interface ProvidedContext {
    qaDatabaseUrl: string;
    qaCoverageDir: string;
  }
}

const repo = resolve(__dirname, "../..");

export default async function setup(project: TestProject) {
  const work = mkdtempSync(join(tmpdir(), "trivio-qa-"));
  const coverageDir = join(work, "coverage");
  let handle: DatabaseHandle | null = null;
  let url = process.env.QA_DATABASE_URL;

  if (url) {
    execFileSync(join(repo, "node_modules/.bin/prisma"), ["migrate", "reset", "--force", "--skip-seed"], {
      cwd: repo,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
  } else {
    handle = await startEmbeddedDatabase({
      env: {
        ...process.env,
        TRIVIO_DB_DIR: join(work, "pg"),
        // The unix socket path must stay under ~100 chars.
        TRIVIO_DB_SOCKET_DIR: mkdtempSync("/tmp/tqa-"),
      },
      userDataDir: work,
      // resolvePostgresBinaries looks in <resourcesDir>/../embedded/bin
      // (desktop/embedded, from `npm run fetch:pg`), then TRIVIO_PG_BIN,
      // then initdb/postgres on PATH.
      resourcesDir: join(repo, "desktop", "build"),
      serverDir: repo,
      log: () => {},
    });
    url = handle.url;
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await seedTaxRegimes(prisma);
  await prisma.$disconnect();

  project.provide("qaDatabaseUrl", url);
  project.provide("qaCoverageDir", coverageDir);

  return async () => {
    try {
      assertEveryProcedureTested(coverageDir);
    } finally {
      await handle?.stop();
      rmSync(work, { recursive: true, force: true });
    }
  };
}

// Each test file's setup writes { all, covered } (see tests/qa/setup.ts).
function assertEveryProcedureTested(dir: string) {
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return; // a filtered run (single file) — nothing to check
  }
  // Only a full run can prove coverage — skip for `npm run test:qa -- <file>`.
  const suiteFiles = readdirSync(__dirname, { recursive: true }).filter((f) =>
    String(f).endsWith(".qa.test.ts")
  );
  if (files.length < suiteFiles.length) return;
  const all = new Set<string>();
  const covered = new Set<string>();
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
      all: string[];
      covered: string[];
    };
    data.all.forEach((p) => all.add(p));
    data.covered.forEach((p) => covered.add(p));
  }
  const missing = [...all].filter((p) => !covered.has(p) && !(p in UNTESTABLE)).sort();
  if (missing.length > 0) {
    throw new Error(
      `QA coverage: ${missing.length} tRPC procedure(s) have no QA test:\n  ${missing.join("\n  ")}\n` +
        "Add a test under tests/qa/ (or, if it truly can't run locally, list it in tests/qa/untestable.ts with a reason)."
    );
  }
  console.log(`\nQA coverage: all ${all.size} tRPC procedures exercised.`);
}
