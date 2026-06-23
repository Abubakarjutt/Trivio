import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    attachment: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/storage", () => ({ readFile: vi.fn() }));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { readFile } from "@/lib/storage";

const mockAuth = vi.mocked(auth);
const mockFindUnique = vi.mocked(db.user.findUnique);
const mockFindFirst = vi.mocked(db.attachment.findFirst);
const mockReadFile = vi.mocked(readFile);

const VALID_SESSION = { user: { id: "user-1" } };
const VALID_USER = { organisationId: "org-1" };
const VALID_ATTACHMENT = {
  s3Key: "org-1/att-1.jpg",
  mimeType: "image/jpeg",
  originalFilename: "filename.jpg",
};
const FILE_BYTES = Buffer.from("fake-image-bytes");

function makeReq() {
  return new NextRequest("http://localhost/api/attachments/att-1/file");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/attachments/[id]/file", () => {
  it("returns 401 if no session", async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "att-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 if no org", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue({ organisationId: null } as any);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "att-1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 if attachment not found in DB", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockFindFirst.mockResolvedValue(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "att-1" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/attachment not found/i);
  });

  it("returns 404 if file not found on disk", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockFindFirst.mockResolvedValue(VALID_ATTACHMENT as any);
    mockReadFile.mockRejectedValue(new Error("ENOENT: file not found"));
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "att-1" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/file not found on disk/i);
  });

  it("returns 200 with correct Content-Type header", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockFindFirst.mockResolvedValue(VALID_ATTACHMENT as any);
    mockReadFile.mockResolvedValue(FILE_BYTES);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "att-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("returns 200 with correct Content-Disposition header", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockFindFirst.mockResolvedValue(VALID_ATTACHMENT as any);
    mockReadFile.mockResolvedValue(FILE_BYTES);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "att-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="filename.jpg"');
  });

  it("returns 200 with correct binary content", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockFindFirst.mockResolvedValue(VALID_ATTACHMENT as any);
    mockReadFile.mockResolvedValue(FILE_BYTES);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "att-1" }) });
    expect(res.status).toBe(200);
    const arrayBuffer = await res.arrayBuffer();
    expect(Buffer.from(arrayBuffer)).toEqual(FILE_BYTES);
  });
});
