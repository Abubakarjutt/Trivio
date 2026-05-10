import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("login page renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("register page renders", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByText("Create your account")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("unauthenticated users are redirected to login", async ({ page }) => {
    // Clear cookies to ensure we're truly unauthenticated
    await page.context().clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/login/);
  });
});
