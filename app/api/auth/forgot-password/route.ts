import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/resend";
import { authRateLimiter } from "@/server/middleware/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    const normalised = email.toLowerCase().trim();

    // Rate-limit by IP to prevent email flooding and user enumeration via timing
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    try {
      authRateLimiter(`forgot-password:${ip}`);
    } catch {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
    }

    const appUrl = process.env.NEXTAUTH_URL;
    if (!appUrl) {
      console.error("[forgot-password] NEXTAUTH_URL is not set");
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
    const user = await db.user.findFirst({ where: { email: { equals: normalised, mode: "insensitive" } } });
    if (!user) {
      // Always return success to prevent user enumeration — do NOT short-circuit early
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
