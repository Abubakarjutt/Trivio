import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "@/server/trpc";
import { registerRateLimiter } from "@/server/middleware/rateLimit";
import { sendVerificationEmail, sendAlreadyRegisteredEmail } from "@/lib/resend";

export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { allowed, retryAfterSec } = await registerRateLimiter(ctx.ip);
      if (!allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many registration attempts. Try again in ${retryAfterSec}s.`,
        });
      }

      const normalised = input.email.toLowerCase().trim();
      const appUrl = process.env.NEXTAUTH_URL ?? "";

      const existing = await ctx.db.user.findUnique({ where: { email: normalised } });
      if (existing) {
        // F-02: don't reveal that the email is registered — silently send a notification instead
        await sendAlreadyRegisteredEmail(normalised).catch(() => {});
        return { success: true };
      }

      const hashedPassword = await bcrypt.hash(input.password, 12);
      await ctx.db.user.create({
        data: { name: input.name, email: normalised, hashedPassword },
      });

      // Create and send email verification token
      await ctx.db.emailVerificationToken.deleteMany({ where: { email: normalised } });
      const token = await ctx.db.emailVerificationToken.create({
        data: { email: normalised, expires: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      await sendVerificationEmail(normalised, `${appUrl}/verify-email?token=${token.token}`).catch(
        () => {},
      );

      return { success: true };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      include: { organisation: { include: { taxRegime: { include: { rates: true } } } } },
    });
    return user;
  }),
});
