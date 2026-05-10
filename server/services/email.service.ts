import nodemailer from "nodemailer";

// Creates a transporter: Mailhog for local dev, SMTP for prod
function createTransporter() {
  if (process.env.RESEND_API_KEY) {
    // Resend SMTP relay
    return nodemailer.createTransport({
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: { user: "resend", pass: process.env.RESEND_API_KEY },
    });
  }

  // Local Mailhog
  return nodemailer.createTransport({
    host: "localhost",
    port: 1025,
    secure: false,
    ignoreTLS: true,
  });
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
  const transporter = createTransporter();
  const from = process.env.EMAIL_FROM ?? "AutoAccounts <noreply@autoaccounts.app>";

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Invoice ${params.invoiceNumber}</title></head>
    <body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 24px;">
        <h1 style="color: #1e40af; margin: 0;">Invoice ${params.invoiceNumber}</h1>
      </div>
      <p>Dear ${params.toName},</p>
      <p>Please find your invoice details below from <strong>${params.fromName}</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background: #f3f4f6;">
          <td style="padding: 10px; font-weight: bold; border: 1px solid #e5e7eb;">Invoice Number</td>
          <td style="padding: 10px; border: 1px solid #e5e7eb;">${params.invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 10px; font-weight: bold; border: 1px solid #e5e7eb;">Invoice Date</td>
          <td style="padding: 10px; border: 1px solid #e5e7eb;">${params.invoiceDate}</td>
        </tr>
        <tr style="background: #f3f4f6;">
          <td style="padding: 10px; font-weight: bold; border: 1px solid #e5e7eb;">Due Date</td>
          <td style="padding: 10px; border: 1px solid #e5e7eb;">${params.dueDate}</td>
        </tr>
        <tr>
          <td style="padding: 10px; font-weight: bold; border: 1px solid #e5e7eb;">Amount Due</td>
          <td style="padding: 10px; border: 1px solid #e5e7eb; font-size: 1.1em; color: #1e40af;">
            <strong>${params.totalAmount} ${params.currency}</strong>
          </td>
        </tr>
      </table>
      ${params.pdfBuffer ? "<p>The invoice PDF is attached to this email.</p>" : ""}
      <p style="color: #6b7280; font-size: 0.9em; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
        This email was sent by AutoAccounts on behalf of ${params.fromName}.
      </p>
    </body>
    </html>
  `;

  const mailOptions: nodemailer.SendMailOptions = {
    from,
    to: `${params.toName} <${params.to}>`,
    subject: `Invoice ${params.invoiceNumber} from ${params.fromName} — Due ${params.dueDate}`,
    html,
  };

  if (params.pdfBuffer) {
    mailOptions.attachments = [
      {
        filename: `${params.invoiceNumber}.pdf`,
        content: params.pdfBuffer,
        contentType: "application/pdf",
      },
    ];
  }

  await transporter.sendMail(mailOptions);
}
