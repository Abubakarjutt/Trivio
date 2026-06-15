/**
 * forgot-password API route tests
 *
 * Tests the POST handler in app/api/auth/forgot-password/route.ts directly.
 * All external dependencies are mocked — no DB, email, or network calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── mocks (must be before the import of the handler) ─────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findFirst: vi.fn(),
    },
    passwordResetToken: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({
        token: "mock-reset-token-uuid",
        email: "user@example.com",
        expires: new Date(Date.now() + 3600_000),
      }),
    },
  },
}));

vi.mock("@/lib/resend", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

// Rate limiter: default pass-through; individual tests can override
vi.mock("@/server/middleware/rateLimit", () => ({
  authRateLimiter: vi.fn(),
}));

import { POST } from "@/app/api/auth/forgot-password/route";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/resend";
import { authRateLimiter } from "@/server/middleware/rateLimit";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const mockUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Test User",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Restore env var for each test
  process.env.NEXTAUTH_URL = "https://app.example.com";
  // Ensure rate limiter passes by default (individual tests override when testing 429)
  vi.mocked(authRateLimiter).mockImplementation(() => Promise.resolve());
  // Restore default db mock implementations
  vi.mocked(db.user.findFirst).mockResolvedValue(null);
  vi.mocked(db.passwordResetToken.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(db.passwordResetToken.create).mockResolvedValue({
    token: "mock-reset-token-uuid",
    email: "user@example.com",
    expires: new Date(Date.now() + 3600_000),
  } as never);
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("POST /api/auth/forgot-password", () => {
  it("returns 400 when email is missing", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/email is required/i);
  });

  it("returns 400 when email is not a string", async () => {
    const req = makeRequest({ email: 42 });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/email is required/i);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    vi.mocked(authRateLimiter).mockImplementation(() => Promise.reject(new Error("Rate limit exceeded")));
    const req = makeRequest({ email: "user@example.com" });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/too many requests/i);
  });

  it("returns 500 when NEXTAUTH_URL is not set", async () => {
    delete process.env.NEXTAUTH_URL;
    // User must be found to reach the NEXTAUTH_URL check (user-not-found short-circuits earlier)
    vi.mocked(db.user.findFirst).mockResolvedValue(mockUser as never);
    const req = makeRequest({ email: "user@example.com" });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("returns success even when user is not found (anti-enumeration)", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    const req = makeRequest({ email: "nobody@example.com" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("does NOT send email when user is not found", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    const req = makeRequest({ email: "nobody@example.com" });
    await POST(req);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns success when user is found and email is sent", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(mockUser as never);
    const req = makeRequest({ email: "user@example.com" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("deletes existing password reset tokens before creating a new one", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(mockUser as never);
    const req = makeRequest({ email: "user@example.com" });
    await POST(req);
    expect(db.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
    });
  });

  it("creates a new password reset token with 1-hour expiry", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(mockUser as never);
    const req = makeRequest({ email: "user@example.com" });
    const before = Date.now();
    await POST(req);
    const after = Date.now();
    expect(db.passwordResetToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "user@example.com",
          expires: expect.any(Date),
        }),
      })
    );
    const createdExpiry = vi.mocked(db.passwordResetToken.create).mock.calls[0][0].data.expires as Date;
    expect(createdExpiry.getTime()).toBeGreaterThanOrEqual(before + 3590_000);
    expect(createdExpiry.getTime()).toBeLessThanOrEqual(after + 3610_000);
  });

  it("sends password reset email with correct reset URL", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(mockUser as never);
    const req = makeRequest({ email: "user@example.com" });
    await POST(req);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.stringContaining("/reset-password?token=mock-reset-token-uuid")
    );
  });

  it("normalises email to lowercase before lookup", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    const req = makeRequest({ email: "User@EXAMPLE.COM" });
    await POST(req);
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: expect.objectContaining({ equals: "user@example.com" }),
        }),
      })
    );
  });

  it("trims whitespace from email before lookup", async () => {
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    const req = makeRequest({ email: "  user@example.com  " });
    await POST(req);
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: expect.objectContaining({ equals: "user@example.com" }),
        }),
      })
    );
  });

  it("returns 500 when an unexpected error occurs", async () => {
    vi.mocked(db.user.findFirst).mockRejectedValue(new Error("DB connection lost"));
    const req = makeRequest({ email: "user@example.com" });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Something went wrong");
  });
});
