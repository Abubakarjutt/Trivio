// Fails the build if the user's Messages database (~/Library/Messages/chat.db)
// was pulled into the Next.js output. The SMS reader references that path, and
// Next's output file tracing would copy it into .next/standalone — and from
// there into the shipped .app — if it ever resolved the path statically.
//
// Checks every file path under .next/standalone and every entry listed in the
// .next/**/*.nft.json trace files. Used by `npm run build` (postbuild) and by
// desktop/assemble-server.mjs.
//
// Usage: node scripts/check-no-messages-db.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MESSAGES_DB_PATTERN = /Library\/Messages|chat\.db(-wal|-shm)?$/;

const toPosix = (p) => p.replace(/\\/g, "/");

// Symlinks are not followed (Dirent.isDirectory() is false for them), so a
// link into ~/Library can't send the walk outside the build tree.
function walk(dir, visit, skip = () => false) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip(p)) walk(p, visit, skip);
    } else {
      visit(p);
    }
  }
}

// Returns every offending path (build files, or trace entries as "<nft>: <entry>").
export function findMessagesDbInBuild(nextDir) {
  const hits = [];
  const standalone = join(nextDir, "standalone");
  if (existsSync(standalone)) {
    walk(standalone, (p) => {
      if (MESSAGES_DB_PATTERN.test(toPosix(p))) hits.push(p);
    });
  }
  if (existsSync(nextDir)) {
    walk(
      nextDir,
      (p) => {
        if (!p.endsWith(".nft.json")) return;
        const { files = [] } = JSON.parse(readFileSync(p, "utf8"));
        for (const f of files) {
          if (MESSAGES_DB_PATTERN.test(toPosix(f))) hits.push(`${p}: ${f}`);
        }
      },
      (p) => p === join(nextDir, "cache")
    );
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nextDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".next");
  const hits = findMessagesDbInBuild(nextDir);
  if (hits.length > 0) {
    console.error("✗ Messages database found in build output");
    for (const h of hits) console.error(`  ${h}`);
    process.exit(1);
  }
  console.log("✓ no Messages database in build output");
}
