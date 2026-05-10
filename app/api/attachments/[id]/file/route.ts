import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { readFile } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;

  // Verify attachment belongs to user's organisation
  const attachment = await db.attachment.findFirst({
    where: { id, organisationId: user.organisationId },
    select: { s3Key: true, mimeType: true, originalFilename: true },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  // Read file from disk
  let buffer: Buffer;
  try {
    buffer = await readFile(attachment.s3Key);
  } catch {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  // Sanitize filename for Content-Disposition header
  const safeName = attachment.originalFilename.replace(/[^\w.\-]/g, "_");

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
