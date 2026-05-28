import { test, expect } from "@playwright/test";

const ROUTES = ["/pf/transactions"] as const;

test.describe("Statement Transactions — auth guard", () => {
  for (const route of ROUTES) {
    test(`unauthenticated users are redirected to /login from ${route}`, async ({ page }) => {
      await page.context().clearCookies();
      await page.goto(route);
      await expect(page).toHaveURL(/login/);
    });
  }
});

test.describe("Statement Transactions — redirect preserves destination", () => {
  test("redirect from /pf/transactions lands on /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/pf/transactions");
    await expect(page).toHaveURL(/login/);
  });
});
