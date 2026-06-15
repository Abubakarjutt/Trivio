import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = process.env.NEXTAUTH_URL ?? "";

  if (!token) {
    return NextResponse.redirect(`${base}/login?error=invalid-token`);
  }

  const record = await db.emailVerificationToken.findUnique({ where: { token } });
  if (!record) {
    return NextResponse.redirect(`${base}/login?error=invalid-token`);
  }
  if (record.expires < new Date()) {
    await db.emailVerificationToken.delete({ where: { token } }).catch(() => {});
    return NextResponse.redirect(`${base}/login?error=expired-token`);
  }

  try {
    await db.$transaction([
      db.emailVerificationToken.delete({ where: { token } }),
      db.user.update({ where: { email: record.email }, data: { emailVerified: new Date() } }),
    ]);
  } catch {
    return NextResponse.redirect(`${base}/login?error=invalid-token`);
  }

  return NextResponse.redirect(`${base}/login?verified=1`);
}
