// QA suite: every tRPC procedure and the AI chat's approval flow, run against
// a REAL Postgres (the desktop app's embedded engine, started fresh per run).
//   npm run test:qa
// Set QA_DATABASE_URL to use an existing THROWAWAY database instead.
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/qa/**/*.qa.test.ts"],
    globalSetup: ["./tests/qa/global-setup.ts"],
    setupFiles: ["./tests/qa/setup.ts"],
    testTimeout: 60000,
    hookTimeout: 120000,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
