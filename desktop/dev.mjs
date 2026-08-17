// Trivio — desktop dev orchestrator.
//
// Starts the Next.js dev server and waits for it to accept connections, then
// launches the compiled Electron shell pointed at that dev server. Killing
// either side tears down the other.
//
//   npm run dev:desktop

import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mainFile = join(root, "desktop", "dist", "main.cjs");
const HOST = "127.0.0.1";
const PORT = process.env.PORT || "3000";

if (!existsSync(mainFile)) {
  console.error(
    `   ${mainFile} not found — run "npm run build:electron" first\n   (the dev:desktop script does this automatically).`
  );
  process.exit(1);
}

function waitForPort(port, host, timeoutMs = 90000) {
  return new Promise((res, rej) => {
    const start = Date.now();
    const attempt = () => {
      const s = net.connect(port, host);
      s.once("connect", () => {
        s.destroy();
        res();
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() - start > timeoutMs)
          return rej(new Error(`timed out waiting for ${host}:${port}`));
        setTimeout(attempt, 400);
      });
    };
    attempt();
  });
}

async function main() {
  // 1. Next dev server (stdout streamed to our console).
  const next = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], {
    cwd: root,
    env: { ...process.env, PORT, HOSTNAME: HOST },
    stdio: "inherit",
  });

  let electron = null;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    electron?.kill("SIGTERM");
    next.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    await waitForPort(PORT, HOST);
    console.log(`[dev] Trivio dev server ready on ${HOST}:${PORT} — launching desktop shell…`);

    // `require("electron")` resolves to the platform binary path.
    const electronBin = require("electron");
    electron = spawn(electronBin, [mainFile], {
      cwd: root,
      env: {
        ...process.env,
        DESKTOP_MODE: "dev",
        DEV_SERVER_URL: `http://${HOST}:${PORT}`,
      },
      stdio: "inherit",
    });

    electron.on("exit", (code) => {
      console.log(`[dev] Trivio exited (code ${code}) — stopping dev loop`);
      next.kill("SIGTERM");
      process.exit(code ?? 0);
    });
  } catch (err) {
    console.error(`[dev] ${err.message}`);
    next.kill("SIGTERM");
    process.exit(1);
  }
}

main();
