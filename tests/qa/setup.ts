// Per-test-file setup for the QA suite: point Prisma at the throwaway
// database, stub the services a desktop install doesn't run locally (Redis,
// BullMQ, file storage), and record which procedures this file exercised.
import { afterAll, inject, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL = inject("qaDatabaseUrl");
// Match the shipped desktop build: no IP rate limiting, instant sign-up.
process.env.TRIVIO_DESKTOP_EMBEDDED = "true";
process.env.SKIP_EMAIL_VERIFICATION = "true";
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_SECRET_KEY;

vi.mock("@/lib/redis", () => ({
  redis: { incr: vi.fn(), pexpire: vi.fn(), pttl: vi.fn(), get: vi.fn(), set: vi.fn() },
}));
vi.mock("@/lib/queue", () => ({ extractionQueue: { add: vi.fn() } }));
vi.mock("@/lib/storage", () => {
  const files = new Map<string, Buffer>();
  return {
    getAttachmentPath: (org: string, id: string, ext: string) => `attachments/${org}/${id}.${ext}`,
    ensureDir: vi.fn(),
    saveFile: vi.fn(async (org: string, id: string, ext: string, buf: Buffer) => {
      const key = `attachments/${org}/${id}.${ext}`;
      files.set(key, buf);
      return key;
    }),
    readFile: vi.fn(async (key: string) => files.get(key) ?? Buffer.from("")),
    deleteFile: vi.fn(async (key: string) => void files.delete(key)),
  };
});

afterAll(async () => {
  const { allProcedures, covered } = await import("./harness");
  const dir = inject("qaCoverageDir");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${randomUUID()}.json`),
    JSON.stringify({ all: allProcedures(), covered: [...covered] })
  );
});
