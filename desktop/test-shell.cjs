// Trivio desktop — runner for the compiled-shell behaviour tests.
//
// Ensures the Electron shell is compiled (compiles it if the bundle is missing),
// then runs the scenario processes (dev, remote, local), each in its own
// process because they patch Module._load / global.fetch / child_process. Prints
// a combined summary and exits non-zero if any scenario fails.
//
// Usage: node desktop/test-shell.cjs    (or: npm run test:desktop)

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve, join, basename } = require("node:path");

const dir = __dirname;
const mainCjs = resolve(dir, "dist", "main.cjs");
const buildScript = resolve(dir, "build-electron.mjs");
const scenario = resolve(dir, "test-shell.scenario.cjs");

function run(label, cmd, args, env) {
  console.log(`\n[test:desktop] ── ${label} ──`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    cwd: resolve(dir, ".."),
  });
  const ok = r.status === 0 && !r.signal;
  if (!ok) console.error(`[test:desktop] ✗ ${label} (exit=${r.status} signal=${r.signal})`);
  return ok;
}

// 1. Ensure the shell is compiled.
if (existsSync(mainCjs)) {
  console.log(`[test:desktop] using compiled shell: ${mainCjs}`);
} else {
  console.log(`[test:desktop] ${basename(mainCjs)} missing — compiling shell via build-electron.mjs`);
  if (!run("build electron shell", process.execPath, [buildScript], {})) {
    console.error("[test:desktop] ✗ failed to compile the desktop shell");
    process.exit(1);
  }
  if (!existsSync(mainCjs)) {
    console.error(`[test:desktop] ✗ build produced no ${mainCjs}`);
    process.exit(1);
  }
}

// 2. Run each scenario in its own process (they patch process globals).
const scenarios = [
  { label: "scenario: dev (next dev loopback)", env: { SCENARIO: "dev" } },
  { label: "scenario: remote (thin client)", env: { SCENARIO: "remote" } },
  { label: "scenario: local (embedded server)", env: { SCENARIO: "local" } },
];

let failures = 0;
for (const s of scenarios) {
  if (!run(s.label, process.execPath, [scenario], s.env)) failures++;
}

// 3. Combined summary.
console.log(`\n[test:desktop] ${scenarios.length - failures}/${scenarios.length} scenario processes passed`);
if (failures > 0) {
  console.error(`[test:desktop] ✗ ${failures} scenario(s) failed`);
  process.exit(1);
}
console.log("[test:desktop] ✓ all scenarios passed");
