// Trivio — notarize + staple a built macOS artifact (belt-and-suspenders step).
//
// electron-builder already auto-notarizes when APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD
// (+ APPLE_TEAM_ID) are set and the app is signed with a Developer ID cert. This
// script is the explicit, inspectable alternative — handy for notarizing a
// pre-built .dmg/.app or for CI where you want the step in the log.
//
// Usage:
//   APPLE_ID=me@example.com APPLE_APP_SPECIFIC_PASSWORD=xxxx \
//     APPLE_TEAM_ID=R3B5NU8CVN node desktop/notarize.mjs [path-to-artifact]
//
// Without credentials it exits non-zero with guidance (never silently succeeds).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const releaseDir = join(root, "release");

function fail(msg, hint) {
  console.error(`[notarize] ✗ ${msg}`);
  if (hint) console.error(`[notarize]   ${hint}`);
  process.exit(1);
}

const APPLE_ID = process.env.APPLE_ID;
const APPLE_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD;
const TEAM_ID = process.env.APPLE_TEAM_ID;
const PROFILE = process.env.NOTARY_PROFILE;

if (!PROFILE && !(APPLE_ID && APPLE_PASSWORD)) {
  fail(
     "no notary credentials",
     "set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD (+ APPLE_TEAM_ID), or NOTARY_PROFILE, then retry."
    );
}

// Pick the artifact: explicit arg, else the newest .dmg in release/.
let artifact = process.argv[2];
if (!artifact) {
  if (!existsSync(releaseDir)) fail(`release dir not found at ${releaseDir}`, "run `npm run build:desktop` first.");
  const dmgs = readdirSync(releaseDir)
     .filter((f) => f.endsWith(".dmg"))
     .map((f) => ({ f, m: statSync(join(releaseDir, f)).mtimeMs }))
     .sort((a, b) => b.m - a.m);
  if (!dmgs.length) fail("no .dmg in release/", "run `npm run build:desktop` first.");
  artifact = join(releaseDir, dmgs[0].f);
}
if (!existsSync(artifact)) fail(`artifact not found: ${artifact}`);
console.log(`[notarize] notarizing ${basename(artifact)}`);

const submitArgs = ["notarytool", "submit", artifact];
if (PROFILE) submitArgs.push("--keychain-profile", PROFILE, "--wait");
else {
  submitArgs.push("--apple-id", APPLE_ID, "--password", APPLE_PASSWORD, "--wait");
  if (TEAM_ID) submitArgs.push("--team-id", TEAM_ID);
}
try {
  execFileSync("xcrun", submitArgs, { stdio: "inherit" });
} catch (e) {
  fail(`notarytool submit failed`, "check the credentials + that the artifact is Developer-ID signed + hardened-runtime.");
}

// Staple the ticket so Gatekeeper accepts it offline.
try {
  execFileSync("xcrun", ["stapler", "staple", artifact], { stdio: "inherit" });
} catch (e) {
  fail(`stapler staple failed`, "the notary ticket may not be ready; re-run staple later or in a few minutes.");
}

console.log(`[notarize] ✓ notarized + stapled ${basename(artifact)}`);
console.log("[notarize] verify: spctl -a -t exec -vv <artifact>  and  xcrun stapler validate <artifact>");
