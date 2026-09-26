// Boots everything the UI smoke tests need, fresh for each run:
//   • a throwaway embedded Postgres (the desktop app's own engine), migrated
//     and seeded with tax regimes;
//   • a stub Ollama that answers like Gemma would — "I spent 25 at Bakery"
//     becomes an add_pf_transaction proposal — so chat cards are deterministic;
//   • `next dev` wired to both, with the desktop app's server flags.
// The base URL is handed to the tests via E2E_BASE_URL.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { startEmbeddedDatabase } from "../desktop/embedded/embedded-db";
import { seedTaxRegimes } from "../server/services/tax-regime.service";

const repo = resolve(__dirname, "..");
const PORT = Number(process.env.E2E_PORT ?? 3107);

type Msg = { role: string; content: string };

/** What the stub model says, given the conversation so far. */
function stubReply(messages: Msg[]): string {
  const nonce = /TOOL_CALL_([0-9a-f]{16})/.exec(messages[0]?.content ?? "")?.[1] ?? "";
  const last = messages.at(-1)?.content ?? "";
  if (/just answered your proposed actions/.test(last)) return "Done — anything else?";
  const spent = /spent (\d+(?:\.\d+)?) at ([A-Za-z]+)/i.exec(last);
  if (spent) {
    const args = {
      merchantName: spent[2],
      amount: Number(spent[1]),
      type: "EXPENSE",
      category: "Other",
    };
    // Like a small model: a premature ✓ line the app must strip.
    return `✓ Expense recorded\nTOOL_CALL_${nonce}: ${JSON.stringify({ tool: "add_pf_transaction", args })}`;
  }
  return "Hello! How can I help with your finances?";
}

function startStubOllama(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/chat") {
        const { messages } = JSON.parse(body) as { messages: Msg[] };
        res.end(JSON.stringify({ message: { content: stubReply(messages) }, done: true }));
      } else if (req.url === "/api/tags") {
        res.end(JSON.stringify({ models: [{ name: "gemma4:e4b", model: "gemma4:e4b" }] }));
      } else if (req.url === "/api/version") {
        res.end(JSON.stringify({ version: "0.0.0-stub" }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      ok({ server, url: `http://127.0.0.1:${addr.port}` });
    })
  );
}

async function waitForHttp(url: string, child: ChildProcess, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`next dev exited with ${child.exitCode}`);
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${url}`);
}

export default async function globalSetup() {
  const work = mkdtempSync(join(tmpdir(), "trivio-e2e-"));
  const db = await startEmbeddedDatabase({
    env: {
      ...process.env,
      TRIVIO_DB_DIR: join(work, "pg"),
      TRIVIO_DB_SOCKET_DIR: mkdtempSync("/tmp/te2e-"),
    },
    userDataDir: work,
    resourcesDir: join(repo, "desktop", "build"),
    serverDir: repo,
    log: () => {},
  });
  const prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  await seedTaxRegimes(prisma);
  await prisma.$disconnect();

  const ollama = await startStubOllama();
  const baseURL = `http://127.0.0.1:${PORT}`;
  const next = spawn(
    join(repo, "node_modules/.bin/next"),
    ["dev", "-p", String(PORT), "-H", "127.0.0.1"],
    {
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: db.url,
        NEXTAUTH_URL: baseURL,
        AUTH_URL: baseURL,
        AUTH_SECRET: randomBytes(32).toString("base64"),
        NEXTAUTH_SECRET: randomBytes(32).toString("base64"),
        AUTH_TRUST_HOST: "true",
        TRIVIO_DESKTOP_EMBEDDED: "true",
        SKIP_EMAIL_VERIFICATION: "true",
        AI_PROVIDER: "ollama",
        OLLAMA_HOST: ollama.url,
        OLLAMA_MODEL: "gemma4:e4b",
        GEMINI_API_KEY: "",
        RESEND_API_KEY: "",
        STRIPE_SECRET_KEY: "",
      },
      stdio: process.env.E2E_VERBOSE ? "inherit" : "ignore",
    }
  );

  try {
    await waitForHttp(`${baseURL}/login`, next);
  } catch (err) {
    next.kill("SIGTERM");
    ollama.server.close();
    await db.stop();
    throw err;
  }
  process.env.E2E_BASE_URL = baseURL;

  return async () => {
    next.kill("SIGTERM");
    ollama.server.close();
    await db.stop();
    rmSync(work, { recursive: true, force: true });
  };
}
