import { initTRPC, TRPCError } from "@trpc/server";
import { type Session } from "next-auth";
import { type NextRequest } from "next/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "@/lib/db";

export interface Context {
  session: Session | null;
  db: typeof db;
  ip: string;
}

export async function createTRPCContext(opts: { session: Session | null; req?: NextRequest }): Promise<Context> {
  const ip =
    opts.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    opts.req?.headers.get("x-real-ip") ??
    "unknown";
  return {
    session: opts.session,
    db,
    ip,
  };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

const enforceOrganisation = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const user = await db.user.findUnique({
    where: { id: ctx.session.user.id },
    include: { organisation: true },
  });
  if (!user?.organisationId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No organisation" });
  }
  return next({
    ctx: {
      ...ctx,
      session: { ...ctx.session, user: ctx.session.user },
      user,
      organisationId: user.organisationId,
      organisation: user.organisation!,
    },
  });
});

export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);
export const orgProcedure = t.procedure.use(enforceOrganisation);
