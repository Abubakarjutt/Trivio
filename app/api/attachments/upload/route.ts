import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import { extractionQueue } from "@/lib/queue";
import { randomUUID } from "crypto";
import path from "path";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function validateMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (buf.length < 4) return false;
  switch (mimeType) {
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/png":
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case "image/webp":
      return buf.length >= 12 &&
        buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
    case "application/pdf":
      return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    default:
      return false;
  }
}
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export async function POST(request: NextRequest) {
  // Auth check
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve organisation
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { organisationId: true },
  });
  if (!user?.organisationId) {
    return NextResponse.json({ error: "No organisation" }, { status: 403 });
  }
  const organisationId = user.organisationId;

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const fileField = formData.get("file");
  if (!fileField || typeof fileField === "string") {
    return NextResponse.json({ error: "No file uploaded. Send a 'file' field." }, { status: 400 });
  }

  const file = fileField as File;

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type '${file.type}'. Allowed: JPEG, PNG, WebP, PDF.` },
      { status: 422 },
    );
  }

  // Validate size
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File too large. Maximum size is 10 MB, got ${(file.size / 1048576).toFixed(1)} MB.` },
      { status: 422 },
    );
  }

  // Read file bytes
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Validate magic bytes — reject files whose content doesn't match the declared MIME type
  const magic = validateMagicBytes(buffer, file.type);
  if (!magic) {
    return NextResponse.json(
      { error: "File content does not match the declared file type." },
      { status: 422 },
    );
  }

  // Derive extension from MIME type
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  const ext = extMap[file.type] ?? (path.extname(file.name).replace(".", "") || "bin");

  const attachmentId = randomUUID();

  // Save to disk
  const filePath = await saveFile(organisationId, attachmentId, ext, buffer);

  // Create DB record
  await db.attachment.create({
    data: {
      id: attachmentId,
      organisationId,
      s3Key: filePath, // repurposed to store relative fs path
      originalFilename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      extractionStatus: "PENDING",
    },
  });

  // Enqueue extraction job
  await extractionQueue.add(
    "extract",
    { attachmentId, organisationId, userId: session.user.id },
    { jobId: attachmentId },
  );

  return NextResponse.json({ attachmentId, status: "PENDING" }, { status: 201 });
}
