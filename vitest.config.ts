import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    testTimeout: 60000,
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "app/api/chat/**/*.test.ts",
      "app/api/cron/**/*.test.ts",
      "app/api/export/**/*.test.ts",
      "app/api/webhooks/**/*.test.ts",
      "app/api/attachments/**/*.test.ts",
      "app/api/invoices/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
