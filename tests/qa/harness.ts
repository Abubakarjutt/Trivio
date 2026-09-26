// QA helpers: real users/organisations created through the real onboarding
// procedures, and tRPC callers that record which procedures a test ran (the
// coverage gate in global-setup.ts fails the run if any are never exercised).
import { randomUUID } from "node:crypto";
import { appRouter } from "@/server/root";
import { createCallerFactory } from "@/server/trpc";
import { db } from "@/lib/db";

export { db };

const createCaller = createCallerFactory(appRouter);
export type Caller = ReturnType<typeof createCaller>;

export const covered = new Set<string>();

export function allProcedures(): string[] {
  return Object.keys((appRouter._def as unknown as { procedures: object }).procedures);
}

function rawCaller(userId: string | null) {
  return createCaller({
    session: userId
      ? { user: { id: userId }, expires: new Date(Date.now() + 3600_000).toISOString() }
      : null,
    db,
    ip: "qa",
  } as Parameters<typeof createCaller>[0]);
}

/** A caller acting as `userId` (or signed-out) that records coverage. */
export function callerFor(userId: string | null): Caller {
  const real = rawCaller(userId) as unknown as Record<
    string,
    Record<string, (input?: unknown) => Promise<unknown>>
  >;
  return new Proxy({} as Caller, {
    get: (_t, area: string) =>
      new Proxy(
        {},
        {
          get: (_t2, proc: string) => (input?: unknown) => {
            covered.add(`${area}.${proc}`);
            return real[area][proc](input);
          },
        }
      ),
  });
}

/** Mark procedures exercised outside a caller (e.g. through the AI chat bridge). */
export function markCovered(...names: string[]) {
  names.forEach((n) => covered.add(n));
}

export interface QaUser {
  userId: string;
  orgId: string;
  email: string;
  api: Caller;
}

/** Sign up and onboard a brand-new user + organisation, exactly as the UI does. */
export async function newUser(
  opts: { currency?: string; businessName?: string } = {}
): Promise<QaUser> {
  const email = `qa-${randomUUID()}@example.test`;
  await callerFor(null).auth.register({ name: "QA User", email, password: "correct-horse-1" });
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const api = callerFor(user.id);
  await api.org.setupStep1({
    businessName: opts.businessName ?? "QA Business",
    businessType: "SOLE_TRADER",
  });
  const org = await api.org.setupStep2({
    currency: opts.currency ?? "USD",
    fiscalYearStartMonth: 1,
  });
  return { userId: user.id, orgId: org.id, email, api };
}

/** Chart account id by code, e.g. "1000" (cash) — from the seeded default chart. */
export async function accountId(orgId: string, code: string): Promise<string> {
  const a = await db.chartAccount.findFirstOrThrow({ where: { organisationId: orgId, code } });
  return a.id;
}

export const today = () => new Date(new Date().toISOString().slice(0, 10));
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const daysFromNow = (n: number) => new Date(Date.now() + n * 86400_000);
