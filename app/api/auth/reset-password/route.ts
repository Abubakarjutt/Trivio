import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();
    if (!token || !password || typeof token !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    const resetToken = await db.passwordResetToken.findUnique({ where: { token } });
    if (!resetToken) {
      return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
    }
    if (resetToken.expires < new Date()) {
      await db.passwordResetToken.delete({ where: { token } });
      return NextResponse.json({ error: "Reset link has expired. Please request a new one." }, { status: 400 });
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    // Use a transaction: atomically delete the token and update the password.
    // If a concurrent request already consumed the token, the delete will throw
    // (record not found), preventing double-use.
    try {
      await db.$transaction([
        db.passwordResetToken.delete({ where: { token } }),
        db.user.update({ where: { email: resetToken.email }, data: { hashedPassword } }),
      ]);
    } catch {
      // Token was already consumed by a concurrent request
      return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[reset-password]", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
