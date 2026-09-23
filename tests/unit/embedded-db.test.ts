// Unit tests for the embedded Postgres engine lifecycle.
//
// Every *decision* in desktop/embedded/embedded-db.ts is a pure function, so the
// whole engine can be exercised without a real Postgres binary, a socket, or a
// GUI — we inject fakes for spawn / fs / port-picking / readiness / migration.
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  decideDatabaseMode,
  resolveDataDir,
  buildDatabaseUrl,
  buildConfig,
  renderInitdbArgs,
  renderServerArgs,
  resolvePostgresBinaries,
  resolveMigrateCommand,
  ensureMigrated,
  withEngineLibPath,
  startEmbeddedDatabase,
  stopDatabaseProcess,
  type EmbeddedDbConfig,
  type PostgresBinaries,
} from "../../desktop/embedded/embedded-db";

// A minimal stand-in for node's ChildProcess that records calls and can be
// "killed" on demand.
function fakeChild() {
  const ee = new EventEmitter();
  const child = Object.assign(ee, {
    killed: false,
    kill: vi.fn((sig?: string | number) => {
      child.killed = true;
      return true;
    }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  return child as any;
}

function baseConfig(overrides: Partial<EmbeddedDbConfig> = {}): EmbeddedDbConfig {
  return {
    dataDir: "/tmp/pgdata",
    host: "127.0.0.1",
    port: 5432,
    user: "trivio",
    password: "trivio",
    database: "trivio",
    initdbBinary: "/bin/initdb",
    postgresBinary: "/bin/postgres",
    unixSocketDir: "/tmp/pgdata/sockets",
    ...overrides,
  };
}

describe("decideDatabaseMode", () => {
  it("defaults to embedded when nothing is set", () => {
    expect(decideDatabaseMode({})).toBe("embedded");
  });

  it("TRIVIO_DATABASE_MODE wins (case/whitespace tolerant)", () => {
    expect(decideDatabaseMode({ TRIVIO_DATABASE_MODE: "  External  " })).toBe("external");
    expect(decideDatabaseMode({ TRIVIO_DATABASE_MODE: "EMBEDDED" })).toBe("embedded");
  });

  it("a bare DATABASE_URL does NOT force external — the embedded engine is the default", () => {
    expect(decideDatabaseMode({ DATABASE_URL: "postgres://x" })).toBe("embedded");
    expect(decideDatabaseMode({ TEST_DATABASE_URL: "postgres://x" })).toBe("embedded");
  });

  it("an explicit TRIVIO_DATABASE_URL forces external (a deliberate pointer)", () => {
    expect(decideDatabaseMode({ TRIVIO_DATABASE_URL: "postgres://x" })).toBe("external");
  });

  it("TRIVIO_DATABASE_MODE=external honours a bare DATABASE_URL", () => {
    expect(
      decideDatabaseMode({ DATABASE_URL: "postgres://x", TRIVIO_DATABASE_MODE: "external" })
    ).toBe("external");
  });

  it("TRIVIO_DATABASE_MODE=embedded wins even when a URL is present", () => {
    expect(
      decideDatabaseMode({ DATABASE_URL: "postgres://x", TRIVIO_DATABASE_MODE: "embedded" })
    ).toBe("embedded");
  });
});

describe("resolveDataDir", () => {
  it("honours TRIVIO_DB_DIR", () => {
    expect(resolveDataDir({ TRIVIO_DB_DIR: "/custom/path" }, "/userdata")).toBe("/custom/path");
  });

  it("defaults under the userData dir", () => {
    expect(resolveDataDir({}, "/userdata")).toMatch(/\/database$/);
  });
});

describe("buildDatabaseUrl", () => {
  it("builds a connection string with a password", () => {
    const url = buildDatabaseUrl({
      host: "127.0.0.1",
      port: 6543,
      user: "trivio",
      password: "p@ss w0rd",
      database: "trivio",
    });
    expect(url).toBe("postgresql://trivio:p%40ss%20w0rd@127.0.0.1:6543/trivio");
  });

  it("omits the password segment when empty", () => {
    const url = buildDatabaseUrl({
      host: "127.0.0.1",
      port: 1,
      user: "u",
      password: "",
      database: "d",
    });
    expect(url).toBe("postgresql://u@127.0.0.1:1/d");
  });
});

describe("buildConfig", () => {
  it("applies sensible defaults", () => {
    const cfg = buildConfig(
      {},
      { userDataDir: "/userdata", port: 5432, binaries: { initdb: "i", postgres: "p" } }
    );
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.user).toBe("trivio");
    expect(cfg.password).toBe("trivio");
    expect(cfg.database).toBe("trivio");
    expect(cfg.dataDir).toBe("/userdata/database");
    expect(cfg.unixSocketDir).toBe("/userdata/database/sockets");
  });

  it("honours env overrides", () => {
    const cfg = buildConfig(
      {
        TRIVIO_DB_HOST: "0.0.0.0",
        TRIVIO_DB_USER: "root",
        TRIVIO_DB_PASSWORD: "x",
        TRIVIO_DB_NAME: "db",
        TRIVIO_DB_DIR: "/data",
      },
      { userDataDir: "/userdata", port: 7, binaries: { initdb: "i", postgres: "p" } }
    );
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.user).toBe("root");
    expect(cfg.password).toBe("x");
    expect(cfg.database).toBe("db");
    expect(cfg.dataDir).toBe("/data");
  });

  it("threads the engine libDir through to the config", () => {
    const binaries: PostgresBinaries = { initdb: "i", postgres: "p", libDir: "/eng/lib" };
    const cfg = buildConfig({}, { userDataDir: "/u", port: 1, binaries });
    expect(cfg.libDir).toBe("/eng/lib");
  });
});

describe("renderInitdbArgs", () => {
  it("creates a UTF8 / C-locale, trust-auth cluster in the data dir", () => {
    const args = renderInitdbArgs(baseConfig());
    expect(args).toContain("--username");
    expect(args).toContain("trivio");
    expect(args).toContain("--auth-local");
    expect(args[args.indexOf("--auth-local") + 1]).toBe("trust");
    expect(args).toContain("--auth-host");
    expect(args[args.indexOf("--auth-host") + 1]).toBe("trust");
    expect(args).toContain("--encoding");
    expect(args).toContain("UTF8");
    expect(args).toContain("--locale");
    expect(args[args.indexOf("--locale") + 1]).toBe("C");
    expect(args).toContain("--no-locale");
    expect(args).toContain("/tmp/pgdata");
  });

  it("omits -L when no shareDir was resolved", () => {
    const args = renderInitdbArgs(baseConfig());
    expect(args).not.toContain("-L");
  });

  // Regression: a Homebrew-built initdb hardcodes the ABSOLUTE path to its
  // "share" data dir (postgres.bki, timezone data, …) at compile time. That
  // path only exists on a machine with that exact Homebrew formula installed
  // -- on any other machine (i.e. every real user's Mac), initdb fails with
  // "initdb failed (exit 1)" and no further detail unless told explicitly
  // where to find its input files via -L.
  it("passes -L <shareDir> when a shareDir was resolved, so initdb does not depend on its compiled-in absolute path", () => {
    const args = renderInitdbArgs(baseConfig({ shareDir: "/app/postgres/share/postgresql@16" }));
    expect(args).toContain("-L");
    expect(args[args.indexOf("-L") + 1]).toBe("/app/postgres/share/postgresql@16");
  });
});

describe("renderServerArgs", () => {
  it("binds loopback, keeps the socket out of PGDATA, caps connections", () => {
    const args = renderServerArgs(baseConfig({ port: 6543, unixSocketDir: "/tmp/sock" }));
    expect(args[args.indexOf("-D") + 1]).toBe("/tmp/pgdata");
    expect(args).toContain(`listen_addresses=127.0.0.1`);
    expect(args[args.indexOf("-p") + 1]).toBe("6543");
    expect(args).toContain("max_connections=100");
    expect(args[args.indexOf("-k") + 1]).toBe("/tmp/sock");
  });
  it("omits the -k unix-socket flag on Windows (no unix sockets)", () => {
    const args = renderServerArgs(baseConfig({ port: 6543, unixSocketDir: "/tmp/sock" }), "win32");
    expect(args).not.toContain("-k");
    expect(args).not.toContain("/tmp/sock");
  });

  it("keeps the -k socket flag on POSIX (linux/darwin)", () => {
    const args = renderServerArgs(baseConfig({ port: 6543, unixSocketDir: "/tmp/sock" }), "linux");
    expect(args[args.indexOf("-k") + 1]).toBe("/tmp/sock");
  });
});

describe("resolvePostgresBinaries", () => {
  const fakeExists = (present: string[]) => (p: string) => present.includes(p);

  it("prefers TRIVIO_PG_BIN and finds the sibling lib/", () => {
    const res = resolvePostgresBinaries(
      { TRIVIO_PG_BIN: "/data/pg/bin" },
      "/res",
      fakeExists(["/data/pg/bin/initdb", "/data/pg/lib"])
    );
    expect(res?.initdb).toBe("/data/pg/bin/initdb");
    expect(res?.libDir).toBe("/data/pg/lib");
  });

  it("falls back to the bundled engine under resourcesDir/postgres/bin", () => {
    const res = resolvePostgresBinaries({}, "/res", fakeExists(["/res/postgres/bin/initdb"]));
    expect(res?.initdb).toContain("postgres/bin/initdb");
  });

  it("returns null when packaged and no engine is found (no PATH fallback)", () => {
    expect(resolvePostgresBinaries({}, "/res", fakeExists([]), false)).toBeNull();
  });

  it("allows a PATH fallback when unpackaged/dev", () => {
    const res = resolvePostgresBinaries({}, "/res", fakeExists([]), true);
    expect(res).toEqual({ initdb: "initdb", postgres: "postgres", libDir: undefined });
  });
  it("resolves the .exe engine and no libDir on Windows", () => {
    const res = resolvePostgresBinaries(
      { TRIVIO_PG_BIN: "/data/pg/bin" },
      "/res",
      fakeExists(["/data/pg/bin/initdb.exe"]),
      false,
      "win32"
    );
    expect(res?.initdb).toContain("initdb.exe");
    expect(res?.postgres).toContain("postgres.exe");
    expect(res?.libDir).toBeUndefined();
  });

  it("yields .exe names for the PATH fallback on Windows", () => {
    const res = resolvePostgresBinaries({}, "/res", fakeExists([]), true, "win32");
    expect(res).toEqual({ initdb: "initdb.exe", postgres: "postgres.exe", libDir: undefined });
  });

  // Regression for "initdb failed (exit 1)" on a real (non-Homebrew-dev) Mac:
  // fetch-postgres.mjs now ships Postgres's "share" data dir as a sibling of
  // bin/. A Homebrew-sourced engine nests it one level further under a
  // version-qualified name (share/postgresql@16) -- that exact nesting is
  // preserved because it's what lets the *running* postgres server (no CLI
  // flag available to it, unlike initdb's -L) find it via Postgres's own
  // relative-path relocation.
  it("resolves shareDir from a Homebrew-style versioned share/postgresql@16 sibling", () => {
    const res = resolvePostgresBinaries(
      { TRIVIO_PG_BIN: "/data/pg/bin" },
      "/res",
      fakeExists(["/data/pg/bin/initdb", "/data/pg/lib", "/data/pg/share"]),
      false,
      "darwin",
      (p) => (p === "/data/pg/share" ? ["postgresql@16"] : [])
    );
    expect(res?.shareDir).toBe("/data/pg/share/postgresql@16");
  });

  it("resolves shareDir directly from share/ when it holds the input files flat (portable/EDB archives)", () => {
    const res = resolvePostgresBinaries(
      { TRIVIO_PG_BIN: "/data/pg/bin" },
      "/res",
      fakeExists(["/data/pg/bin/initdb", "/data/pg/share"]),
      false,
      "darwin",
      (p) => (p === "/data/pg/share" ? ["postgres.bki", "errcodes.txt"] : [])
    );
    expect(res?.shareDir).toBe("/data/pg/share");
  });

  it("leaves shareDir undefined when no share/ sibling exists", () => {
    const res = resolvePostgresBinaries(
      { TRIVIO_PG_BIN: "/data/pg/bin" },
      "/res",
      fakeExists(["/data/pg/bin/initdb"])
    );
    expect(res?.shareDir).toBeUndefined();
  });
});

describe("resolveMigrateCommand", () => {
  it("honours TRIVIO_PRISMA_BIN", () => {
    const cmd = resolveMigrateCommand(
      { TRIVIO_PRISMA_BIN: "/prisma" },
      "/srv",
      "node",
      () => false
    );
    expect(cmd).toEqual({ cmd: "/prisma", args: ["migrate", "deploy"], cwd: "/srv" });
  });

  it("prefers the bundled .bin/prisma", () => {
    const cmd = resolveMigrateCommand({}, "/srv", "node", (p) => p.includes(".bin/prisma"));
    expect(cmd.cmd).toContain(".bin/prisma");
    expect(cmd.args).toEqual(["migrate", "deploy"]);
  });

  it("runs the package entry with the current node runtime", () => {
    const cmd = resolveMigrateCommand({}, "/srv", "/node/bin", (p) =>
      p.includes("prisma/build/index.js")
    );
    expect(cmd.cmd).toBe("/node/bin");
    expect(cmd.args[0]).toContain("prisma/build/index.js");
  });

  it("falls back to npx prisma", () => {
    const cmd = resolveMigrateCommand({}, "/srv", "node", () => false);
    expect(cmd).toEqual({ cmd: "npx", args: ["prisma", "migrate", "deploy"], cwd: "/srv" });
  });
});

describe("ensureMigrated", () => {
  const cfg = buildConfig(
    {},
    { userDataDir: "/userdata", port: 5432, binaries: { initdb: "i", postgres: "p" } }
  );

  it("sets ELECTRON_RUN_AS_NODE when running the bundled package entry with the current executable, so a packaged Electron binary runs the script instead of relaunching its own GUI", async () => {
    let capturedEnv: any;
    const spawnImpl: any = (_cmd: string, _args: string[], opts: any) => {
      capturedEnv = opts.env;
      const child = fakeChild();
      process.nextTick(() => child.emit("exit", 0));
      return child;
    };
    // Only the package-entry path (prisma/build/index.js) exists -- no
    // .bin/prisma -- so resolveMigrateCommand picks the execPath fallback.
    const exists = (p: string) => p.includes("prisma/build/index.js");
    await ensureMigrated(cfg, "/srv", {}, spawnImpl, exists);
    expect(capturedEnv.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("does not set ELECTRON_RUN_AS_NODE when a bundled .bin/prisma is used directly", async () => {
    let capturedEnv: any;
    const spawnImpl: any = (_cmd: string, _args: string[], opts: any) => {
      capturedEnv = opts.env;
      const child = fakeChild();
      process.nextTick(() => child.emit("exit", 0));
      return child;
    };
    const exists = (p: string) => p.includes(".bin/prisma");
    await ensureMigrated(cfg, "/srv", {}, spawnImpl, exists);
    expect(capturedEnv.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("does not set ELECTRON_RUN_AS_NODE when falling back to npx", async () => {
    let capturedEnv: any;
    const spawnImpl: any = (_cmd: string, _args: string[], opts: any) => {
      capturedEnv = opts.env;
      const child = fakeChild();
      process.nextTick(() => child.emit("exit", 0));
      return child;
    };
    await ensureMigrated(cfg, "/srv", {}, spawnImpl, () => false);
    expect(capturedEnv.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("surfaces the migrate process's own captured output on failure, instead of a bare exit code", async () => {
    const spawnImpl: any = () => {
      const child = fakeChild();
      process.nextTick(() => {
        child.stderr.emit("data", Buffer.from("Error: Cannot find module '@prisma/debug'\n"));
        child.emit("exit", 1);
      });
      return child;
    };
    await expect(ensureMigrated(cfg, "/srv", {}, spawnImpl, () => false)).rejects.toThrow(
      /Cannot find module '@prisma\/debug'/
    );
  });
});

describe("withEngineLibPath", () => {
  it("sets DYLD_LIBRARY_PATH on darwin, prepending to any existing value", () => {
    const env = withEngineLibPath({ DYLD_LIBRARY_PATH: "/old" }, "/eng/lib", "darwin");
    expect(env.DYLD_LIBRARY_PATH).toBe("/eng/lib:/old");
  });

  it("sets LD_LIBRARY_PATH on linux", () => {
    const env = withEngineLibPath({}, "/eng/lib", "linux");
    expect(env.LD_LIBRARY_PATH).toBe("/eng/lib");
    expect(env.DYLD_LIBRARY_PATH).toBeUndefined();
  });

  it("leaves Windows and missing-libDir envs untouched", () => {
    expect(withEngineLibPath({}, "/eng/lib", "win32")).toEqual({});
    expect(withEngineLibPath({}, undefined, "darwin")).toEqual({});
  });
});

describe("stopDatabaseProcess", () => {
  it("is a no-op for a null/already-killed server", async () => {
    await expect(stopDatabaseProcess(null)).resolves.toBeUndefined();
    const killed = fakeChild();
    killed.killed = true;
    await expect(stopDatabaseProcess(killed)).resolves.toBeUndefined();
  });

  it("SIGTERMs and resolves on exit", async () => {
    const child = fakeChild();
    const p = stopDatabaseProcess(child, () => {});
    child.kill.mock.calls.length; // touch
    child.emit("exit");
    await p;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("startEmbeddedDatabase", () => {
  const opts = (over: Partial<Parameters<typeof startEmbeddedDatabase>[0]> = {}) => ({
    env: {} as NodeJS.ProcessEnv,
    userDataDir: "/userdata",
    resourcesDir: "/res",
    serverDir: "/srv",
    ...over,
  });

  it("throws when no engine can be located in a packaged app", async () => {
    const call = startEmbeddedDatabase(
      opts({
        isPackaged: true,
        existsSyncImpl: () => false,
        pickPortImpl: async () => 5432,
        waitForReady: async () => {},
        ensureMigrated: async () => {},
      })
    );
    await expect(call).rejects.toThrow(/No embedded Postgres engine/);
  });

  it("runs initdb on first boot, then starts + migrates, and returns a handle", async () => {
    const children: any[] = [];
    const spawnImpl: any = (_c: string, _a: string[], _o: any) => {
      const child = fakeChild();
      children.push(child);
      if (children.length === 1) {
        // initdb exits 0.
        process.nextTick(() => child.emit("exit", 0));
      } else {
        // the server "shuts down" on stop() so it resolves on its own "exit"
        // event instead of the 10s SIGKILL backstop.
        child.kill = vi.fn((sig: string | number) => {
          child.killed = true;
          process.nextTick(() => child.emit("exit", 0));
          return true;
        });
      }
      return child;
    };
    const handle = await startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: (p: string) => !p.endsWith("PG_VERSION"), // first run → initdb runs
        mkdirSyncImpl: () => {},
        pickPortImpl: async () => 6543,
        waitForReady: async () => {},
        ensureMigrated: async () => {},
        log: () => {},
      })
    );
    expect(handle.mode).toBe("embedded");
    expect(handle.port).toBe(6543);
    expect(handle.url).toContain("127.0.0.1:6543");
    expect(handle.url).toContain("/trivio");
    // initdb then postgres → two children spawned.
    expect(children).toHaveLength(2);
    await handle.stop();
    expect(children[1].kill).toHaveBeenCalled();
  });

  // Regression: initdb's stdout/stderr were spawned with stdio:"pipe" but
  // never read, so a real failure only ever surfaced as the bare
  // "initdb failed (exit 1)" wrapper -- exactly what the user saw, with no
  // way to diagnose it without re-running the build manually. initdb's own
  // output (e.g. the "could not access file ..." error a missing share dir
  // produces) must reach the thrown Error so it reaches the user-facing
  // dialog (desktop/main.ts renders err.message verbatim).
  it("includes initdb's captured stderr in the thrown error on failure", async () => {
    const spawnImpl: any = (_c: string, _a: string[], _o: any) => {
      const child = fakeChild();
      process.nextTick(() => {
        child.stderr.emit(
          "data",
          Buffer.from('could not access file "postgres.bki": No such file')
        );
        child.emit("exit", 1);
      });
      return child;
    };
    const call = startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: () => false, // first run -> initdb runs
        mkdirSyncImpl: () => {},
        pickPortImpl: async () => 5432,
        waitForReady: async () => {},
        ensureMigrated: async () => {},
        log: () => {},
      })
    );
    await expect(call).rejects.toThrow(/initdb failed \(exit 1\)/);
    await expect(call).rejects.toThrow(/could not access file "postgres\.bki"/);
  });

  it("skips initdb when the cluster already exists", async () => {
    const children: any[] = [];
    const spawnImpl: any = (_c: string, _a: string[], _o: any) => {
      const child = fakeChild();
      children.push(child);
      return child;
    };
    await startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: (p: string) => p.endsWith("PG_VERSION"), // already initialised
        mkdirSyncImpl: () => {},
        pickPortImpl: async () => 5432,
        waitForReady: async () => {},
        ensureMigrated: async () => {},
        log: () => {},
      })
    );
    // Only the server was spawned (no initdb).
    expect(children).toHaveLength(1);
  });

  // Regression for "initdb: error: directory ... exists but is not empty":
  // a previous initdb run (an earlier buggy build, a crash, disk full, …)
  // can die partway through, leaving PGDATA non-empty but without the
  // PG_VERSION marker initdb only writes on success. Since that directory is
  // exclusively owned by this engine, it must be safe to clear stale
  // contents and retry rather than fail forever.
  it("clears a stale/partial data dir (non-empty, no PG_VERSION) before running initdb", async () => {
    const children: any[] = [];
    const spawnImpl: any = (_c: string, _a: string[], _o: any) => {
      const child = fakeChild();
      children.push(child);
      if (children.length === 1) process.nextTick(() => child.emit("exit", 0));
      return child;
    };
    const rmSyncImpl = vi.fn();
    await startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: (p: string) => !p.endsWith("PG_VERSION"), // dir exists, no marker
        mkdirSyncImpl: () => {},
        rmSyncImpl,
        readdirSyncImpl: () => ["base", "global", "postmaster.pid"] as any, // stale leftovers
        pickPortImpl: async () => 5432,
        waitForReady: async () => {},
        ensureMigrated: async () => {},
        log: () => {},
      })
    );
    expect(rmSyncImpl).toHaveBeenCalledWith(
      expect.stringContaining("database"),
      expect.objectContaining({ recursive: true, force: true })
    );
    // initdb still runs afterward (against the now-cleared dir), then the server.
    expect(children).toHaveLength(2);
  });

  it("does NOT clear the data dir when it is empty (nothing stale to remove)", async () => {
    const children: any[] = [];
    const spawnImpl: any = (_c: string, _a: string[], _o: any) => {
      const child = fakeChild();
      children.push(child);
      if (children.length === 1) process.nextTick(() => child.emit("exit", 0));
      return child;
    };
    const rmSyncImpl = vi.fn();
    await startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: (p: string) => !p.endsWith("PG_VERSION"),
        mkdirSyncImpl: () => {},
        rmSyncImpl,
        readdirSyncImpl: () => [] as any, // empty — freshly created dir
        pickPortImpl: async () => 5432,
        waitForReady: async () => {},
        ensureMigrated: async () => {},
        log: () => {},
      })
    );
    expect(rmSyncImpl).not.toHaveBeenCalled();
    expect(children).toHaveLength(2);
  });

  // Regression for the actual root cause behind "timed out waiting for embedded
  // Postgres on host:port": unixSocketDir (a *child* of dataDir) used to be
  // created up front, before the stale-data check below. That made a
  // genuinely fresh, never-used dataDir look non-empty on literally every
  // first run (it contained the just-created "sockets" dir), triggering a
  // bogus "clear and retry" that deleted "sockets" along with everything else
  // and never recreated it -- so the server always failed to bind with
  // "could not create lock file ... No such file or directory" on a clean
  // install, hidden behind the full 30s readiness timeout. unixSocketDir must
  // only be created right before the server starts, using a fake filesystem
  // (not a canned readdir stub) so this test actually catches the ordering.
  it("does not create the unix socket dir before the stale-data check, so a fresh install is never falsely treated as stale", async () => {
    const madeDirs: string[] = [];
    const mkdirSyncImpl: any = (p: string) => {
      madeDirs.push(p);
    };
    const readdirSyncImpl: any = (dir: string) =>
      madeDirs
        .filter(
          (p) => p !== dir && p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/")
        )
        .map((p) => p.slice(dir.length + 1));
    const children: any[] = [];
    const spawnImpl: any = (_c: string, _a: string[], _o: any) => {
      const child = fakeChild();
      children.push(child);
      if (children.length === 1) process.nextTick(() => child.emit("exit", 0)); // initdb succeeds
      return child;
    };
    const logs: string[] = [];
    const rmSyncImpl = vi.fn();
    await startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: () => false, // fresh install, no PG_VERSION yet
        mkdirSyncImpl,
        rmSyncImpl,
        readdirSyncImpl,
        pickPortImpl: async () => 5432,
        waitForReady: async () => {},
        ensureMigrated: async () => {},
        log: (m: string) => logs.push(m),
      })
    );
    expect(rmSyncImpl).not.toHaveBeenCalled();
    expect(logs.some((m) => m.includes("clearing stale"))).toBe(false);
    // initdb ran exactly once -- a bogus clear-and-retry would spawn it twice.
    expect(children).toHaveLength(2); // initdb, then the server
    expect(madeDirs).toContain("/userdata/database/sockets");
  });

  // Regression for "timed out waiting for embedded Postgres on host:port" with
  // zero further detail: the server's stdout/stderr were captured for the
  // console log only, never surfaced in the thrown error, so a real startup
  // failure (bad config, permissions, a crash) was indistinguishable from a
  // slow-but-healthy server -- both just produced the same generic timeout
  // after the full 30s wait. The server dying should be reported immediately,
  // with whatever it actually printed.
  it("reports the server's captured output when it exits before becoming ready", async () => {
    const spawnImpl: any = (_c: string, _a: string[], _o: any) => {
      const child = fakeChild();
      process.nextTick(() => {
        child.stderr.emit("data", Buffer.from("FATAL:  could not create any Unix-domain sockets"));
        child.emit("exit", 1);
      });
      return child;
    };
    const call = startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: (p: string) => p.endsWith("PG_VERSION"), // skip initdb
        mkdirSyncImpl: () => {},
        pickPortImpl: async () => 5432,
        waitForReady: () => new Promise(() => {}), // never resolves -- exit must win the race
        ensureMigrated: async () => {},
        log: () => {},
      })
    );
    await expect(call).rejects.toThrow(/exited unexpectedly \(code 1\)/);
    await expect(call).rejects.toThrow(/could not create any Unix-domain sockets/);
  });

  it("appends the server's captured output to a plain readiness-timeout error", async () => {
    const spawnImpl: any = (_c: string, _a: string[], _o: any) => {
      const child = fakeChild();
      process.nextTick(() => {
        child.stdout.emit("data", Buffer.from("LOG:  database system is starting up"));
      });
      return child; // never exits, never becomes ready
    };
    const call = startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: (p: string) => p.endsWith("PG_VERSION"),
        mkdirSyncImpl: () => {},
        pickPortImpl: async () => 5432,
        // A real timeout fires on a macrotask, well after any same-cycle
        // nextTick/microtask output has already been captured -- reproduce
        // that ordering here instead of an immediately-rejected promise.
        waitForReady: () =>
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(new Error("timed out waiting for embedded Postgres on 127.0.0.1:5432")),
              0
            );
          }),
        ensureMigrated: async () => {},
        log: () => {},
      })
    );
    await expect(call).rejects.toThrow(/timed out waiting for embedded Postgres/);
    await expect(call).rejects.toThrow(/database system is starting up/);
  });

  it("threads the engine lib dir into the spawned environment", async () => {
    const spawnedEnvs: any[] = [];
    const spawnImpl: any = (_c: string, _a: string[], o: any) => {
      spawnedEnvs.push(o.env);
      const child = fakeChild();
      if (spawnedEnvs.length === 1) process.nextTick(() => child.emit("exit", 0));
      return child;
    };
    await startEmbeddedDatabase(
      opts({
        spawnImpl,
        existsSyncImpl: (p: string) =>
          p === "/res/postgres/bin/initdb" || p === "/res/postgres/lib",
        mkdirSyncImpl: () => {},
        pickPortImpl: async () => 5432,
        waitForReady: async () => {},
        ensureMigrated: async () => {},
        log: () => {},
      })
    );
    const key = process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
    if (process.platform !== "win32") {
      expect(spawnedEnvs.length).toBeGreaterThan(0);
      expect(spawnedEnvs.some((e) => typeof e[key] === "string" && e[key].includes("lib"))).toBe(
        true
      );
    }
  });
});
