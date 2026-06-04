import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/resend";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    const normalised = email.toLowerCase().trim();
    const appUrl = process.env.NEXTAUTH_URL;
    if (!appUrl) {
      console.error("[forgot-password] NEXTAUTH_URL is not set");
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
    const user = await db.user.findFirst({ where: { email: { equals: normalised, mode: "insensitive" } } });
    if (!user) {
      return NextResponse.json({ success: true });
    }
    await db.passwordResetToken.deleteMany({ where: { email: normalised } });
    const token = await db.passwordResetToken.create({
      data: { email: normalised, expires: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const resetUrl = `${appUrl}/reset-password?token=${token.token}`;
    await sendPasswordResetEmail(normalised, resetUrl);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[forgot-password]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
