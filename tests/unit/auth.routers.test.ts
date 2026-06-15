/**
 * Auth router tests
 *
 * Tests register and me procedures directly via createCallerFactory with
 * fully mocked Prisma and rate-limiter — no DB connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

// Mock rate limiter so we can control allowed/denied per test
vi.mock("@/server/middleware/rateLimit", () => ({
  registerRateLimiter: vi.fn().mockReturnValue({ allowed: true, retryAfterSec: 0 }),
}));

// Mock bcrypt to avoid slow CPU hashing in unit tests
vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password"),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

// Mock DB — user.findUnique and user.create are the only methods auth.ts touches
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { createCallerFactory } from "@/server/trpc";
import { authRouter } from "@/server/routers/auth";
import { db } from "@/lib/db";
import { registerRateLimiter } from "@/server/middleware/rateLimit";

// ── Typed mock handles ────────────────────────────────────────────────────────

const mockFindUnique = db.user.findUnique as ReturnType<typeof vi.fn>;
const mockCreate = db.user.create as ReturnType<typeof vi.fn>;
const mockRateLimiter = registerRateLimiter as ReturnType<typeof vi.fn>;

// ── Caller factories ──────────────────────────────────────────────────────────

const createCaller = createCallerFactory(authRouter);

/** Caller without a session (for publicProcedure endpoints like register) */
function makePublicCaller() {
  return createCaller({
    session: null,
    db: db as any,
    ip: "127.0.0.1",
  });
}

/** Caller with a session (for protectedProcedure endpoints like me) */
function makeAuthedCaller(userId = "user-1") {
  return createCaller({
    session: { user: { id: userId, email: "u@test.com", name: "Test User" } } as any,
    db: db as any,
    ip: "127.0.0.1",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: rate limiter allows requests
  mockRateLimiter.mockReturnValue({ allowed: true, retryAfterSec: 0 });
});

// ─────────────────────────────────────────────────────────────────────────────
// authRouter.register
// ─────────────────────────────────────────────────────────────────────────────

describe("authRouter.register", () => {
  const validInput = {
    name: "Alice",
    email: "alice@example.com",
    password: "secure123",
  };

  it("returns {id, email} on successful registration", async () => {
    mockFindUnique.mockResolvedValue(null); // no existing user
    mockCreate.mockResolvedValue({ id: "user-new", email: validInput.email });

    const caller = makePublicCaller();
    const result = await caller.register(validInput);

    expect(result).toEqual({ id: "user-new", email: validInput.email });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("hashes the password before storing", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "user-new", email: validInput.email });

    const caller = makePublicCaller();
    await caller.register(validInput);

    const createData = mockCreate.mock.calls[0][0].data;
    expect(createData.hashedPassword).toBe("hashed-password");
    // Raw password must NOT be stored
    expect(createData).not.toHaveProperty("password");
  });

  it("throws TOO_MANY_REQUESTS when rate-limited", async () => {
    mockRateLimiter.mockReturnValue({ allowed: false, retryAfterSec: 42 });

    const caller = makePublicCaller();
    await expect(caller.register(validInput)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    // DB should never be queried when rate-limited
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("throws CONFLICT when email is already registered", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing-user" });

    const caller = makePublicCaller();
    await expect(caller.register(validInput)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Email already registered",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws ZodError for password shorter than 8 characters", async () => {
    const caller = makePublicCaller();
    await expect(
      caller.register({ ...validInput, password: "short" })
    ).rejects.toThrow();
    // No DB access on validation error
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("throws ZodError for invalid email address", async () => {
    const caller = makePublicCaller();
    await expect(
      caller.register({ ...validInput, email: "not-an-email" })
    ).rejects.toThrow();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("throws ZodError when name is empty string", async () => {
    const caller = makePublicCaller();
    await expect(
      caller.register({ ...validInput, name: "" })
    ).rejects.toThrow();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// authRouter.me
// ─────────────────────────────────────────────────────────────────────────────

describe("authRouter.me", () => {
  it("returns the user with nested organisation when found", async () => {
    const userWithOrg = {
      id: "user-1",
      email: "u@test.com",
      name: "Test User",
      organisation: {
        id: "org-1",
        name: "Test Org",
        taxRegime: {
          id: "regime-1",
          name: "Standard",
          rates: [{ id: "rate-1", rate: 0.2 }],
        },
      },
    };
    mockFindUnique.mockResolvedValue(userWithOrg);

    const caller = makeAuthedCaller("user-1");
    const result = await caller.me();

    expect(result).toEqual(userWithOrg);
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } })
    );
  });

  it("returns null when user is not found in DB", async () => {
    mockFindUnique.mockResolvedValue(null);

    const caller = makeAuthedCaller("user-ghost");
    const result = await caller.me();

    expect(result).toBeNull();
  });

  it("throws UNAUTHORIZED when called without a session", async () => {
    const caller = makePublicCaller(); // no session
    await expect((caller as any).me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
