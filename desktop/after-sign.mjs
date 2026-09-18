// Trivio — electron-builder `afterSign` hook (macOS only).
//
// When no "Developer ID Application" identity is in the keychain,
// electron-builder SKIPS macOS code signing entirely (see its own log line:
// "skipped macOS application code signing ... allIdentities=0 identities
// found"). It does NOT fall back to ad-hoc signing. The packaged .app is left
// with whatever signature happened to be embedded in the raw, pre-customization
// Electron.framework binaries pulled from the `electron` npm package -- a
// signature computed over content that no longer matches the assembled bundle
// (extraResources: app-server, postgres; customized main.cjs/preload.cjs).
//
// `codesign --verify --deep --strict` then fails with "code has no resources
// but signature indicates they must be present" -- and macOS surfaces that as
// "'Trivio.app' is damaged and can't be opened. You should move it to the
// Trash," not the milder "unidentified developer" warning.
//
// A first attempt at this hook did a plain `codesign --force --deep --sign -`
// (no --options/--entitlements). That produced a signature that passed
// `codesign --verify --deep --strict` and made `spctl --assess` report
// "rejected" -- which looked identical, at the CLI, to the intended milder
// outcome. It was NOT: verified against a real published build downloaded
// fresh on real Apple Silicon hardware, it still showed "is damaged". Root
// cause (confirmed against an identical bug in another Electron app -- see
// https://github.com/BenItBuhner/Zenium/pull/55): `spctl --assess`'s
// "rejected" verdict does not distinguish "damaged" from "unidentified
// developer" -- that distinction is decided by Finder/Gatekeeper using
// additional signal a plain ad-hoc `--deep --sign -` does not provide: the
// signature needs hardened runtime (`--options runtime`) and the app's own
// entitlements (desktop/entitlements.mac.plist -- already used for the SIGNED
// build path, just never reaches the unsigned path since electron-builder's
// own sign step is skipped entirely when ad-hoc). `disable-library-validation`
// in that plist matters here too: ad-hoc identities have no Team ID, and
// without it a hardened-runtime process can refuse to load its own
// independently-ad-hoc-signed native modules (e.g. the Prisma query engine).
//
// Fix: after electron-builder's own (attempted) sign step, verify the result.
// If it's missing or stale, force a fresh ad-hoc signature over the ACTUAL
// current bundle contents, WITH hardened runtime + the app's entitlements, so
// Gatekeeper treats it as an ordinary unsigned app (workaround-able via
// System Settings > Privacy & Security > Open Anyway, or right-click -> Open)
// instead of "damaged".
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ENTITLEMENTS = join(dirname(fileURLToPath(import.meta.url)), "entitlements.mac.plist");

export default async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== "darwin") return;

  const appPath = join(appOutDir, `${packager.appInfo.productFilename}.app`);
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    encoding: "utf8",
  });
  if (verify.status === 0) {
    console.log(`[afterSign] ${appPath} already has a valid deep signature -- leaving it alone.`);
    return;
  }

  console.log(
    `[afterSign] ${appPath} has no/stale signature (${String(verify.stderr).trim()}) -- ad-hoc re-signing (hardened runtime + entitlements).`
  );
  execFileSync(
    "codesign",
    [
      "--force",
      "--deep",
      "--sign",
      "-",
      "--options",
      "runtime",
      "--timestamp=none", // no Developer ID -> no real timestamp authority to call
      "--entitlements",
      ENTITLEMENTS,
      appPath,
    ],
    { stdio: "inherit" }
  );

  const reverify = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    encoding: "utf8",
  });
  if (reverify.status !== 0) {
    throw new Error(
      `[afterSign] ad-hoc re-sign of ${appPath} still fails verification: ${String(reverify.stderr).trim()}`
    );
  }
  console.log(
    `[afterSign] ✓ ${appPath} now has a valid, internally-consistent, hardened-runtime ad-hoc signature.`
  );
}
