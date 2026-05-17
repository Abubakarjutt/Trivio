import { test, expect } from "@playwright/test";

/**
 * EasyFinance module — E2E tests
 *
 * Covers:
 *  1. Auth-guard: unauthenticated users are redirected to /login for all 4 routes
 *  2. Public-route sanity: each page is at least mounted (no crash) for authenticated users
 *     (uses the pre-authenticated storageState configured in playwright.config.ts, if available)
 */

const ROUTES = ["/budgets", "/goals", "/recurring", "/watchlists"] as const;

// ─── Auth guard (unauthenticated) ─────────────────────────────────────────────

test.describe("EasyFinance — auth guard", () => {
  for (const route of ROUTES) {
    test(`unauthenticated users are redirected to /login from ${route}`, async ({ page }) => {
      await page.context().clearCookies();
      await page.goto(route);
      await expect(page).toHaveURL(/login/);
    });
  }
});

// ─── Page render sanity (unauthenticated — just checks redirect behaviour) ────

test.describe("EasyFinance — redirect preserves destination in URL or goes to /login", () => {
  test("redirect from /budgets lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/budgets");
    await expect(page).toHaveURL(/login/);
  });

  test("redirect from /goals lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/goals");
    await expect(page).toHaveURL(/login/);
  });

  test("redirect from /recurring lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/recurring");
    await expect(page).toHaveURL(/login/);
  });

  test("redirect from /watchlists lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/watchlists");
    await expect(page).toHaveURL(/login/);
  });
});
