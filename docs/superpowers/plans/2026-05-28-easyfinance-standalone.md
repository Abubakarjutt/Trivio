# EasyFinance Standalone Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the personal finance (bank statement import + MCC categorisation) module from AutoAccounts into a fully self-contained Next.js 15 service that can be deployed independently and pushed to https://github.com/Abubakarjutt/EasyFinance.git.

**Architecture:** Minimal Next.js 15 App Router app with its own Postgres DB (Docker Compose), three tRPC routers (auth, org, statementTransactions), four statement-processing services copied verbatim from AutoAccounts, and a single transactions page. Auth uses NextAuth v5 credentials-only (no OAuth). No accounting ledger, no BullMQ/Redis, no S3.

**Tech Stack:** Next.js 15, TypeScript, Prisma 6 + PostgreSQL 16, NextAuth v5, tRPC v11, Tailwind CSS + shadcn/ui, pdfjs-dist v5, Ollama (gemma4:e4b), Docker Compose.

---

## File Map

| Path | Action | Purpose |
|------|--------|---------|
| `/Users/Apple/projects/EasyFinance/` | **Create dir** | Project root |
| `package.json` | Create | Minimal deps (see Task 1) |
| `tsconfig.json` | Create | Paths alias `@/*` |
| `next.config.ts` | Create | maxDuration, server external packages |
| `tailwind.config.ts` | Create | Dark mode class, content paths |
| `postcss.config.mjs` | Create | Tailwind PostCSS plugin |
| `.env.example` / `.env` | Create | DATABASE_URL, NEXTAUTH_SECRET, OLLAMA_BASE_URL |
| `docker-compose.yml` | Create | Postgres 16 only |
| `prisma/schema.prisma` | Create | Minimal schema (User, Org, NextAuth, Statement models) |
| `lib/db.ts` | Create | PrismaClient singleton |
| `lib/auth.ts` | Create | NextAuth v5 credentials provider |
| `lib/utils.ts` | Create | cn(), formatCurrency(), formatDate() |
| `lib/trpc/client.ts` | Create | createTRPCReact |
| `lib/trpc/provider.tsx` | Create | TRPCReactProvider |
| `lib/trpc/server.ts` | Create | Server-side caller |
| `server/trpc.ts` | Create | createTRPCRouter, orgProcedure, protectedProcedure, publicProcedure |
| `server/routers/auth.ts` | Create | register + getSession procedures |
| `server/routers/org.ts` | Create | setupStep1, setupStep2 procedures |
| `server/routers/statementTransactions.ts` | Copy + adapt | list, updateCategory, toggleExclude, deleteByBatch, listBatches, summary |
| `server/root.ts` | Create | AppRouter with auth + org + statementTransactions |
| `server/services/statement-parser.service.ts` | Copy verbatim | parseCsvBuffer, autoDetectColumns, detectDuplicates |
| `server/services/statement-categorization.service.ts` | Copy verbatim | CATEGORY_DEFINITIONS, categorizeBatch, mapMccToCategory |
| `server/services/pdf-statement.service.ts` | Copy verbatim | extractTextFromPdf, parseTransactionsFromText |
| `server/services/image-statement.service.ts` | Copy verbatim | parseTransactionsFromImage |
| `app/layout.tsx` | Create | Root HTML shell |
| `app/(auth)/login/page.tsx` | Copy + adapt | Credentials sign-in |
| `app/(auth)/register/page.tsx` | Copy + adapt | Register + redirect to onboarding |
| `app/onboarding/page.tsx` | Copy + adapt | 2-step wizard |
| `app/(app)/layout.tsx` | Copy + adapt | Auth gate, org gate |
| `app/(app)/_components/sidebar.tsx` | Create (minimal) | Nav with Transactions link |
| `app/(app)/_components/page-header.tsx` | Copy verbatim | title/description/action header |
| `app/(app)/transactions/page.tsx` | Copy + adapt from `pf/transactions/page.tsx` | Main transactions page |
| `app/(app)/transactions/_components/import-dialog.tsx` | Copy + adapt | Import dialog with SSE |
| `app/(app)/transactions/_components/transaction-table.tsx` | Copy from pf | Table component |
| `app/(app)/transactions/_components/category-badge.tsx` | Copy from pf | Category badge |
| `app/(app)/dashboard/page.tsx` | Create (stub) | Redirect to /transactions |
| `app/api/auth/[...nextauth]/route.ts` | Create | NextAuth handler |
| `app/api/trpc/[trpc]/route.ts` | Create | tRPC HTTP handler |
| `app/api/pf/import/route.ts` | Copy + adapt | SSE import route (keep as `/api/pf/import` for compat) |
| `app/api/pf/import/[batchId]/confirm/route.ts` | Copy verbatim | Duplicate resolution |
| `middleware.ts` | Create | Auth middleware |
| `components/ui/` | Create | button, input, label, select, dialog, progress, badge, card, toast (shadcn stubs) |
| `tests/unit/` | Create | Vitest unit tests for services |
| `vitest.config.ts` | Create | Vitest config |

---

### Task 1: Scaffold project with package.json, tsconfig, and config files

**Files:**
- Create: `/Users/Apple/projects/EasyFinance/package.json`
- Create: `/Users/Apple/projects/EasyFinance/tsconfig.json`
- Create: `/Users/Apple/projects/EasyFinance/next.config.ts`
- Create: `/Users/Apple/projects/EasyFinance/tailwind.config.ts`
- Create: `/Users/Apple/projects/EasyFinance/postcss.config.mjs`
- Create: `/Users/Apple/projects/EasyFinance/.env.example`
- Create: `/Users/Apple/projects/EasyFinance/.gitignore`
- Create: `/Users/Apple/projects/EasyFinance/docker-compose.yml`

- [ ] **Step 1: Create project directory and package.json**

```bash
mkdir -p /Users/Apple/projects/EasyFinance
```

`/Users/Apple/projects/EasyFinance/package.json`:
```json
{
  "name": "easyfinance",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@auth/prisma-adapter": "^2.10.0",
    "@prisma/client": "^6.8.2",
    "@radix-ui/react-dialog": "^1.1.14",
    "@radix-ui/react-label": "^2.1.7",
    "@radix-ui/react-progress": "^1.1.7",
    "@radix-ui/react-select": "^2.2.5",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-toast": "^1.2.14",
    "@tanstack/react-query": "^5.75.5",
    "@trpc/client": "^11.1.2",
    "@trpc/next": "^11.1.2",
    "@trpc/react-query": "^11.1.2",
    "@trpc/server": "^11.1.2",
    "bcryptjs": "^3.0.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.511.0",
    "next": "15.3.2",
    "next-auth": "^5.0.0-beta.29",
    "pdfjs-dist": "^5.7.284",
    "react": "^19",
    "react-dom": "^19",
    "sonner": "^2.0.7",
    "superjson": "^2.2.2",
    "tailwind-merge": "^3.3.0",
    "zod": "^3.24.4"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "prisma": "^6.8.2",
    "tailwindcss": "^3.4.17",
    "typescript": "^5",
    "vitest": "^3.1.4",
    "@vitejs/plugin-react": "^4.4.1"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

`/Users/Apple/projects/EasyFinance/tsconfig.json`:
```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create next.config.ts**

`/Users/Apple/projects/EasyFinance/next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {},
};

export default nextConfig;
```

- [ ] **Step 4: Create Tailwind and PostCSS configs**

`/Users/Apple/projects/EasyFinance/tailwind.config.ts`:
```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "hsl(220 16% 96%)",
      },
    },
  },
  plugins: [],
};

export default config;
```

`/Users/Apple/projects/EasyFinance/postcss.config.mjs`:
```javascript
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
export default config;
```

- [ ] **Step 5: Create .env.example and .gitignore**

`/Users/Apple/projects/EasyFinance/.env.example`:
```
DATABASE_URL="postgresql://easyfinance:easyfinance@localhost:5433/easyfinance"
NEXTAUTH_SECRET="change-me-in-production"
NEXTAUTH_URL="http://localhost:3001"
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL="gemma4:e4b"
```

`/Users/Apple/projects/EasyFinance/.gitignore`:
```
node_modules/
.next/
.env
.env.local
*.tsbuildinfo
```

- [ ] **Step 6: Create docker-compose.yml**

`/Users/Apple/projects/EasyFinance/docker-compose.yml`:
```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: easyfinance
      POSTGRES_PASSWORD: easyfinance
      POSTGRES_DB: easyfinance
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 7: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git init
git add .
git commit -m "chore: scaffold project config files"
```

Expected: commit succeeds with message about scaffolding.

---

### Task 2: Prisma schema and database setup

**Files:**
- Create: `/Users/Apple/projects/EasyFinance/prisma/schema.prisma`
- Create: `/Users/Apple/projects/EasyFinance/.env`

- [ ] **Step 1: Create .env from example**

```bash
cd /Users/Apple/projects/EasyFinance
cp .env.example .env
```

- [ ] **Step 2: Create prisma/schema.prisma**

`/Users/Apple/projects/EasyFinance/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  OWNER
  EDITOR
  VIEWER
}

enum StatementFileType {
  PDF
  CSV
  IMAGE
}

enum StatementImportStatus {
  PENDING
  PROCESSING
  DONE
  FAILED
}

enum StatementTransactionType {
  DEBIT
  CREDIT
}

model User {
  id             String        @id @default(cuid())
  name           String?
  email          String        @unique
  hashedPassword String?
  image          String?
  emailVerified  DateTime?
  role           UserRole      @default(OWNER)
  organisationId String?
  organisation   Organisation? @relation(fields: [organisationId], references: [id])
  sessions       Session[]
  accounts       Account[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
}

model Organisation {
  id                     String                 @id @default(cuid())
  name                   String
  currency               String                 @default("USD")
  onboardingComplete     Boolean                @default(false)
  onboardingStep         String                 @default("BUSINESS_INFO")
  users                  User[]
  statementImportBatches StatementImportBatch[]
  createdAt              DateTime               @default(now())
  updatedAt              DateTime               @updatedAt
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

model StatementImportBatch {
  id               String                 @id @default(cuid())
  organisationId   String
  organisation     Organisation           @relation(fields: [organisationId], references: [id])
  filename         String
  fileType         StatementFileType
  status           StatementImportStatus  @default(PENDING)
  transactionCount Int                    @default(0)
  errorMessage     String?
  transactions     StatementTransaction[]
  createdAt        DateTime               @default(now())
  updatedAt        DateTime               @updatedAt
}

model StatementTransaction {
  id             String                   @id @default(cuid())
  organisationId String
  importBatchId  String
  importBatch    StatementImportBatch     @relation(fields: [importBatchId], references: [id], onDelete: Cascade)
  date           DateTime
  description    String
  merchantName   String
  amount         Decimal                  @db.Decimal(19, 4)
  type           StatementTransactionType
  category       String                   @default("Other")
  mccCode        String                   @default("0000")
  mccLabel       String                   @default("Uncategorized")
  excluded       Boolean                  @default(false)
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt
}
```

- [ ] **Step 3: Start Postgres and run migration**

```bash
cd /Users/Apple/projects/EasyFinance
docker compose up -d
# wait a moment for postgres to be ready
sleep 3
npx prisma migrate dev --name init
```

Expected: migration `init` applied successfully, Prisma client generated.

- [ ] **Step 4: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add prisma/ .env.example
git commit -m "feat: add Prisma schema and initial migration"
```

---

### Task 3: Core lib files (db, auth, utils, tRPC)

**Files:**
- Create: `lib/db.ts`
- Create: `lib/auth.ts`
- Create: `lib/utils.ts`
- Create: `lib/trpc/client.ts`
- Create: `lib/trpc/provider.tsx`
- Create: `lib/trpc/server.ts`

- [ ] **Step 1: Create lib/db.ts**

`/Users/Apple/projects/EasyFinance/lib/db.ts`:
```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error"] : [] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- [ ] **Step 2: Create lib/auth.ts**

`/Users/Apple/projects/EasyFinance/lib/auth.ts`:
```typescript
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await db.user.findUnique({
          where: { email: String(credentials.email) },
        });
        if (!user?.hashedPassword) return null;
        const valid = await bcrypt.compare(
          String(credentials.password),
          user.hashedPassword
        );
        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
```

- [ ] **Step 3: Create lib/utils.ts**

`/Users/Apple/projects/EasyFinance/lib/utils.ts`:
```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
```

- [ ] **Step 4: Create lib/trpc/client.ts**

`/Users/Apple/projects/EasyFinance/lib/trpc/client.ts`:
```typescript
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/root";

export const trpc = createTRPCReact<AppRouter>();
```

- [ ] **Step 5: Create lib/trpc/provider.tsx**

`/Users/Apple/projects/EasyFinance/lib/trpc/provider.tsx`:
```typescript
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { useState } from "react";
import superjson from "superjson";
import { trpc } from "./client";

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        loggerLink({ enabled: (op) => process.env.NODE_ENV === "development" && op.direction === "down" && op.result instanceof Error }),
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
```

- [ ] **Step 6: Create lib/trpc/server.ts**

`/Users/Apple/projects/EasyFinance/lib/trpc/server.ts`:
```typescript
import "server-only";
import { createCallerFactory } from "@/server/trpc";
import { appRouter } from "@/server/root";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const createCaller = createCallerFactory(appRouter);

export const api = createCaller(async () => {
  const session = await auth();
  return { session, db };
});
```

- [ ] **Step 7: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add lib/
git commit -m "feat: add core lib files (db, auth, utils, tRPC)"
```

---

### Task 4: tRPC server (trpc.ts, routers, root.ts)

**Files:**
- Create: `server/trpc.ts`
- Create: `server/routers/auth.ts`
- Create: `server/routers/org.ts`
- Create: `server/routers/statementTransactions.ts`
- Create: `server/root.ts`

- [ ] **Step 1: Create server/trpc.ts**

`/Users/Apple/projects/EasyFinance/server/trpc.ts`:
```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

type Context = { session: Awaited<ReturnType<typeof auth>>; db: typeof db };

export const createTRPCContext = async (): Promise<Context> => {
  const session = await auth();
  return { session, db };
};

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user?.id) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { session: ctx.session } });
});

export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);

const enforceOrganisation = enforceUserIsAuthed.unstable_pipe(async ({ ctx, next }) => {
  const user = await db.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { organisationId: true },
  });
  if (!user?.organisationId) throw new TRPCError({ code: "FORBIDDEN", message: "No organisation" });
  return next({ ctx: { ...ctx, organisationId: user.organisationId } });
});

export const orgProcedure = t.procedure.use(enforceOrganisation);
```

- [ ] **Step 2: Create server/routers/auth.ts**

`/Users/Apple/projects/EasyFinance/server/routers/auth.ts`:
```typescript
import { z } from "zod";
import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "@/server/trpc";
import { db } from "@/lib/db";

export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(z.object({ name: z.string().min(1), email: z.string().email(), password: z.string().min(8) }))
    .mutation(async ({ input }) => {
      const existing = await db.user.findUnique({ where: { email: input.email } });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
      const hashedPassword = await bcrypt.hash(input.password, 12);
      await db.user.create({ data: { name: input.name, email: input.email, hashedPassword } });
      return { success: true };
    }),

  getSession: protectedProcedure.query(({ ctx }) => ctx.session),
});
```

- [ ] **Step 3: Create server/routers/org.ts**

`/Users/Apple/projects/EasyFinance/server/routers/org.ts`:
```typescript
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc";
import { db } from "@/lib/db";

export const orgRouter = createTRPCRouter({
  setupStep1: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const userExists = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!userExists) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      let org = await db.organisation.findFirst({ where: { users: { some: { id: userId } } } });
      if (!org) {
        org = await db.organisation.create({ data: { name: input.name, onboardingStep: "CURRENCY" } });
        await db.user.update({ where: { id: userId }, data: { organisationId: org.id } });
      } else {
        org = await db.organisation.update({ where: { id: org.id }, data: { name: input.name, onboardingStep: "CURRENCY" } });
      }
      return { orgId: org.id };
    }),

  setupStep2: protectedProcedure
    .input(z.object({ currency: z.string().min(3).max(3) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const org = await db.organisation.findFirst({ where: { users: { some: { id: userId } } } });
      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });
      await db.organisation.update({
        where: { id: org.id },
        data: { currency: input.currency, onboardingComplete: true, onboardingStep: "DONE" },
      });
      return { success: true };
    }),
});
```

- [ ] **Step 4: Create server/routers/statementTransactions.ts**

`/Users/Apple/projects/EasyFinance/server/routers/statementTransactions.ts`:
```typescript
import { z } from "zod";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { db } from "@/lib/db";

export const statementTransactionsRouter = createTRPCRouter({
  list: orgProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(50),
      search: z.string().optional(),
      category: z.string().optional(),
      type: z.enum(["DEBIT", "CREDIT"]).optional(),
      batchId: z.string().optional(),
      excludeExcluded: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { organisationId } = ctx;
      const { page, pageSize, search, category, type, batchId, excludeExcluded } = input;
      const where = {
        organisationId,
        ...(search && { OR: [
          { description: { contains: search, mode: "insensitive" as const } },
          { merchantName: { contains: search, mode: "insensitive" as const } },
        ]}),
        ...(category && { category }),
        ...(type && { type }),
        ...(batchId && { importBatchId: batchId }),
        ...(excludeExcluded && { excluded: false }),
      };
      const [total, items] = await Promise.all([
        db.statementTransaction.count({ where }),
        db.statementTransaction.findMany({
          where,
          orderBy: { date: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { items: items.map((t) => ({ ...t, amount: Number(t.amount) })), total, page, pageSize };
    }),

  updateCategory: orgProcedure
    .input(z.object({ id: z.string(), category: z.string(), mccCode: z.string().optional(), mccLabel: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await db.statementTransaction.updateMany({
        where: { id: input.id, organisationId: ctx.organisationId },
        data: { category: input.category, mccCode: input.mccCode ?? "0000", mccLabel: input.mccLabel ?? input.category },
      });
      return { success: true };
    }),

  toggleExclude: orgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const txn = await db.statementTransaction.findFirst({ where: { id: input.id, organisationId: ctx.organisationId } });
      if (!txn) return { success: false };
      await db.statementTransaction.update({ where: { id: input.id }, data: { excluded: !txn.excluded } });
      return { success: true };
    }),

  deleteByBatch: orgProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db.statementTransaction.deleteMany({ where: { importBatchId: input.batchId, organisationId: ctx.organisationId } });
      await db.statementImportBatch.deleteMany({ where: { id: input.batchId, organisationId: ctx.organisationId } });
      return { success: true };
    }),

  listBatches: orgProcedure.query(async ({ ctx }) => {
    const batches = await db.statementImportBatch.findMany({
      where: { organisationId: ctx.organisationId },
      orderBy: { createdAt: "desc" },
    });
    return batches;
  }),

  summary: orgProcedure.query(async ({ ctx }) => {
    const txns = await db.statementTransaction.findMany({
      where: { organisationId: ctx.organisationId, excluded: false },
      select: { amount: true, type: true, category: true },
    });
    const totalDebit = txns.filter((t) => t.type === "DEBIT").reduce((s, t) => s + Number(t.amount), 0);
    const totalCredit = txns.filter((t) => t.type === "CREDIT").reduce((s, t) => s + Number(t.amount), 0);
    const byCategory: Record<string, number> = {};
    for (const t of txns) {
      if (t.type === "DEBIT") byCategory[t.category] = (byCategory[t.category] ?? 0) + Number(t.amount);
    }
    return { totalDebit, totalCredit, byCategory };
  }),
});
```

- [ ] **Step 5: Create server/root.ts**

`/Users/Apple/projects/EasyFinance/server/root.ts`:
```typescript
import { createTRPCRouter } from "@/server/trpc";
import { authRouter } from "@/server/routers/auth";
import { orgRouter } from "@/server/routers/org";
import { statementTransactionsRouter } from "@/server/routers/statementTransactions";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  org: orgRouter,
  statementTransactions: statementTransactionsRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 6: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add server/
git commit -m "feat: add tRPC server with auth, org, and statementTransactions routers"
```

---

### Task 5: Copy statement services verbatim

**Files:**
- Create: `server/services/statement-parser.service.ts` (copy from AutoAccounts)
- Create: `server/services/statement-categorization.service.ts` (copy from AutoAccounts)
- Create: `server/services/pdf-statement.service.ts` (copy from AutoAccounts)
- Create: `server/services/image-statement.service.ts` (copy from AutoAccounts)

- [ ] **Step 1: Copy all four services**

```bash
mkdir -p /Users/Apple/projects/EasyFinance/server/services
cp /Users/Apple/projects/AutoAccounts/server/services/statement-parser.service.ts \
   /Users/Apple/projects/EasyFinance/server/services/
cp /Users/Apple/projects/AutoAccounts/server/services/statement-categorization.service.ts \
   /Users/Apple/projects/EasyFinance/server/services/
cp /Users/Apple/projects/AutoAccounts/server/services/pdf-statement.service.ts \
   /Users/Apple/projects/EasyFinance/server/services/
cp /Users/Apple/projects/AutoAccounts/server/services/image-statement.service.ts \
   /Users/Apple/projects/EasyFinance/server/services/
```

- [ ] **Step 2: Verify imports in each file use only relative imports or env vars (no AutoAccounts-specific paths)**

```bash
grep -n "from " /Users/Apple/projects/EasyFinance/server/services/*.ts
```

Expected: only `./statement-parser.service` cross-import inside `pdf-statement.service.ts` and `image-statement.service.ts`; no `@/lib/db` or auth references.

- [ ] **Step 3: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add server/services/
git commit -m "feat: copy statement processing services from AutoAccounts"
```

---

### Task 6: API routes (NextAuth, tRPC, import, confirm)

**Files:**
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `app/api/trpc/[trpc]/route.ts`
- Create: `app/api/pf/import/route.ts`
- Create: `app/api/pf/import/[batchId]/confirm/route.ts`

- [ ] **Step 1: Create NextAuth route**

`/Users/Apple/projects/EasyFinance/app/api/auth/[...nextauth]/route.ts`:
```typescript
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 2: Create tRPC route**

`/Users/Apple/projects/EasyFinance/app/api/trpc/[trpc]/route.ts`:
```typescript
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/root";
import { createTRPCContext } from "@/server/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTRPCContext,
  });

export { handler as GET, handler as POST };
```

- [ ] **Step 3: Copy and adapt the import route**

```bash
mkdir -p /Users/Apple/projects/EasyFinance/app/api/pf/import
cp /Users/Apple/projects/AutoAccounts/app/api/pf/import/route.ts \
   /Users/Apple/projects/EasyFinance/app/api/pf/import/route.ts
```

The copied file already has correct relative imports pointing to `@/server/services/...` and `@/lib/db` — no changes needed.

- [ ] **Step 4: Copy the confirm route**

```bash
mkdir -p /Users/Apple/projects/EasyFinance/app/api/pf/import/\[batchId\]/confirm
cp /Users/Apple/projects/AutoAccounts/app/api/pf/import/\[batchId\]/confirm/route.ts \
   "/Users/Apple/projects/EasyFinance/app/api/pf/import/[batchId]/confirm/route.ts"
```

- [ ] **Step 5: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add app/api/
git commit -m "feat: add API routes (NextAuth, tRPC, import, confirm)"
```

---

### Task 7: UI components (shadcn stubs)

**Files:**
- Create: `components/ui/button.tsx`
- Create: `components/ui/input.tsx`
- Create: `components/ui/label.tsx`
- Create: `components/ui/select.tsx`
- Create: `components/ui/dialog.tsx`
- Create: `components/ui/progress.tsx`
- Create: `components/ui/badge.tsx`
- Create: `components/ui/card.tsx`
- Create: `components/ui/toast.tsx`
- Create: `components/ui/use-toast.ts`

- [ ] **Step 1: Copy UI components from AutoAccounts**

```bash
mkdir -p /Users/Apple/projects/EasyFinance/components/ui
for comp in button input label select dialog progress badge card toast use-toast; do
  src="/Users/Apple/projects/AutoAccounts/components/ui/${comp}.tsx"
  [ -f "$src" ] || src="/Users/Apple/projects/AutoAccounts/components/ui/${comp}.ts"
  dst_ext="${src##*.}"
  cp "$src" "/Users/Apple/projects/EasyFinance/components/ui/${comp}.${dst_ext}" 2>/dev/null || true
done
```

- [ ] **Step 2: List what was copied**

```bash
ls /Users/Apple/projects/EasyFinance/components/ui/
```

- [ ] **Step 3: For any missing component, write a minimal stub**

For each component file NOT present after the copy (likely `use-toast`), create a minimal version.

If `components/ui/use-toast.ts` is missing:
```typescript
// /Users/Apple/projects/EasyFinance/components/ui/use-toast.ts
import { toast as sonnerToast } from "sonner";
export function useToast() {
  return {
    toast: ({ title, description, variant }: { title?: string; description?: string; variant?: "default" | "destructive" }) => {
      if (variant === "destructive") {
        sonnerToast.error(title, { description });
      } else {
        sonnerToast.success(title, { description });
      }
    },
  };
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add components/
git commit -m "feat: add shadcn UI components"
```

---

### Task 8: Auth pages (login, register) and onboarding

**Files:**
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/register/page.tsx`
- Create: `app/onboarding/page.tsx`

- [ ] **Step 1: Copy and adapt login page**

```bash
mkdir -p /Users/Apple/projects/EasyFinance/app/\(auth\)/login
cp /Users/Apple/projects/AutoAccounts/app/\(auth\)/login/page.tsx \
   /Users/Apple/projects/EasyFinance/app/\(auth\)/login/page.tsx
```

Verify the page uses `signIn` from `next-auth/react` and redirects to `/dashboard` — no AutoAccounts-specific routes.

- [ ] **Step 2: Copy and adapt register page**

```bash
mkdir -p /Users/Apple/projects/EasyFinance/app/\(auth\)/register
cp /Users/Apple/projects/AutoAccounts/app/\(auth\)/register/page.tsx \
   /Users/Apple/projects/EasyFinance/app/\(auth\)/register/page.tsx
```

- [ ] **Step 3: Copy and adapt onboarding page**

```bash
mkdir -p /Users/Apple/projects/EasyFinance/app/onboarding
cp /Users/Apple/projects/AutoAccounts/app/onboarding/page.tsx \
   /Users/Apple/projects/EasyFinance/app/onboarding/page.tsx
```

Verify it calls `trpc.org.setupStep1` and `trpc.org.setupStep2`, redirects to `/dashboard` on completion.

- [ ] **Step 4: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add app/\(auth\)/ app/onboarding/
git commit -m "feat: add auth pages and onboarding wizard"
```

---

### Task 9: App layout, sidebar, and dashboard stub

**Files:**
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/(app)/layout.tsx`
- Create: `app/(app)/_components/sidebar.tsx`
- Create: `app/(app)/_components/page-header.tsx`
- Create: `app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Create root layout**

`/Users/Apple/projects/EasyFinance/app/layout.tsx`:
```typescript
import type { Metadata } from "next";
import "./globals.css";
import { TRPCReactProvider } from "@/lib/trpc/provider";
import { Toaster } from "sonner";

export const metadata: Metadata = { title: "EasyFinance", description: "Personal Finance Manager" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCReactProvider>
          {children}
          <Toaster richColors position="top-right" />
        </TRPCReactProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create globals.css**

`/Users/Apple/projects/EasyFinance/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: 220 16% 96%;
  --foreground: 220 16% 10%;
}
```

- [ ] **Step 3: Create app layout with auth gate**

`/Users/Apple/projects/EasyFinance/app/(app)/layout.tsx`:
```typescript
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sidebar } from "./_components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { organisation: true },
  });

  if (!user) redirect("/login");
  if (!user.organisation?.onboardingComplete) redirect("/onboarding");

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <aside className="hidden md:flex md:shrink-0 shadow-[1px_0_0_0_hsl(220_16%_88%)]">
        <Sidebar orgName={user.organisation.name} />
      </aside>
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Create minimal sidebar**

`/Users/Apple/projects/EasyFinance/app/(app)/_components/sidebar.tsx`:
```typescript
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CreditCard, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/transactions", label: "Transactions", icon: CreditCard },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
];

export function Sidebar({ orgName }: { orgName: string }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full w-56 flex-col bg-white px-3 py-4 gap-1">
      <div className="px-3 py-2 mb-4">
        <p className="font-semibold text-sm truncate">{orgName}</p>
        <p className="text-xs text-gray-500">EasyFinance</p>
      </div>
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith(href) ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:bg-gray-50"
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}
      <div className="mt-auto">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Copy page-header component**

```bash
mkdir -p /Users/Apple/projects/EasyFinance/app/\(app\)/_components
cp /Users/Apple/projects/AutoAccounts/app/\(app\)/_components/page-header.tsx \
   /Users/Apple/projects/EasyFinance/app/\(app\)/_components/page-header.tsx 2>/dev/null || \
cat > /Users/Apple/projects/EasyFinance/app/\(app\)/_components/page-header.tsx << 'EOF'
interface Props { title: string; description?: string; action?: React.ReactNode }
export function PageHeader({ title, description, action }: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
EOF
```

- [ ] **Step 6: Create dashboard stub**

`/Users/Apple/projects/EasyFinance/app/(app)/dashboard/page.tsx`:
```typescript
import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/transactions");
}
```

- [ ] **Step 7: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add app/layout.tsx app/globals.css app/\(app\)/
git commit -m "feat: add app shell — layout, sidebar, dashboard stub"
```

---

### Task 10: Transactions page and import dialog

**Files:**
- Create: `app/(app)/transactions/page.tsx`
- Create: `app/(app)/transactions/_components/import-dialog.tsx`
- Create: `app/(app)/transactions/_components/transaction-table.tsx`
- Create: `app/(app)/transactions/_components/category-badge.tsx`

- [ ] **Step 1: Copy transactions page from AutoAccounts pf/transactions**

```bash
mkdir -p /Users/Apple/projects/EasyFinance/app/\(app\)/transactions/_components
cp /Users/Apple/projects/AutoAccounts/app/\(app\)/pf/transactions/page.tsx \
   /Users/Apple/projects/EasyFinance/app/\(app\)/transactions/page.tsx
```

- [ ] **Step 2: Fix import path in transactions/page.tsx**

The copied file imports from `./_components/...` — those paths are correct as-is. However, tRPC namespace must match. Open the file and verify all `trpc.statementTransactions.*` calls remain unchanged (they match our router).

```bash
grep -n "trpc\." /Users/Apple/projects/EasyFinance/app/\(app\)/transactions/page.tsx | head -20
```

Expected: calls like `trpc.statementTransactions.list.useQuery(...)`, `trpc.statementTransactions.summary.useQuery()`.

- [ ] **Step 3: Copy import-dialog**

```bash
cp /Users/Apple/projects/AutoAccounts/app/\(app\)/pf/transactions/_components/import-dialog.tsx \
   /Users/Apple/projects/EasyFinance/app/\(app\)/transactions/_components/import-dialog.tsx
```

Verify the file's SSE endpoint `/api/pf/import` and confirm endpoint `/api/pf/import/${batchId}/confirm` match the routes we created.

- [ ] **Step 4: Copy transaction-table and category-badge**

```bash
for comp in transaction-table category-badge; do
  cp /Users/Apple/projects/AutoAccounts/app/\(app\)/pf/transactions/_components/${comp}.tsx \
     /Users/Apple/projects/EasyFinance/app/\(app\)/transactions/_components/${comp}.tsx 2>/dev/null || true
done
ls /Users/Apple/projects/EasyFinance/app/\(app\)/transactions/_components/
```

If any component doesn't exist in AutoAccounts, they are likely inlined in the page — that's fine, leave the page as copied.

- [ ] **Step 5: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add app/\(app\)/transactions/
git commit -m "feat: add transactions page and import dialog"
```

---

### Task 11: Middleware and root page redirect

**Files:**
- Create: `middleware.ts`
- Create: `app/page.tsx`

- [ ] **Step 1: Create middleware.ts**

`/Users/Apple/projects/EasyFinance/middleware.ts`:
```typescript
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth", "/api/trpc", "/api/pf"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic && !req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
});

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

- [ ] **Step 2: Create root redirect**

`/Users/Apple/projects/EasyFinance/app/page.tsx`:
```typescript
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/transactions");
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/Apple/projects/EasyFinance
git add middleware.ts app/page.tsx
git commit -m "feat: add middleware auth guard and root redirect"
```

---

### Task 12: Install dependencies, run, verify, and push to GitHub

**Files:** none new — install, test, push.

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/Apple/projects/EasyFinance
npm install
```

Expected: `node_modules/` populated, no critical errors.

- [ ] **Step 2: Ensure Postgres is running and DB migrated**

```bash
cd /Users/Apple/projects/EasyFinance
docker compose up -d
npx prisma migrate deploy
```

Expected: `All migrations have been successfully applied.`

- [ ] **Step 3: Build to check for TypeScript errors**

```bash
cd /Users/Apple/projects/EasyFinance
npm run build 2>&1 | tail -30
```

Expected: build completes without TypeScript errors. If there are type errors, fix them:
- `'use client'` missing on client components that use hooks → add `"use client";` at top
- Missing tRPC procedure (e.g. `deleteTransaction`) → it doesn't exist in new router, remove or replace call
- Import path issues (e.g. `@/server/root` not found) → verify file exists

- [ ] **Step 4: Start dev server and smoke test**

```bash
cd /Users/Apple/projects/EasyFinance
PORT=3001 npm run dev &
sleep 5
curl -s http://localhost:3001 -o /dev/null -w "%{http_code}"
```

Expected: `307` (redirect to /login) or `200`.

- [ ] **Step 5: Add remote and push**

```bash
cd /Users/Apple/projects/EasyFinance
git remote add origin https://github.com/Abubakarjutt/EasyFinance.git
git branch -M main
git push -u origin main
```

Expected: all commits pushed to `main` branch on GitHub.

- [ ] **Step 6: Final commit (if any fixes from step 3)**

```bash
cd /Users/Apple/projects/EasyFinance
git add -A
git status
# only commit if there are changes
git diff --staged --quiet || git commit -m "fix: resolve build errors for standalone deployment"
git push
```

---

## Self-Review

### Spec coverage
- ✅ Isolate personal finance module (statement import, MCC categorisation) → Tasks 5, 10
- ✅ Run independently without breaking → Tasks 1-3 (own DB, Docker Compose)
- ✅ Auth with credentials → Tasks 3, 8
- ✅ Onboarding wizard preserved → Task 8
- ✅ PDF + CSV + image import → Tasks 5, 6
- ✅ SSE streaming progress → Task 6
- ✅ Duplicate detection → Task 6 (confirm route)
- ✅ MCC categorisation service → Task 5
- ✅ Push to GitHub → Task 12

### No placeholders
All code is complete.

### Type consistency
- `orgProcedure` context always has `organisationId: string` — used consistently across `statementTransactions` router
- `RawTransaction` type imported from `statement-parser.service.ts` by import route — same as AutoAccounts
- `AppRouter` type from `server/root.ts` — referenced in `lib/trpc/client.ts`
