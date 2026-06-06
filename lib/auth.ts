import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { z } from "zod";
import { writeAuditLog } from "@/server/routers/gdpr";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user?.hashedPassword) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.hashedPassword);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      const u = await db.user.findUnique({ where: { id: user.id }, select: { organisationId: true } });
      if (!u?.organisationId) return;
      await writeAuditLog({ db, organisationId: u.organisationId, userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id });
    },
    async signOut(message) {
      const userId = ("token" in message ? message.token?.id : undefined) as string | undefined;
      if (!userId) return;
      const u = await db.user.findUnique({ where: { id: userId }, select: { organisationId: true } });
      if (!u?.organisationId) return;
      await writeAuditLog({ db, organisationId: u.organisationId, userId, action: "LOGOUT", entityType: "User", entityId: userId });
    },
  },
});
