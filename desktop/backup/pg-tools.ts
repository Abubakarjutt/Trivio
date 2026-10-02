// Thin wrappers over the Postgres client tools bundled with the embedded
// engine (pg_dump, pg_restore, psql). Everything the backup feature does to the
// database goes through here.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { withEngineLibPath, withSafeLocale, type EmbeddedDbConfig } from "../embedded/embedded-db";

export interface PgConn {
  binDir: string;
  libDir?: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function connFromConfig(cfg: EmbeddedDbConfig): PgConn {
  return {
    binDir: dirname(cfg.postgresBinary),
    libDir: cfg.libDir,
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
  };
}

function tool(conn: PgConn, name: string): string {
  return join(conn.binDir, name + (process.platform === "win32" ? ".exe" : ""));
}

function target(conn: PgConn, db: string): string[] {
  return ["-h", conn.host, "-p", String(conn.port), "-U", conn.user, "-d", db];
}

// Only our own fixed names ever reach SQL; refuse anything else outright.
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`invalid database name: ${name}`);
  return `"${name}"`;
}

export function runPg(conn: PgConn, name: string, args: string[]): Promise<string> {
  const env = withSafeLocale(
    withEngineLibPath({ ...process.env, PGPASSWORD: conn.password, PGCONNECT_TIMEOUT: "10" }, conn.libDir),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(tool(conn, name), args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += String(d)));
    child.stderr.on("data", (d: Buffer) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${name} exited ${code}: ${err.trim()}`)),
    );
  });
}

export async function sql(conn: PgConn, db: string, query: string): Promise<string> {
  const out = await runPg(conn, "psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", ...target(conn, db), "-c", query]);
  return out.trim();
}

export async function dumpDatabase(conn: PgConn, outPath: string): Promise<void> {
  await runPg(conn, "pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "-f", outPath, ...target(conn, conn.database)]);
}

export async function restoreDatabase(conn: PgConn, db: string, dumpPath: string): Promise<void> {
  ident(db);
  await runPg(conn, "pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", ...target(conn, db), dumpPath]);
}

export async function createDatabase(conn: PgConn, name: string): Promise<void> {
  await sql(conn, "postgres", `create database ${ident(name)}`);
}

export async function dropDatabase(conn: PgConn, name: string): Promise<void> {
  await sql(conn, "postgres", `drop database if exists ${ident(name)} with (force)`);
}

// live → previous and incoming → live, both renames in ONE transaction, so a
// crash can never leave the app without a "trivio" database.
export async function swapDatabases(
  conn: PgConn,
  names: { live: string; incoming: string; previous: string },
): Promise<void> {
  const live = ident(names.live);
  const incoming = ident(names.incoming);
  const previous = ident(names.previous);
  await dropDatabase(conn, names.previous);
  await sql(
    conn,
    "postgres",
    `select pg_terminate_backend(pid) from pg_stat_activity
     where datname in ('${names.live}', '${names.incoming}') and pid <> pg_backend_pid()`,
  );
  await runPg(conn, "psql", [
    "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", ...target(conn, "postgres"),
    "-c", `alter database ${live} rename to ${previous}`,
    "-c", `alter database ${incoming} rename to ${live}`,
  ]);
}

// Changes only on data writes (inserts/updates/deletes), not on reads — so the
// backup's own queries don't count as "something changed". stats_reset moves
// if the statistics were ever reset (e.g. after a crash), which errs on the
// side of backing up.
export function dataFingerprint(conn: PgConn): Promise<string> {
  return sql(
    conn,
    conn.database,
    `select coalesce((select stats_reset::text from pg_stat_database where datname = current_database()), 'never')
       || '|' || (select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) from pg_stat_user_tables)`,
  );
}

export async function appliedMigrations(conn: PgConn, db = conn.database): Promise<string[]> {
  const out = await sql(
    conn,
    db,
    "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name",
  );
  return out ? out.split("\n") : [];
}
