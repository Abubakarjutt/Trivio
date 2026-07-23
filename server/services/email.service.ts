import { Resend } from "resend";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export interface SendInvoiceEmailParams {
  to: string;
  toName: string;
  fromName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string;
  currency: string;
  pdfBuffer?: Buffer;
}

export async function sendInvoiceEmail(params: SendInvoiceEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping email send");
    return;
  }

  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM ?? "AutoAccounts <noreply@autoaccounts.app>";

  // Escape all user-supplied values before rendering into HTML
  const safe = {
    toName:        escapeHtml(params.toName),
    fromName:      escapeHtml(params.fromName),
    invoiceNumber: escapeHtml(params.invoiceNumber),
    invoiceDate:   escapeHtml(params.invoiceDate),
    dueDate:       escapeHtml(params.dueDate),
    totalAmount:   escapeHtml(params.totalAmount),
    currency:      escapeHtml(params.currency),
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Invoice ${safe.invoiceNumber}</title></head>
    <body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 24px;">
        <h1 style="color: #1e40af; margin: 0;">Invoice ${safe.invoiceNumber}</h1>
      </div>
      <p>Dear ${safe.toName},</p>
      <p>Please find your invoice details below from <strong>${safe.fromName}</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background: #f3f4f6;">
          <td style="padding: 10px; font-weight: bold; border: 1px solid #e5e7eb;">Invoice Number</td>
          <td style="padding: 10px; border: 1px solid #e5e7eb;">${safe.invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 10px; font-weight: bold; border: 1px solid #e5e7eb;">Invoice Date</td>
          <td style="padding: 10px; border: 1px solid #e5e7eb;">${safe.invoiceDate}</td>
        </tr>
        <tr style="background: #f3f4f6;">
          <td style="padding: 10px; font-weight: bold; border: 1px solid #e5e7eb;">Due Date</td>
          <td style="padding: 10px; border: 1px solid #e5e7eb;">${safe.dueDate}</td>
        </tr>
        <tr>
          <td style="padding: 10px; font-weight: bold; border: 1px solid #e5e7eb;">Amount Due</td>
          <td style="padding: 10px; border: 1px solid #e5e7eb; font-size: 1.1em; color: #1e40af;">
            <strong>${safe.totalAmount} ${safe.currency}</strong>
          </td>
        </tr>
      </table>
      ${params.pdfBuffer ? "<p>The invoice PDF is attached to this email.</p>" : ""}
      <p style="color: #6b7280; font-size: 0.9em; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
        This email was sent by AutoAccounts on behalf of ${safe.fromName}.
      </p>
    </body>
    </html>
  `;

  const attachments = params.pdfBuffer
    ? [{ filename: `${params.invoiceNumber}.pdf`, content: params.pdfBuffer }]
    : [];

  await resend.emails.send({
    from,
    to: [`${params.toName} <${params.to}>`],
    subject: `Invoice ${params.invoiceNumber} from ${params.fromName} — Due ${params.dueDate}`,
    html,
    attachments,
  });
}
