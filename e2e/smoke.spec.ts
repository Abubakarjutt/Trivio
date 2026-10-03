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
  "/pf/dashboard",
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
  const context = await browser.newContext({ permissions: ["microphone"] });
  // A synthetic microphone (a 440 Hz tone) behind the real getUserMedia API,
  // so voice input is testable without the OS mic prompt. Recording, WAV
  // conversion, upload and transcription all run for real.
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const out = ctx.createMediaStreamDestination();
      osc.connect(out);
      osc.start();
      return out.stream;
    };
  });
  page = await context.newPage();
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

  // …and in the Overview's spending breakdown.
  await page.goto("/pf/dashboard");
  await expect(page.getByTestId("spending-pie")).toBeVisible();
  await expect(page.getByText("Top merchants")).toBeVisible();
  await expect(page.locator("main").getByText("Farmers Market").first()).toBeVisible();
});

test("the month stays open until closed with the button, and can be reopened", async () => {
  await page.goto("/pf/dashboard");
  // The sidebar marks the page it's on (both classes, not run together).
  await expect(page.getByRole("link", { name: "Overview" })).toHaveClass(
    /(^| )sb-link sb-active( |$)/
  );
  const label = page.getByTestId("pay-month-label");
  await expect(label).toHaveText(/– now$/);
  await page.getByRole("button", { name: "Close month" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Last day of this month")).toBeVisible();
  await dialog.getByRole("button", { name: "Close month" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Month closed\. A new month started on/)).toBeVisible();

  // Today's expense stays in the month just closed; the new one starts empty.
  await expect(page.getByText("No transactions for this month")).toBeVisible();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(label).not.toHaveText(/– now$/);
  await expect(page.locator("main").getByText("Farmers Market").first()).toBeVisible();

  // Undo it: the month carries on.
  await page.getByRole("button", { name: "Reopen month" }).click();
  await expect(label).toHaveText(/– now$/);
  await expect(page.getByRole("button", { name: "Close month" })).toBeVisible();
  await expect(page.locator("main").getByText("Farmers Market").first()).toBeVisible();
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

test("voice input: off by default, turned on in Settings, speech lands in the chat box", async () => {
  await page.goto("/pf/transactions");
  await page.getByRole("button", { name: "Open AI assistant" }).click();
  await expect(page.getByPlaceholder("Ask me anything...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Speak your message" })).toHaveCount(0);

  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Voice input" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Ready — use the mic button/)).toBeVisible();
  // The engine warms up in the background and Settings says what it runs on.
  await expect(page.getByText("Runs on the GPU: Fake M1 (Metal)")).toBeVisible();
  await page.getByRole("radio", { name: "Urdu", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Urdu", exact: true })).toHaveAttribute(
    "aria-checked",
    "true"
  );

  await page.goto("/pf/transactions");
  const input = page.getByPlaceholder("Ask me anything...");
  if (!(await input.isVisible()))
    await page.getByRole("button", { name: "Open AI assistant" }).click();
  await page.getByRole("button", { name: "Speak your message" }).click();
  await expect(page.getByRole("button", { name: /Stop recording/ })).toBeVisible();
  // The words appear live, while still recording…
  await expect(input).toHaveValue("I spent 12 at Florist");
  await expect(page.getByRole("button", { name: /Stop recording/ })).toBeVisible();
  await page.getByRole("button", { name: /Stop recording/ }).click();
  // …and the final pass replaces them rather than adding them again. The
  // transcript is put in the box for the user to check — not sent.
  await expect(page.getByRole("button", { name: "Speak your message" })).toBeEnabled();
  await expect(input).toHaveValue("I spent 12 at Florist");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

  await input.press("Enter");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator("main").getByText("Florist").first()).toBeVisible();

  // Turning it off removes the mic.
  await page.goto("/settings");
  await page.getByRole("switch", { name: "Voice input" }).click();
  await expect(page.getByRole("switch", { name: "Voice input" })).toHaveAttribute(
    "aria-checked",
    "false"
  );
  await page.goto("/pf/transactions");
  if (!(await input.isVisible()))
    await page.getByRole("button", { name: "Open AI assistant" }).click();
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: "Speak your message" })).toHaveCount(0);
});

test("Settings shows the Google Drive backup card (desktop-only notice in the browser)", async () => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Backup to Google Drive" })).toBeVisible();
  await expect(page.getByText("Available in the Trivio desktop app.")).toBeVisible();
});

// A stubbed desktop bridge (the renderer sees window.trivioDesktop.backup).
// `calls` records restore() so tests can check what ran before it.
function stubDesktopBackup(statusOverrides: Record<string, unknown>) {
  return `
    window.__restoreCalls = [];
    const status = Object.assign({
      configured: true, connected: true, email: "me@example.test", passwordSet: true,
      running: null, lastSuccessAt: null, lastAttemptAt: null, lastCheckedAt: null,
      lastError: null, failingSince: null, keptCount: 1, restoreRollbackFailed: false,
    }, ${JSON.stringify(statusOverrides)});
    const ok = (value) => Promise.resolve({ ok: true, value });
    window.trivioDesktop = {
      isDesktop: true, platform: "darwin", versions: {}, openExternal() {}, openItem() {}, navigate() {},
      onDeepLink: () => () => {}, ollama: {},
      backup: {
        status: () => ok(status),
        connect: () => ok({ email: "me@example.test" }),
        disconnect: () => ok(undefined),
        setPassword: () => ok(undefined),
        backupNow: () => ok(status),
        list: () => ok([{ id: "b1", name: "n", createdAt: "2026-01-02T03:04:00Z", sizeBytes: 5000, appVersion: "1.0.0" }]),
        restore: (id, pw) => { window.__restoreCalls.push([id, pw]); return ok(undefined); },
        onProgress: () => () => {},
      },
    };`;
}

test("backup card after a failed restore rollback: alert shown, Restore hidden, backups still available", async () => {
  const p = await page.context().newPage();
  await p.addInitScript(stubDesktopBackup({ restoreRollbackFailed: true }));
  await p.goto("/settings");
  await expect(p.getByRole("alert").filter({ hasText: "Restores are paused" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Back up now" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Restore…" })).toHaveCount(0);
  await p.close();
});

test("register-page restore always asks to confirm before restoring", async ({ browser }) => {
  const context = await browser.newContext(); // logged out
  const p = await context.newPage();
  await p.addInitScript(stubDesktopBackup({}));
  await p.goto("/register");
  await p.getByRole("button", { name: "Restore from Google Drive" }).click();
  await p.locator("#restore-password").fill("hunter2hunter2");
  await p.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(p.getByText("all data on this computer", { exact: false }).first()).toBeVisible();
  expect(await p.evaluate(() => (window as unknown as { __restoreCalls: unknown[] }).__restoreCalls)).toEqual([]);
  await p.getByRole("button", { name: "Replace my data" }).click();
  await expect
    .poll(() => p.evaluate(() => (window as unknown as { __restoreCalls: unknown[] }).__restoreCalls))
    .toEqual([["b1", "hunter2hunter2"]]);
  await context.close();
});
