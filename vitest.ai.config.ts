// Opt-in live eval of the AI chat against the REAL local model (Ollama +
// Gemma) and a throwaway embedded Postgres. Slow and non-deterministic, so it
// is not part of CI:
//   npm run test:ai
// Needs Ollama running with the model pulled (OLLAMA_MODEL, default gemma4:e4b).
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/ai/**/*.ai.test.ts"],
    globalSetup: ["./tests/qa/global-setup.ts"],
    setupFiles: ["./tests/qa/setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    pool: "forks",
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
