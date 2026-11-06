// Trivio — electron-builder `afterPack` hook.
//
// electron-builder writes Resources/app-update.yml (the GitHub release feed)
// into every build. A build made on a developer's machine is versioned 0.1.0
// (only the release workflow stamps the tag's version) and is signed with a
// different identity than the published releases. So its auto-updater always
// finds a "newer" release, downloads it, and then Squirrel rejects it ("code
// failed to satisfy specified code requirement(s)") -- leaving a "new version
// is ready, restart" prompt on every launch that can never complete.
//
// Outside the release workflow, drop the feed: main.ts's updaterFeedConfigured()
// then skips update checks entirely. This runs after electron-builder's own
// afterPack handlers (which write the file) and before signing, so the signature
// covers the bundle as shipped. Set TRIVIO_KEEP_UPDATE_FEED=1 to keep the feed
// in a local build (e.g. to test the updater itself).
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export function shouldKeepUpdateFeed(env) {
  return env.GITHUB_ACTIONS === "true" || env.TRIVIO_KEEP_UPDATE_FEED === "1";
}

export default async function afterPack(context) {
  if (shouldKeepUpdateFeed(process.env)) return;
  const feed = join(context.packager.getResourcesDir(context.appOutDir), "app-update.yml");
  if (!existsSync(feed)) return;
  rmSync(feed);
  console.log(`[afterPack] local build -- removed ${feed} so the auto-updater stays off.`);
}
