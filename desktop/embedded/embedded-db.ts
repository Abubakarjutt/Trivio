// Trivio desktop — embedded PostgreSQL engine.
//
// The Trivio schema uses NUMERIC(19,4) for every monetary value (a hard
// invariant — money is never stored as a float) plus Postgres-specific enum
// columns, so the app cannot swap in SQLite. Instead of asking the user to run
// Postgres in a separate process or a docker container, the desktop app ships
// and runs its OWN PostgreSQL inside the user's data directory:
//
//     <userData>/database   ←  PGDATA (the on-disk cluster)
//
// On first boot the cluster is created with `initdb`; on every boot the
// `postgres` server is started on a private loopback port and `prisma migrate
// deploy` applies any pending migrations (idempotent — a no-op when up to
// date). On quit the engine is stopped cleanly. The database is therefore part
// of the app, not an external service.
//
// Precedence (highest wins):
//   TRIVIO_DATABASE_MODE=external|embedded  forces a side
//   TRIVIO_DATABASE_URL                       an explicit external pointer
//   otherwise                                 EMBEDDED — the desktop default
//
// A bare DATABASE_URL alone does NOT select external: the desktop ships its own
// Postgres (see fetch-postgres.mjs), so a placeholder/legacy DATABASE_URL — e.g.
// the one in the shared .env.example — must not silently bypass the built-in
// engine and force a docker/external dependency. To use an external database,
// set TRIVIO_DATABASE_MODE=external (or TRIVIO_DATABASE_URL). No engine is
// started in that case, so the same server code runs unchanged.
//
// The heavy lifting (initdb / postgres / migrate) is a thin adapter around
// child_process.spawn. Every *decision* is a pure function so the whole module
// can be unit-tested without a real engine, a socket, or a GUI.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import net from "node:net";

// ── Types ────────────────────────────────────────────────────────────────────

export type DatabaseMode = "embedded" | "external";

// A fully-resolved description of the embedded cluster to (re)start.
export interface EmbeddedDbConfig {
  dataDir: string; // PGDATA on disk
  host: string; // loopback bind host (127.0.0.1)
  port: number; // chosen TCP port
  user: string; // superuser name
  password: string; // superuser password (loopback-only; trust auth)
  database: string; // database name
  initdbBinary: string; // path to the `initdb` executable
  postgresBinary: string; // path to the `postgres` executable
  libDir?: string; // shared-library dir (libpq/libicu etc.) next to bin/, if present
  unixSocketDir: string; // where the unix-domain socket lives
}

// A located engine: the two executables plus an optional shared-library dir.
export interface PostgresBinaries {
  initdb: string;
  postgres: string;
  libDir?: string;
}

// The running engine, plus how to tear it down.
export interface DatabaseHandle {
  mode: DatabaseMode;
  url: string;
  host: string;
  port: number;
  dataDir: string;
  stop: () => Promise<void>;
}

// ── Pure decisions (unit-tested directly) ─────────────────────────────────────

// Decide whether to run an embedded engine or use an external database.
//
//   TRIVIO_DATABASE_MODE=external|embedded  forces a side (highest priority)
//   TRIVIO_DATABASE_URL                      → external (a deliberate pointer)
//   otherwise → embedded (the desktop default; a bare DATABASE_URL is ignored so
//                       a placeholder URL can't bypass the built-in engine)
export function decideDatabaseMode(env: NodeJS.ProcessEnv): DatabaseMode {
  const forced = (env.TRIVIO_DATABASE_MODE || "").trim().toLowerCase();
  if (forced === "external") return "external";
  if (forced === "embedded") return "embedded";
  // Only a *deliberate* external pointer selects external. A bare DATABASE_URL
  // (commonly a leftover/placeholder) must not bypass the built-in engine.
  if (env.TRIVIO_DATABASE_URL) return "external";
  return "embedded";
}

// Where the on-disk cluster lives. Overridable via TRIVIO_DB_DIR (tests /
// power users); otherwise under the Electron userData dir so it survives app
// updates and is isolated per user.
export function resolveDataDir(env: NodeJS.ProcessEnv, userDataDir: string): string {
  if (env.TRIVIO_DB_DIR) return env.TRIVIO_DB_DIR;
  return join(userDataDir, "database");
}

// The Prisma DATABASE_URL for the embedded engine.
export function buildDatabaseUrl(
  cfg: Pick<EmbeddedDbConfig, "host" | "port" | "user" | "password" | "database">
): string {
  const user = encodeURIComponent(cfg.user);
  const pw = cfg.password ? `:${encodeURIComponent(cfg.password)}` : "";
  return `postgresql://${user}${pw}@${cfg.host}:${cfg.port}/${cfg.database}`;
}

// Assemble a config from the environment + chosen port + resolved binaries.
export function buildConfig(
  env: NodeJS.ProcessEnv,
  opts: { userDataDir: string; port: number; binaries: PostgresBinaries }
): EmbeddedDbConfig {
  const dataDir = resolveDataDir(env, opts.userDataDir);
  return {
    dataDir,
    host: env.TRIVIO_DB_HOST || "127.0.0.1",
    port: opts.port,
    user: env.TRIVIO_DB_USER || "trivio",
    password: env.TRIVIO_DB_PASSWORD || "trivio",
    database: env.TRIVIO_DB_NAME || "trivio",
    initdbBinary: opts.binaries.initdb,
    postgresBinary: opts.binaries.postgres,
    libDir: opts.binaries.libDir,
    unixSocketDir: env.TRIVIO_DB_SOCKET_DIR || join(dataDir, "sockets"),
  };
}

// `initdb` args: a UTF8 / C-locale cluster with trust auth on loopback. Trust
// auth is safe here because the server is bound to 127.0.0.1 only and is a
// single-user local install — there is no off-machine network surface.
export function renderInitdbArgs(cfg: EmbeddedDbConfig): string[] {
  return [
    "--username",
    cfg.user,
    "--auth-local",
    "trust",
    "--auth-host",
    "trust",
    "--encoding",
    "UTF8",
    "--locale",
    "C",
    "--no-locale",
    cfg.dataDir,
  ];
}

// `postgres` server args: bind loopback only, keep the unix socket in a
// dedicated dir (not PGDATA), and cap connections for a single-user install.
export function renderServerArgs(
  cfg: EmbeddedDbConfig,
  platform: NodeJS.Platform = process.platform
): string[] {
  const args = [
    "-D",
    cfg.dataDir,
    "-c",
    `listen_addresses=${cfg.host}`,
    "-p",
    String(cfg.port),
    "-c",
    "max_connections=100",
  ];
  // Windows has no unix-domain sockets; Prisma connects over TCP regardless,
  // so the -k socket flag is only meaningful on POSIX.
  if (platform !== "win32") args.push("-k", cfg.unixSocketDir);
  return args;
}

// Locate the `initdb` + `postgres` executables. Resolution order:
//   1. TRIVIO_PG_BIN        — a directory containing initdb + postgres (dev/override)
//   2. <resources>/postgres/bin — the engine bundled with the app by the build step
//   3. <resources>/../embedded/bin — a project-local engine (dev convenience)
//   4. the system PATH       — only when allowPathFallback (i.e. unpackaged/dev)
//
// A packaged app (isPackaged) must NOT fall back to a mismatched system engine,
// so when allowPathFallback is false and nothing is found we return null and the
// caller loud-fails with guidance instead of starting the wrong binary.
export function resolvePostgresBinaries(
  env: NodeJS.ProcessEnv,
  resourcesDir: string,
  exists: (p: string) => boolean = existsSync,
  allowPathFallback = false,
  platform: NodeJS.Platform = process.platform
): PostgresBinaries | null {
  // Windows executables carry a .exe suffix; the EDB Windows engine is
  // self-contained (DLLs live in bin/, no sibling lib/ dir to locate).
  const exe = platform === "win32" ? ".exe" : "";
  const dirs = [
    env.TRIVIO_PG_BIN || "",
    join(resourcesDir, "postgres", "bin"),
    join(resourcesDir, "..", "embedded", "bin"),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const initdb = join(dir, "initdb" + exe);
    if (exists(initdb)) {
      const libDir = exe ? undefined : join(dir, "..", "lib");
      return {
        initdb,
        postgres: join(dir, "postgres" + exe),
        libDir: libDir && exists(libDir) ? libDir : undefined,
      };
    }
  }
  if (allowPathFallback) return { initdb: "initdb" + exe, postgres: "postgres" + exe };
  return null;
}

// Locate the command to run `prisma migrate deploy`. Resolution order:
//   1. TRIVIO_PRISMA_BIN   — explicit (dev/test)
//   2. <serverDir>/node_modules/.bin/prisma — the CLI shipped with the app
//   3. <serverDir>/node_modules/prisma/build/index.js — the package entry, run
//      with the current node runtime (ELECTRON_RUN_AS_NODE in a packaged app)
//   4. `npx prisma`        — dev convenience (needs network on first use)
export interface MigrateCommand {
  cmd: string;
  args: string[];
  cwd: string;
}
export function resolveMigrateCommand(
  env: NodeJS.ProcessEnv,
  serverDir: string,
  execPath = process.execPath,
  exists: (p: string) => boolean = existsSync
): MigrateCommand {
  if (env.TRIVIO_PRISMA_BIN) {
    return { cmd: env.TRIVIO_PRISMA_BIN, args: ["migrate", "deploy"], cwd: serverDir };
  }
  const binPrisma = join(serverDir, "node_modules", ".bin", "prisma");
  if (exists(binPrisma)) return { cmd: binPrisma, args: ["migrate", "deploy"], cwd: serverDir };
  const pkgEntry = join(serverDir, "node_modules", "prisma", "build", "index.js");
  if (exists(pkgEntry))
    return { cmd: execPath, args: [pkgEntry, "migrate", "deploy"], cwd: serverDir };
  return { cmd: "npx", args: ["prisma", "migrate", "deploy"], cwd: serverDir };
}

// A copied/portable engine (an EDB "binaries" tarball, a Homebrew keg copy, …)
// loads its shared libraries from a sibling `lib/` dir. EDB macOS binaries carry
// an `@executable_path/../lib` rpath so this is belt-and-suspenders there; on
// Linux the dynamic loader needs LD_LIBRARY_PATH to find libpq/libicu. Windows
// engines are self-contained, so no loader env is needed. Pure + injectable.
export function withEngineLibPath(
  env: NodeJS.ProcessEnv,
  libDir: string | undefined,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  if (!libDir || platform === "win32") return env;
  const key = platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
  const prev = env[key];
  return { ...env, [key]: prev ? `${libDir}:${prev}` : libDir };
}

// ── Injectable helpers ────────────────────────────────────────────────────────

// Pick a free loopback TCP port.
export function pickPort(host = "127.0.0.1"): Promise<number> {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.once("error", rej);
    srv.listen(0, host, () => {
      const addr = srv.address();
      srv.close(() => res(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
}

// Wait until the engine accepts a TCP connection on its port (or time out).
export function waitForPort(host: string, port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, host, () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`timed out waiting for embedded Postgres on ${host}:${port}`));
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => resolve({ code }));
    child.on("error", (err) => reject(err));
  });
}

// ── Engine lifecycle (thin adapters around spawn; injectable for tests) ────────

export interface StartEmbeddedOptions {
  env: NodeJS.ProcessEnv;
  userDataDir: string;
  resourcesDir: string;
  serverDir: string;
  isPackaged?: boolean;
  // injectable
  spawnImpl?: typeof spawn;
  existsSyncImpl?: typeof existsSync;
  mkdirSyncImpl?: typeof mkdirSync;
  pickPortImpl?: () => Promise<number>;
  waitForReady?: (host: string, port: number, timeoutMs?: number) => Promise<void>;
  ensureMigrated?: (
    cfg: EmbeddedDbConfig,
    serverDir: string,
    env: NodeJS.ProcessEnv
  ) => Promise<void>;
  log?: (msg: string) => void;
}

// Start (initialising + migrating) an embedded engine and return a handle.
export async function startEmbeddedDatabase(opts: StartEmbeddedOptions): Promise<DatabaseHandle> {
  const spawnImpl = opts.spawnImpl ?? spawn;
  const exists = opts.existsSyncImpl ?? existsSync;
  const mkdir = opts.mkdirSyncImpl ?? mkdirSync;
  const log = opts.log ?? ((m: string) => console.log(m));

  const binaries = resolvePostgresBinaries(
    opts.env,
    opts.resourcesDir,
    exists,
    opts.isPackaged !== true
  );
  if (!binaries) {
    throw new Error(
      "No embedded Postgres engine was found. Set TRIVIO_PG_BIN to a directory containing " +
        "`initdb` + `postgres`, run `npm run fetch:pg` to bundle the engine, or point " +
        "DATABASE_URL at an external database."
    );
  }

  const port = await (opts.pickPortImpl ?? pickPort)();
  const cfg = buildConfig(opts.env, { userDataDir: opts.userDataDir, port, binaries });
  mkdir(cfg.dataDir, { recursive: true });
  mkdir(cfg.unixSocketDir, { recursive: true });

  // A portable engine finds its shared libs via a sibling lib/ dir; surface it to
  // the loader so a copied EDB/keg engine runs even without a baked-in rpath.
  const childEnv = withEngineLibPath(opts.env, cfg.libDir);

  // 1. Create the cluster on first run. PG_VERSION marks an initialised data dir.
  if (!exists(join(cfg.dataDir, "PG_VERSION"))) {
    log(`[db] initialising embedded Postgres data dir at ${cfg.dataDir}`);
    const init = spawnImpl(cfg.initdbBinary, renderInitdbArgs(cfg), {
      stdio: "pipe",
      env: childEnv,
    });
    const { code } = await waitForExit(init);
    if (code !== 0) {
      throw new Error(`initdb failed (exit ${code}); data dir: ${cfg.dataDir}`);
    }
  }

  // 2. Start the server.
  log(`[db] starting embedded Postgres on ${cfg.host}:${cfg.port}`);
  const server = spawnImpl(cfg.postgresBinary, renderServerArgs(cfg), {
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
  });
  server.stdout?.on("data", (d: Buffer) => log(`[db:out] ${String(d).trimEnd()}`));
  server.stderr?.on("data", (d: Buffer) => log(`[db:err] ${String(d).trimEnd()}`));

  // 3. Wait for it to accept connections.
  await (opts.waitForReady ?? waitForPort)(cfg.host, cfg.port, 30000);

  // 4. Apply migrations (idempotent — a no-op when the schema is current).
  const runMigrate: (
    cfg: EmbeddedDbConfig,
    serverDir: string,
    env: NodeJS.ProcessEnv
  ) => Promise<void> = opts.ensureMigrated ?? ensureMigrated;
  await runMigrate(cfg, opts.serverDir, opts.env);

  return {
    mode: "embedded",
    url: buildDatabaseUrl(cfg),
    host: cfg.host,
    port: cfg.port,
    dataDir: cfg.dataDir,
    stop: () => stopDatabaseProcess(server, log),
  };
}

// Apply the Prisma migration ledger to the (fresh) embedded cluster.
export async function ensureMigrated(
  cfg: EmbeddedDbConfig,
  serverDir: string,
  env: NodeJS.ProcessEnv,
  spawnImpl: typeof spawn = spawn,
  exists: (p: string) => boolean = existsSync,
  log: (m: string) => void = (m) => console.log(m)
): Promise<void> {
  const cmd = resolveMigrateCommand(env, serverDir, process.execPath, exists);
  const url = buildDatabaseUrl(cfg);
  const childEnv = { ...withEngineLibPath(env, cfg.libDir), DATABASE_URL: url };
  log(`[db] applying migrations: ${cmd.cmd} ${cmd.args.join(" ")} (DATABASE_URL=${url})`);
  const child = spawnImpl(cmd.cmd, cmd.args, { cwd: cmd.cwd, env: childEnv, stdio: "pipe" });
  const { code } = await waitForExit(child);
  if (code !== 0) {
    throw new Error(`prisma migrate deploy failed (exit ${code}) for ${url}`);
  }
}

// Stop a running engine: SIGTERM, then SIGKILL as a backstop. Idempotent.
export function stopDatabaseProcess(
  server: ChildProcess | null | undefined,
  log: (m: string) => void = () => {}
): Promise<void> {
  if (!server || server.killed) return Promise.resolve();
  log("[db] stopping embedded Postgres");
  server.kill("SIGTERM");
  return new Promise((resolve) => {
    const kill = setTimeout(() => {
      if (!server.killed) server.kill("SIGKILL");
      resolve();
    }, 10000);
    server.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
  });
}
