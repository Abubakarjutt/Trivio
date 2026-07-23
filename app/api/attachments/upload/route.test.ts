import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    attachment: { create: vi.fn() },
  },
}));
vi.mock("@/lib/storage", () => ({ saveFile: vi.fn().mockResolvedValue("org-1/att-1.jpg") }));
vi.mock("@/lib/queue", () => ({ extractionQueue: { add: vi.fn().mockResolvedValue({}) } }));
vi.mock("@/server/middleware/usageGate", () => ({
  assertCanExtract: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return { ...actual, randomUUID: vi.fn().mockReturnValue("test-uuid") };
});

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import { extractionQueue } from "@/lib/queue";
import { assertCanExtract } from "@/server/middleware/usageGate";

const mockAuth = vi.mocked(auth);
const mockFindUnique = vi.mocked(db.user.findUnique);
const mockAttachmentCreate = vi.mocked(db.attachment.create);
const mockSaveFile = vi.mocked(saveFile);
const mockQueueAdd = vi.mocked(extractionQueue.add);
const mockAssertCanExtract = vi.mocked(assertCanExtract);

function makeFileReq(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return new NextRequest("http://localhost/api/attachments/upload", {
    method: "POST",
    body: formData,
  });
}

const VALID_SESSION = { user: { id: "user-1" } };
const VALID_USER = { organisationId: "org-1" };
// JPEG magic bytes: ff d8 ff + padding so validateMagicBytes passes
const JPEG_CONTENT = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const VALID_FILE = new File([JPEG_CONTENT], "test.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveFile.mockResolvedValue("org-1/test-uuid.jpg");
  mockQueueAdd.mockResolvedValue({} as any);
  mockAssertCanExtract.mockResolvedValue(undefined);
  mockAttachmentCreate.mockResolvedValue({} as any);
});

describe("POST /api/attachments/upload", () => {
  it("returns 401 if no session", async () => {
    mockAuth.mockResolvedValue(null as any);
    const req = makeFileReq(VALID_FILE);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 if no org", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue({ organisationId: null } as any);
    const req = makeFileReq(VALID_FILE);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 if request body is not multipart", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    const req = new NextRequest("http://localhost/api/attachments/upload", {
      method: "POST",
      body: JSON.stringify({ foo: "bar" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 if no file field in FormData", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    const formData = new FormData();
    formData.append("other", "value");
    const req = new NextRequest("http://localhost/api/attachments/upload", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/file/i);
  });

  it("returns 422 for unsupported MIME type", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    const req = makeFileReq(file);
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/unsupported file type/i);
  });

  it("returns 422 if file is too large", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    // Create a buffer larger than 10MB and use it as file content
    const bigContent = Buffer.alloc(11 * 1024 * 1024, "x");
    const bigFile = new File([bigContent], "big.jpg", { type: "image/jpeg" });
    const req = makeFileReq(bigFile);
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
  });

  it("returns 403 if assertCanExtract throws", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    mockAssertCanExtract.mockRejectedValue(new Error("Limit reached"));
    const req = makeFileReq(VALID_FILE);
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/free plan limit/i);
  });

  it("returns 201 with attachmentId and status PENDING on success", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    const req = makeFileReq(VALID_FILE);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ attachmentId: "test-uuid", status: "PENDING" });
  });

  it("calls saveFile with correct args on success", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    const req = makeFileReq(VALID_FILE);
    await POST(req);
    expect(mockSaveFile).toHaveBeenCalledWith(
      "org-1",
      "test-uuid",
      "jpg",
      expect.any(Buffer),
    );
  });

  it("calls extractionQueue.add with correct jobId on success", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    const req = makeFileReq(VALID_FILE);
    await POST(req);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "extract",
      { attachmentId: "test-uuid", organisationId: "org-1", userId: "user-1" },
      { jobId: "test-uuid" },
    );
  });

  it("calls db.attachment.create with extractionStatus PENDING on success", async () => {
    mockAuth.mockResolvedValue(VALID_SESSION as any);
    mockFindUnique.mockResolvedValue(VALID_USER as any);
    const req = makeFileReq(VALID_FILE);
    await POST(req);
    expect(mockAttachmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "test-uuid",
          organisationId: "org-1",
          extractionStatus: "PENDING",
        }),
      }),
    );
  });
});
