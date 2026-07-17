/**
 * Regression tests for lib/resend.ts
 *
 * Before the fix, resend.emails.send() errors were silently swallowed.
 * A 403 "domain not verified" response caused all emails to fail with no log.
 * These tests verify the shared send() helper logs errors correctly.
 *
 * Strategy: the Resend SDK uses global `fetch`. Mocking fetch is simpler than
 * mocking the class constructor and avoids vi.mock hoisting issues entirely.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendVerificationEmail, sendPasswordResetEmail, sendAlreadyRegisteredEmail } from "@/lib/resend";

// ─────────────────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown) {
  const json = JSON.stringify(body);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(json, {
        status,
        headers: { "Content-Type": "application/json" },
      })
    )
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("resend send() helper — missing API key", () => {
  it("logs console.error when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;
    await sendVerificationEmail("user@example.com", "https://example.com/verify?token=abc");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("RESEND_API_KEY not set"),
      expect.objectContaining({ to: "user@example.com" })
    );
  });

  it("does not throw when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(
      sendVerificationEmail("user@example.com", "https://example.com/verify?token=abc")
    ).resolves.toBeUndefined();
  });
});

describe("resend send() helper — API errors", () => {
  it("logs console.error when resend returns a 403 domain-not-verified error", async () => {
    mockFetch(403, {
      statusCode: 403,
      name: "validation_error",
      message: "The domain is not verified. Please add and verify your domain on https://resend.com/domains",
    });

    await sendVerificationEmail("user@example.com", "https://example.com/verify?token=abc");

    expect(console.error).toHaveBeenCalledWith(
      "[resend] send failed",
      expect.objectContaining({
        to: "user@example.com",
        error: expect.objectContaining({ name: "validation_error" }),
      })
    );
  });

  it("logs console.error when resend returns a rate-limit error", async () => {
    mockFetch(429, {
      statusCode: 429,
      name: "rate_limit_exceeded",
      message: "Too many requests. Please try again later.",
    });

    await sendPasswordResetEmail("user@example.com", "https://example.com/reset?token=xyz");

    expect(console.error).toHaveBeenCalledWith(
      "[resend] send failed",
      expect.objectContaining({ error: expect.objectContaining({ name: "rate_limit_exceeded" }) })
    );
  });

  it("does not throw when resend.emails.send() returns an error", async () => {
    mockFetch(403, {
      statusCode: 403,
      name: "validation_error",
      message: "The domain is not verified.",
    });

    await expect(
      sendAlreadyRegisteredEmail("user@example.com")
    ).resolves.toBeUndefined();
  });
});

describe("resend send() helper — success path", () => {
  it("does not log errors when send succeeds", async () => {
    mockFetch(200, { id: "email-abc" });

    await sendVerificationEmail("user@example.com", "https://example.com/verify?token=abc");

    expect(console.error).not.toHaveBeenCalled();
  });
});
