import { test, expect } from "@playwright/test";

/**
 * CRM module — E2E tests
 *
 * Auth-guard: all CRM routes redirect unauthenticated users to /login
 */

const ROUTES = [
  "/crm",
  "/crm/leads",
  "/crm/companies",
  "/crm/deals",
  "/crm/activities",
  "/settings/pipelines",
] as const;

test.describe("CRM — auth guard", () => {
  for (const route of ROUTES) {
    test(`unauthenticated users are redirected to /login from ${route}`, async ({ page }) => {
      await page.context().clearCookies();
      await page.goto(route);
      await expect(page).toHaveURL(/login/);
    });
  }
});

test.describe("CRM — redirect destinations", () => {
  test("redirect from /crm lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/crm");
    await expect(page).toHaveURL(/login/);
  });

  test("redirect from /crm/leads lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/crm/leads");
    await expect(page).toHaveURL(/login/);
  });

  test("redirect from /crm/deals lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/crm/deals");
    await expect(page).toHaveURL(/login/);
  });

  test("redirect from /settings/pipelines lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/settings/pipelines");
    await expect(page).toHaveURL(/login/);
  });
});
