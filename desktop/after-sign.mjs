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
// `codesign --verify --deep --strict` (which is exactly what Gatekeeper's
// spctl runs on open) then fails with "code has no resources but signature
// indicates they must be present" -- and macOS surfaces that as
// "'Trivio.app' is damaged and can't be opened. You should move it to the
// Trash," NOT the milder "unidentified developer" warning. Unlike the milder
// warning, this one is NOT worked around by right-click -> Open; only
// stripping the quarantine attribute via `xattr -d` bypasses it, which is not
// what most users do.
//
// Fix: after electron-builder's own (attempted) sign step, verify the result.
// If it's missing or stale, force a fresh ad-hoc signature (`--sign -`, no
// identity/certificate required) over the ACTUAL current bundle contents so
// the CodeResources seal is internally consistent. This still shows the
// milder "unidentified developer" Gatekeeper warning (expected for an
// unsigned build) instead of "damaged" -- exactly the workaround already
// documented in the release notes.
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

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
    `[afterSign] ${appPath} has no/stale signature (${String(verify.stderr).trim()}) -- ad-hoc re-signing.`
  );
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });

  const reverify = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    encoding: "utf8",
  });
  if (reverify.status !== 0) {
    throw new Error(
      `[afterSign] ad-hoc re-sign of ${appPath} still fails verification: ${String(reverify.stderr).trim()}`
    );
  }
  console.log(`[afterSign] ✓ ${appPath} now has a valid, internally-consistent ad-hoc signature.`);
}
