import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import { authRateLimiter } from "@/server/middleware/rateLimit";

const JWT_EXPIRY = "30d";

export async function POST(req: NextRequest) {
  const _secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!_secret) throw new Error("AUTH_SECRET env var is required");
  const JWT_SECRET = new TextEncoder().encode(_secret);

  try {
    const body = await req.json() as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    try {
      await authRateLimiter(`mobile-login:${ip}`);
    } catch {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
    }

    const normalised = email.toLowerCase().trim();

    const user = await db.user.findUnique({
      where: { email: normalised },
      include: { organisation: true },
    });

    if (!user?.hashedPassword) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    // Reject unverified accounts unless this deployment has disabled email
    // verification (single-tenant desktop install — see ~/.trivio/.env).
    const skipVerification = process.env.SKIP_EMAIL_VERIFICATION === "true";
    if (!skipVerification && !user.emailVerified) {
      return NextResponse.json({ error: "Please verify your email before logging in." }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.hashedPassword);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const orgId = user.organisationId ?? user.organisation?.id;

    const token = await new SignJWT({ sub: user.id, email: user.email, orgId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(JWT_EXPIRY)
      .sign(JWT_SECRET);

    return NextResponse.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("[mobile/auth/login]", err);
    return NextResponse.json({ error: "Login failed. Please try again." }, { status: 500 });
  }
}
