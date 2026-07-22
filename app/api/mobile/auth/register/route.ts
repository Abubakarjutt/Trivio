import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { db } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "fallback-secret"
);
const JWT_EXPIRY = "30d";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { name?: string; email?: string; password?: string; currency?: string };
    const { name, email, password, currency = "USD" } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email and password are required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const normalised = email.toLowerCase().trim();

    const existing = await db.user.findUnique({ where: { email: normalised } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Create organisation + user in one transaction
    const org = await db.organisation.create({
      data: {
        name: `${name.trim()}'s Organisation`,
        currency,
        onboardingComplete: false,
        users: {
          create: {
            name: name.trim(),
            email: normalised,
            hashedPassword,
            // Mobile registrations skip email verification
            emailVerified: new Date(),
            role: "OWNER",
          },
        },
      },
      include: { users: true },
    });

    const user = org.users[0];

    const token = await new SignJWT({ sub: user.id, email: user.email, orgId: org.id })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(JWT_EXPIRY)
      .sign(JWT_SECRET);

    return NextResponse.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("[mobile/auth/register]", err);
    return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 500 });
  }
}
