// Real-Postgres check of the backup/restore database moves, using the engine
// bundled with the desktop app (desktop/embedded/bin, fetched by
// `npm run fetch:pg`). Skipped when that engine isn't on this machine.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startEmbeddedDatabase, type DatabaseHandle } from "../../../desktop/embedded/embedded-db";
import {
  appliedMigrations, connFromConfig, createDatabase, dataFingerprint, dropDatabase, dumpDatabase,
  restoreDatabase, sql, swapDatabases, type PgConn,
} from "../../../desktop/backup/pg-tools";

const embedded = resolve(__dirname, "../../../desktop/embedded");
const hasEngine = existsSync(join(embedded, "bin", process.platform === "win32" ? "initdb.exe" : "initdb"));

describe.skipIf(!hasEngine)("pg-tools against a scratch embedded Postgres", () => {
  let handle: DatabaseHandle;
  let conn: PgConn;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "trivio-pg-"));
    handle = await startEmbeddedDatabase({
      env: { ...process.env, TRIVIO_DB_DIR: join(dir, "db") },
      userDataDir: dir,
      resourcesDir: embedded,
      serverDir: resolve(__dirname, "../../.."),
      ensureMigrated: async () => {},
      log: () => {},
    });
    conn = connFromConfig(handle.config!);
    await createDatabase(conn, "trivio");
    await sql(conn, "trivio", `
      create table _prisma_migrations (migration_name text, finished_at timestamptz, rolled_back_at timestamptz);
      insert into _prisma_migrations values ('20260101000000_init', now(), null), ('20260201000000_two', now(), null);
      create table lines (entry int, debit numeric(19,4), credit numeric(19,4));
      insert into lines values (1, 100.5, 0), (1, 0, 100.5), (2, 42, 0), (2, 0, 42);
    `);
  }, 60_000);

  afterAll(async () => {
    await handle?.stop();
  });

  it("lists applied migrations in order", async () => {
    expect(await appliedMigrations(conn)).toEqual(["20260101000000_init", "20260201000000_two"]);
  });

  it("fingerprint ignores reads and changes on writes", async () => {
    const a = await dataFingerprint(conn);
    await sql(conn, "trivio", "select count(*) from lines");
    expect(await dataFingerprint(conn)).toBe(a);
    await sql(conn, "trivio", "insert into lines values (3, 1, 0), (3, 0, 1)");
    expect(await dataFingerprint(conn)).not.toBe(a);
  });

  it("dump → restore into a side DB → atomic swap brings the old data back, balanced", async () => {
    const dump = join(dir, "db.dump");
    await dumpDatabase(conn, dump);
    const before = await sql(conn, "trivio", "select count(*) from lines");
    await sql(conn, "trivio", "insert into lines values (9, 5, 0), (9, 0, 5)"); // changed after the backup

    await dropDatabase(conn, "trivio_restore");
    await createDatabase(conn, "trivio_restore");
    await restoreDatabase(conn, "trivio_restore", dump);
    await swapDatabases(conn, { live: "trivio", incoming: "trivio_restore", previous: "trivio_before_restore" });

    expect(await sql(conn, "trivio", "select count(*) from lines")).toBe(before);
    expect(
      await sql(conn, "trivio", "select count(*) from (select entry from lines group by entry having sum(debit) <> sum(credit)) x"),
    ).toBe("0");
    // the pre-restore data is kept aside until the next successful backup
    expect(await sql(conn, "trivio_before_restore", "select count(*) from lines where entry = 9")).toBe("2");
  });

  it("a corrupt dump fails pg_restore and leaves the live DB alone", async () => {
    const bad = join(dir, "bad.dump");
    await writeFile(bad, "not a dump");
    const live = await sql(conn, "trivio", "select count(*) from lines");
    await dropDatabase(conn, "trivio_restore");
    await createDatabase(conn, "trivio_restore");
    await expect(restoreDatabase(conn, "trivio_restore", bad)).rejects.toThrow(/pg_restore/);
    await dropDatabase(conn, "trivio_restore");
    expect(await sql(conn, "trivio", "select count(*) from lines")).toBe(live);
  });
});
