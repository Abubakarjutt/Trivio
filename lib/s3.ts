import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  endpoint: process.env.AWS_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true, // required for MinIO
});

export const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "autoaccounts";

/** Generate a pre-signed PUT URL for direct browser upload */
export async function getUploadUrl(key: string, mimeType: string, expiresIn = 300) {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: mimeType,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

/** Generate a pre-signed GET URL for file download/preview */
export async function getDownloadUrl(key: string, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

/** Fetch raw file bytes from S3 (for AI processing) */
export async function getFileBuffer(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  const response = await s3.send(command);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Delete a file from S3 */
export async function deleteFile(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}
