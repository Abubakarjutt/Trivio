import { Resend } from "resend";

const FROM = () => process.env.EMAIL_FROM ?? "Trivio <noreply@trivio-ai.com>";

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

async function send(payload: Parameters<Resend["emails"]["send"]>[0]): Promise<void> {
  const resend = getResend();
  if (!resend) { console.error("[resend] RESEND_API_KEY not set — email not sent", { to: payload.to, subject: payload.subject }); return; }
  const { error } = await resend.emails.send(payload);
  if (error) console.error("[resend] send failed", { to: payload.to, subject: payload.subject, error });
}

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  await send({
    from: FROM(),
    to: email,
    subject: "Reset your Trivio password",
    html: emailShell(`
      <h1 style="font-size: 1.5rem; font-weight: 600; margin: 0 0 8px;">Reset your password</h1>
      <p style="color: #6B7180; margin: 0 0 24px; line-height: 1.6;">
        We received a request to reset your password. Click the button below to choose a new one.
        This link expires in <strong>1 hour</strong>.
      </p>
      <a href="${resetUrl}" style="${btnStyle}">Reset password</a>
      <p style="${footerNote}">If you didn't request this, you can safely ignore this email.</p>
    `),
  });
}

export async function sendVerificationEmail(email: string, verifyUrl: string) {
  await send({
    from: FROM(),
    to: email,
    subject: "Verify your Trivio email address",
    html: emailShell(`
      <h1 style="font-size: 1.5rem; font-weight: 600; margin: 0 0 8px;">Verify your email</h1>
      <p style="color: #6B7180; margin: 0 0 24px; line-height: 1.6;">
        Thanks for signing up for Trivio. Click the button below to verify your email address.
        This link expires in <strong>24 hours</strong>.
      </p>
      <a href="${verifyUrl}" style="${btnStyle}">Verify email address</a>
      <p style="${footerNote}">If you didn't create a Trivio account, you can safely ignore this email.</p>
    `),
  });
}

export async function sendAlreadyRegisteredEmail(email: string) {
  const loginUrl = `${process.env.NEXTAUTH_URL ?? ""}/login`;
  await send({
    from: FROM(),
    to: email,
    subject: "Trivio: sign-in attempt on your account",
    html: emailShell(`
      <h1 style="font-size: 1.5rem; font-weight: 600; margin: 0 0 8px;">Someone tried to register with your email</h1>
      <p style="color: #6B7180; margin: 0 0 24px; line-height: 1.6;">
        A registration was attempted using this email address, but an account already exists.
        If this was you, sign in below. If not, no action is needed — your account is safe.
      </p>
      <a href="${loginUrl}" style="${btnStyle}">Sign in to Trivio</a>
      <p style="${footerNote}">If you didn't attempt to register, you can safely ignore this email.</p>
    `),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const btnStyle =
  "display:inline-block;background:#1A6644;color:#fff;padding:12px 24px;" +
  "border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9375rem;";

const footerNote = "color:#9CA3AF;font-size:0.8125rem;margin:24px 0 0;line-height:1.6;";

function emailShell(body: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0F1117;">
      <div style="margin-bottom:24px;">
        <span style="font-size:1.25rem;font-weight:600;letter-spacing:-0.01em;">Trivio</span>
      </div>
      ${body}
      <hr style="border:none;border-top:1px solid #E4E1D8;margin:24px 0;" />
      <p style="color:#9CA3AF;font-size:0.75rem;margin:0;">© 2026 Trivio</p>
    </div>
  `;
}
