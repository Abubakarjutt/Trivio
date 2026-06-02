// cloudflare/email-worker/payload.ts
import PostalMime from "postal-mime";

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: number[]; // byte array — JSON-serialisable
}

export interface InboundEmailPayload {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}

/**
 * Parse a raw email buffer (ArrayBuffer) into a structured payload
 * ready to POST to the Next.js inbound webhook.
 *
 * Pure function — no Cloudflare runtime APIs needed. Fully testable with Vitest.
 */
export async function buildPayload(
  raw: ArrayBuffer,
  to: string,
  from: string,
): Promise<InboundEmailPayload> {
  const parsed = await new PostalMime().parse(raw);

  return {
    to,
    from,
    subject: parsed.subject ?? "",
    text: parsed.text ?? "",
    html: parsed.html ?? "",
    attachments: (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? "",
      mimeType: a.mimeType ?? "application/octet-stream",
      content: Array.from(new Uint8Array(a.content as ArrayBuffer)),
    })),
  };
}
