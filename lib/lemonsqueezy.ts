import crypto from "crypto";

const CHECKOUT_BASE = `https://trivio-ai.lemonsqueezy.com/checkout/buy/${process.env.LEMONSQUEEZY_CHECKOUT_UUID}`;

export function buildCheckoutUrl(email: string, orgId: string): string {
  const params = new URLSearchParams({
    "checkout[email]": email,
    "checkout[custom][org_id]": orgId,
  });
  return `${CHECKOUT_BASE}?${params.toString()}`;
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}
