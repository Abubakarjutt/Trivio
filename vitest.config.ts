import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
      "app/api/email/**/*.test.ts",
      "app/api/chat/**/*.test.ts",
      "app/api/export/**/*.test.ts",
      "app/api/webhooks/**/*.test.ts",
      "app/api/attachments/**/*.test.ts",
      "app/api/invoices/**/*.test.ts",
      // cloudflare/email-worker tests require a Cloudflare Workers runtime (postal-mime uses `self`)
      // and cannot run under Vitest's Node.js environment. Run them with wrangler test instead.
    ],
    exclude: ["tests/e2e/**", "**/node_modules/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
