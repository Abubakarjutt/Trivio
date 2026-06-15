import { Resend } from "resend";

export async function sendPasswordResetEmail(email: string, resetUrl: string) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[resend] RESEND_API_KEY not set — skipping password reset email");
    return;
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Trivio <noreply@trivio-ai.com>",
    to: email,
    subject: "Reset your Trivio password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0F1117;">
        <div style="margin-bottom: 24px;">
          <span style="font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em;">Trivio</span>
        </div>
        <h1 style="font-size: 1.5rem; font-weight: 600; margin: 0 0 8px;">Reset your password</h1>
        <p style="color: #6B7180; margin: 0 0 24px; line-height: 1.6;">
          We received a request to reset your password. Click the button below to choose a new one.
          This link expires in <strong>1 hour</strong>.
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; background: #1A6644; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 0.9375rem;">
          Reset password
        </a>
        <p style="color: #9CA3AF; font-size: 0.8125rem; margin: 24px 0 0; line-height: 1.6;">
          If you didn't request this, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #E4E1D8; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 0.75rem; margin: 0;">© 2026 Trivio</p>
      </div>
    `,
  });
}
