import { test, expect } from "@playwright/test";

test.describe("Navigation & Public Routes", () => {
  test("login page renders correctly", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("register page renders correctly", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByText("Create your account")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("pricing page is publicly accessible", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Free, forever", { exact: false })).toBeVisible();
    await expect(page.getByText("$0", { exact: true })).toBeVisible();
  });

  test("unknown routes redirect unauthenticated users to login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/this-page-does-not-exist-at-all");
    // Middleware redirects unauthenticated requests to /login (including unknown routes)
    await expect(page).toHaveURL(/login/);
  });

  // Auth-guard tests: clear cookies to ensure we're unauthenticated
  test("unauthenticated users are redirected to login from dashboard", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/login/);
  });

  test("unauthenticated users are redirected to login from invoices", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/invoices");
    await expect(page).toHaveURL(/login/);
  });

  test("unauthenticated users are redirected to login from reports", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/reports");
    await expect(page).toHaveURL(/login/);
  });

  test("login form stays on page when submitted empty", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/login/);
  });

  test("register form stays on page with short password", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password", { exact: true }).fill("123");
    await page.getByRole("button", { name: "Create account" }).click();
    // HTML minlength=8 prevents submission — should remain on register
    await expect(page).toHaveURL(/register/);
  });
});
