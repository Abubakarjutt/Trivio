// UI smoke: a brand-new user signs up, onboards, opens every page, adds a
// transaction by hand, and approves / rejects AI chat cards — checking what
// the Transactions page shows after each step.
import { test, expect, type Page } from "@playwright/test";

test.use({ baseURL: process.env.E2E_BASE_URL });
test.describe.configure({ mode: "serial" });

let page: Page;
const email = `e2e-${Date.now()}@example.test`;
const password = "correct-horse-battery-1";

const PAGES = [
  "/dashboard",
  "/transactions",
  "/transactions/new",
  "/invoices",
  "/invoices/new",
  "/bills",
  "/bills/new",
  "/contacts",
  "/accounts",
  "/reconciliation",
  "/reports",
  "/reports/profit-loss",
  "/reports/balance-sheet",
  "/reports/trial-balance",
  "/reports/ar-aging",
  "/reports/ap-aging",
  "/reports/tax-summary",
  "/pf/transactions",
  "/pf/tax-report",
  "/budgets",
  "/goals",
  "/recurring",
  "/watchlists",
  "/crm",
  "/crm/leads",
  "/crm/deals",
  "/crm/companies",
  "/crm/activities",
  "/extract",
  "/settings",
  "/settings/pipelines",
  "/settings/billing",
];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test("sign up and onboard like a new user", async () => {
  await page.goto("/register");
  await page.locator("#name").fill("E2E User");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#confirmPassword").fill(password);
  await page.locator("#gdprConsent").click();
  await page.getByRole("button", { name: /create|sign up|get started/i }).click();

  await page.waitForURL(/\/onboarding/);
  await page.locator("#businessName").fill("E2E Studio");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.locator("#taxRegime").click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: /Skip for now/ }).click();
  await page.waitForURL(/\/dashboard/);
});

test("every page renders without an error", async () => {
  // `next dev` compiles each page on first visit — allow for it.
  test.setTimeout(PAGES.length * 60_000);
  const broken: string[] = [];
  const onError = (e: Error) => broken.push(`${page.url()}: ${e.message}`);
  page.on("pageerror", onError);
  for (const path of PAGES) {
    const res = await page.goto(path);
    expect.soft(res?.status(), path).toBeLessThan(400);
    await expect.soft(page.locator("main").first(), path).toBeVisible();
    // Let client queries settle, then look for the error boundary.
    await page.waitForTimeout(500);
    await expect.soft(page.getByText("Something went wrong"), path).toHaveCount(0);
    expect.soft(page.url(), path).not.toMatch(/\/login/);
  }
  page.off("pageerror", onError);
  expect(broken).toEqual([]);
});

test("a transaction added by hand shows up in Personal Finance", async () => {
  await page.goto("/pf/transactions");
  await page.getByRole("button", { name: "Add Transaction" }).first().click();
  await page.locator("#txn-desc").fill("Farmers Market");
  await page.locator("#txn-amount").fill("42");
  await page.getByRole("dialog").getByRole("button", { name: "Add Transaction" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("Farmers Market").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Farmers Market").first()).toBeVisible();
});

async function ask(text: string) {
  const input = page.getByPlaceholder("Ask me anything...");
  if (!(await input.isVisible()))
    await page.getByRole("button", { name: "Open AI assistant" }).click();
  await input.fill(text);
  await input.press("Enter");
}

test("a chat expense waits for Approve, then appears on the Transactions page", async () => {
  await page.goto("/pf/transactions");
  await ask("I spent 25 at Bakery");
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await expect(approve).toBeVisible();
  // The model's premature "✓ Expense recorded" must not be shown.
  await expect(page.getByText("✓ Expense recorded")).toHaveCount(0);
  // Not saved yet.
  const table = page.locator("main");
  await expect(table.getByText("Bakery")).toHaveCount(0);

  await approve.click();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  // The list refreshes on its own…
  await expect(table.getByText("Bakery").first()).toBeVisible();
  // …and it's really saved.
  await page.reload();
  await expect(page.locator("main").getByText("Bakery").first()).toBeVisible();
});

test("a rejected chat card saves nothing", async () => {
  await page.goto("/pf/transactions");
  await ask("I spent 99 at Casino");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText(/Rejected — nothing was saved/)).toBeVisible();
  await page.reload();
  await expect(page.locator("main").getByText("Casino")).toHaveCount(0);
});
