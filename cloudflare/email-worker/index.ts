// cloudflare/email-worker/index.ts
import { buildPayload } from "./payload";

interface Env {
  APP_URL: string;       // https://app.trivio-ai.com
  WEBHOOK_SECRET: string;
}

export default {
  async email(
    message: { raw: ReadableStream; to: string; from: string },
    env: Env,
  ): Promise<void> {
    // Read the raw email stream into an ArrayBuffer
    const raw = await new Response(message.raw).arrayBuffer();

    const payload = await buildPayload(raw, message.to, message.from);

    // Fire-and-forget — Cloudflare retries on 5xx but we always return 200 from Next.js
    await fetch(`${env.APP_URL}/api/email/inbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": env.WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });
  },
};
