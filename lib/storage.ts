import path from "path";
import fs from "fs/promises";

const STORAGE_ROOT = path.join(process.cwd(), "storage");

/**
 * Returns the absolute path for an attachment file.
 * The relative path stored in DB (s3Key) looks like: attachments/{orgId}/{id}.{ext}
 */
export function getAttachmentPath(
  organisationId: string,
  attachmentId: string,
  ext: string,
): string {
  return path.join(STORAGE_ROOT, "attachments", organisationId, `${attachmentId}.${ext}`);
}

/**
 * Ensures the per-org storage directory exists.
 */
export async function ensureDir(organisationId: string): Promise<void> {
  const dir = path.join(STORAGE_ROOT, "attachments", organisationId);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Saves a file buffer to disk and returns the relative path stored in the DB.
 */
export async function saveFile(
  organisationId: string,
  attachmentId: string,
  ext: string,
  buffer: Buffer,
): Promise<string> {
  await ensureDir(organisationId);
  const absolutePath = getAttachmentPath(organisationId, attachmentId, ext);
  await fs.writeFile(absolutePath, buffer);
  // Return the relative path to be stored as s3Key
  return `attachments/${organisationId}/${attachmentId}.${ext}`;
}

/**
 * Reads a file from disk. filePath is the relative path (as stored in s3Key).
 */
export async function readFile(filePath: string): Promise<Buffer> {
  const absolutePath = path.resolve(STORAGE_ROOT, filePath);
  if (!absolutePath.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("Path traversal detected");
  }
  return fs.readFile(absolutePath);
}

/**
 * Deletes a file from disk. filePath is the relative path (as stored in s3Key).
 */
export async function deleteFile(filePath: string): Promise<void> {
  const absolutePath = path.resolve(STORAGE_ROOT, filePath);
  if (!absolutePath.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error("Path traversal detected");
  }
  try {
    await fs.unlink(absolutePath);
  } catch (err: unknown) {
    // Ignore "file not found" errors — idempotent delete
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
