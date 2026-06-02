// cloudflare/email-worker/payload.test.ts
import { describe, it, expect } from "vitest";
import { buildPayload } from "./payload";

// Minimal raw email helper — encodes a plain text email as ArrayBuffer
function rawEmail(options: {
  to?: string;
  from?: string;
  subject?: string;
  body?: string;
  contentType?: string;
}): ArrayBuffer {
  const lines = [
    `To: ${options.to ?? "abc@import.trivio-ai.com"}`,
    `From: ${options.from ?? "bank@example.com"}`,
    `Subject: ${options.subject ?? "Transaction Alert"}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${options.contentType ?? "text/plain; charset=utf-8"}`,
    ``,
    options.body ?? "You spent $12.50 at Starbucks",
  ].join("\r\n");
  return new TextEncoder().encode(lines).buffer;
}

describe("buildPayload", () => {
  it("extracts to, from, subject, and text body from a plain-text email", async () => {
    const raw = rawEmail({
      to: "token123@import.trivio-ai.com",
      from: "alerts@mybank.com",
      subject: "You spent $45.00",
      body: "Transaction: $45.00 at Amazon on 2024-01-15",
    });

    const payload = await buildPayload(raw, "token123@import.trivio-ai.com", "alerts@mybank.com");

    expect(payload.to).toBe("token123@import.trivio-ai.com");
    expect(payload.from).toBe("alerts@mybank.com");
    expect(payload.subject).toBe("You spent $45.00");
    expect(payload.text).toContain("$45.00");
    expect(payload.attachments).toHaveLength(0);
  });

  it("returns empty string for missing text body", async () => {
    const raw = rawEmail({ body: "" });
    const payload = await buildPayload(raw, "x@import.trivio-ai.com", "bank@example.com");
    expect(payload.text).toBe("");
  });

  it("returns empty arrays for an email with no attachments", async () => {
    const raw = rawEmail({});
    const payload = await buildPayload(raw, "x@import.trivio-ai.com", "bank@example.com");
    expect(payload.attachments).toEqual([]);
  });
});
