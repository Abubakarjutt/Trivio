// UI smoke tests: a real browser against a real `next dev` server and a
// throwaway embedded Postgres (see e2e/global-setup.ts). The AI model is a
// stub, so the suite is deterministic and needs no Ollama.
//   npm run test:e2e
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    // E2E_CHANNEL=chrome uses the installed Google Chrome instead of
    // Playwright's downloaded Chromium (`npx playwright install chromium`).
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
