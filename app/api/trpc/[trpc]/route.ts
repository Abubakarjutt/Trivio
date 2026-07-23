import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { appRouter } from "@/server/root";
import { createTRPCContext } from "@/server/trpc";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const _secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
if (!_secret) throw new Error("AUTH_SECRET env var is required");
const JWT_SECRET = new TextEncoder().encode(_secret);

async function buildSession(req: NextRequest) {
  // Web: use NextAuth cookie session
  const session = await auth();
  if (session) return session;

  // Mobile: verify Bearer JWT
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    const token = authHeader.slice(7);
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.sub as string;
    if (!userId) return null;

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, image: true, organisationId: true },
    });
    if (!user) return null;

    return {
      user: { id: user.id, name: user.name ?? "", email: user.email ?? "", image: user.image },
      expires: new Date((payload.exp ?? 0) * 1000).toISOString(),
    } as import("next-auth").Session;
  } catch {
    return null;
  }
}

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async () => {
      const session = await buildSession(req);
      return createTRPCContext({ session, req });
    },
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(`❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`);
          }
        : undefined,
  });

export { handler as GET, handler as POST };
