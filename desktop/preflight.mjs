// Trivio — build preflight for the desktop shipping build.
//
// Guards `npm run build:desktop` so it never SILENTLY produces an undistributable
// artifact. It is cheap and runs first (before the slow `next build`):
//
//   * Always: report the signing + notarization posture and the standalone server
//     so the log is honest about what the build will contain.
//   * When SHIP=1 (used by `npm run build:desktop:ship`): HARD-FAIL unless a
//     "Developer ID Application" identity is installed AND Apple notary
//     credentials are present. An "Apple Development" cert and/or a missing
//     notary feed yield a .dmg that Gatekeeper blocks on any other machine.
//
// On non-macOS hosts the signing checks are skipped (electron-builder --mac only
// runs on macOS anyway); the script still validates the server tree.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const SHIP = process.env.SHIP === "1";

const problems = []; // hard errors (die when SHIP=1)
const warnings = []; // soft notices (always printed, exit 0)

function log(msg) {
  console.log(`[preflight] ${msg}`);
}
function warn(msg) {
  warnings.push(msg);
}
function err(msg) {
  problems.push(msg);
}

// ── 1. The assembled / buildable server tree ────────────────────────────────
const standalone = join(root, ".next", "standalone");
const distServer = join(root, "desktop", "dist-server");
if (existsSync(join(distServer, "server.js"))) {
  log(`app server present: desktop/dist-server (assembled)`);
} else if (existsSync(standalone)) {
  log(`.next/standalone present — will be assembled into dist-server`);
} else {
  err("no .next/standalone and no desktop/dist-server — run `npm run build` first.");
}

// ── 2. Code-signing + notarization / SmartScreen posture ──────────────────────
// On macOS: a "Developer ID Application" identity + Apple notary credentials.
// On Windows: an Authenticode certificate via CSC_LINK (base64 .pfx) + CSC_KEY_
// PASSWORD. Without signing, macOS Gatekeeper / Windows SmartScreen will warn.
if (process.platform === "darwin") {
  const identities = macCodeSignIdentities();
  const devId = identities.find((i) => /Developer ID Application/i.test(i.name));
  const devOnly =
    identities.length > 0 && !devId && identities.every((i) => /Apple Development/i.test(i.name));
  if (devId) {
    log(`Developer ID Application identity: ${devId.name}`);
  } else if (devOnly) {
    const msg = `only "Apple Development" identities found — these cannot be distributed. Use a "Developer ID Application" cert to ship a .dmg that opens on other machines.`;
    SHIP ? err(msg) : warn(msg);
  } else if (identities.length === 0) {
    const msg = `no codesigning identity in the keychain — the build will be ad-hoc/unsigned and Gatekeeper will block it on other machines.`;
    SHIP ? err(msg) : warn(msg);
  }
  const hasNotary = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD);
  const hasKeychainProfile = Boolean(process.env.NOTARY_PROFILE);
  if (hasNotary || hasKeychainProfile) {
    log("notary credentials present — the build will be notarized + stapled.");
  } else {
    const msg =
      "no Apple notary credentials (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD, or NOTARY_PROFILE) — the build will NOT be notarized.";
    SHIP ? err(msg) : warn(msg);
  }
} else if (process.platform === "win32") {
  const hasCert = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
  if (hasCert) {
    log(
      "Windows signing certificate present (CSC_LINK/CSC_NAME) — the .exe will be Authenticode-signed."
    );
  } else {
    const msg =
      "no Windows signing certificate (CSC_LINK = base64 .pfx + CSC_KEY_PASSWORD) — the .exe will be unsigned and Windows SmartScreen will show a 'protected your PC' warning until signed.";
    SHIP ? err(msg) : warn(msg);
  }
} else {
  log("non-macOS/non-Windows host — skipping code-signing checks.");
}

function macCodeSignIdentities() {
  let identities = [];
  try {
    const out = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
    });
    identities = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /\(\w{10}\)\s*$/.test(l))
      .map((l) => {
        const m = l.match(/\d+\)\s+([0-9A-F]{40})\s+"(.+?)"/);
        return m ? { sha1: m[1], name: m[2] } : null;
      })
      .filter(Boolean);
  } catch (e) {
    warn(`could not query the keychain (security): ${e.message.split("\n")[0]}`);
  }
  return identities;
}

// ── 3. The embedded PostgreSQL engine ───────────────────────────────────────
// The default desktop build is local-mode: it ships its OWN Postgres (no docker,
// no external DB). If the engine isn't laid down under desktop/embedded/bin the
// packaged app would start with no database. `npm run fetch:pg` produces it.
const engineBin = join(
  root,
  "desktop",
  "embedded",
  "bin",
  "postgres" + (process.platform === "win32" ? ".exe" : "")
);
if (existsSync(engineBin)) {
  try {
    const out = execFileSync(engineBin, ["--version"], { encoding: "utf8" }).trim();
    log(`embedded Postgres engine present: ${out}`);
  } catch {
    warn(`desktop/embedded/bin/postgres exists but 'postgres --version' failed`);
  }
} else {
  const msg =
    "no embedded Postgres engine at desktop/embedded/bin — run `npm run fetch:pg` " +
    "(the default build does this automatically); without it the shipped app has no database";
  SHIP ? err(msg) : warn(msg);
}

// ── Verdict ──────────────────────────────────────────────────────────────────
for (const w of warnings) console.log(`[preflight] WARN  ${w}`);

if (problems.length) {
  for (const p of problems) console.error(`[preflight] FAIL    ${p}`);
  console.error(
    `[preflight] ✗ ${problems.length} blocking problem(s). ` +
      `Set a signing identity: CSC_NAME="Developer ID Application: ..." on macOS, ` +
      `or CSC_LINK (base64 .pfx) + CSC_KEY_PASSWORD on Windows, and ` +
      `APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD (plus APPLE_TEAM_ID) on macOS, ` +
      `then re-run. See desktop/README.md "Sign & notarize".`
  );
  process.exit(1);
}
console.log(
  "[preflight] ✓ ready to build (ad-hoc/unsigned unless signing + notary creds are present)."
);
