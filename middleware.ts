import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Exact match for "/" and prefix match for everything else
const PUBLIC_PREFIXES = ["/login", "/register", "/forgot-password", "/reset-password", "/privacy", "/api/auth", "/api/trpc", "/api/chat", "/pricing", "/api/webhooks"];
const ONBOARDING_ROUTE = "/onboarding";
const DASHBOARD_ROUTE = "/dashboard";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/" || PUBLIC_PREFIXES.some((r) => pathname.startsWith(r));
  const isAuthenticated = !!req.auth;

  if (!isAuthenticated && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
