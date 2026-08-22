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
