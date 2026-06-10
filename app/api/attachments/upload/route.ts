import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import { extractionQueue } from "@/lib/queue";
import { assertCanExtract } from "@/server/middleware/usageGate";
import { randomUUID } from "crypto";
import path from "path";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
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

  // Enforce free-tier AI extraction limit before doing any work
  try {
    await assertCanExtract(db, organisationId);
  } catch {
    return NextResponse.json(
      { error: "Free plan limit reached: 3 AI extractions per month. Upgrade to Pro for unlimited extractions." },
      { status: 403 }
    );
  }

  // Read file bytes
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

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
