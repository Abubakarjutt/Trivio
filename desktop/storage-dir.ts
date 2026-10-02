// One-time move of uploads out of the app bundle.
//
// Before v0.1.25 the server saved attachments under process.cwd()/storage,
// which in the desktop app is inside the (replaced-on-update) app bundle.
// main.ts now points TRIVIO_STORAGE_DIR at userData/storage and calls this on
// start to carry over anything an older version left behind. Existing files in
// the new folder always win; the old folder is removed afterwards.

import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await countFiles(join(dir, e.name)) : 1;
  }
  return n;
}

export async function moveLegacyAttachments(from: string, to: string): Promise<number> {
  let n: number;
  try {
    n = await countFiles(from);
  } catch {
    return 0; // nothing there
  }
  if (n > 0) await cp(from, to, { recursive: true, force: false, errorOnExist: false });
  await rm(from, { recursive: true, force: true }).catch(() => {});
  return n;
}
