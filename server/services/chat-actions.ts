// Bridges the AI chat onto the app's tRPC routers so the assistant can do
// anything the UI can: every orgProcedure becomes a chat "app action", run
// through the SAME procedure (validation, organisation scoping, double-entry
// checks) the UI button would call. New routers/procedures show up in the
// chat automatically — no hand-written tool needed.
import { z, type ZodTypeAny } from "zod";
import type { PrismaClient } from "@prisma/client";
import { appRouter } from "@/server/root";
import { createCallerFactory } from "@/server/trpc";

// Procedures the chat must never run. Everything else a signed-in user can
// call from the UI is fair game.
const DENYLIST: (string | RegExp)[] = [
  /^auth\./, // sign-up / session
  /^subscription\./, // Stripe checkout & billing portal
  /^chat\./, // the chat's own conversation plumbing
  "gdpr.deleteAccount", // irreversible account wipe — UI only
  "gdpr.purgeOldChatMessages",
  "gdpr.recordConsent", // consent must come from the human, not the model
  "gdpr.exportData", // bulk dump, not useful in a chat reply
  "invoices.getPdfData", // feeds the PDF renderer, not a user action
];

const MAX_RESULT_CHARS = 4000;

// Input defaults applied (under the model's own input) for chat calls only.
// The UI hides excluded transactions behind a toggle; the model can't see a
// toggle, so it must see every row (each carries isExcluded) to act on it.
const CHAT_INPUT_DEFAULTS: Record<string, Record<string, unknown>> = {
  "statementTransactions.list": { includeExcluded: true },
};

// Plain-English labels so the model can tell look-alike areas apart (e.g.
// personal-finance "statementTransactions" vs business "transactions").
// Optional: an unlabelled area is still listed and callable.
const AREA_LABELS: Record<string, string> = {
  statementTransactions:
    "PERSONAL FINANCE transactions (spending/income on the Personal Finance → Transactions page)",
  transactions: "BUSINESS journal entries (double-entry accounting)",
  dashboard:
    "BUSINESS ledger totals from journal entries only — for personal spending/income use statementTransactions.summary or statementTransactions.list",
  budgets: "personal finance budgets",
  goals: "personal finance savings goals",
  recurringItems: "personal finance recurring bills/income",
  watchlists: "personal finance spending alerts",
  bankAccounts: "business bank accounts & reconciliation",
  accounts: "business chart of accounts",
  org: "business/app settings",
};

export interface AppAction {
  name: string; // "invoices.update"
  kind: "query" | "mutation";
  signature: string; // compact input description for the prompt
  input?: ZodTypeAny;
}

type AnyProcedure = { _def: { type: "query" | "mutation" | "subscription"; inputs: ZodTypeAny[] } };

function isDenied(name: string): boolean {
  return DENYLIST.some((d) => (typeof d === "string" ? d === name : d.test(name)));
}

/** Render a zod schema as a compact, model-readable signature. */
export function describeSchema(schema: ZodTypeAny | undefined, depth = 0): string {
  if (!schema) return "{}";
  if (depth > 4) return "…";
  const def = schema._def as { typeName: string } & Record<string, unknown>;
  switch (def.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return describeSchema(def.innerType as ZodTypeAny, depth);
    case "ZodEffects":
      return describeSchema(def.schema as ZodTypeAny, depth);
    case "ZodPipeline":
      return describeSchema(def.in as ZodTypeAny, depth);
    case "ZodObject": {
      const shape = (schema as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
      const fields = Object.entries(shape).map(([k, v]) => {
        const optional = v.isOptional();
        return `${k}${optional ? "?" : ""}:${describeSchema(v, depth + 1)}`;
      });
      return `{${fields.join(",")}}`;
    }
    case "ZodArray":
      return `[${describeSchema(def.type as ZodTypeAny, depth + 1)}]`;
    case "ZodEnum":
      return (def.values as string[]).join("|");
    case "ZodNativeEnum":
      return Object.values(def.values as Record<string, string>)
        .filter((v) => typeof v === "string")
        .join("|");
    case "ZodLiteral":
      return JSON.stringify(def.value);
    case "ZodUnion":
      return (def.options as ZodTypeAny[]).map((o) => describeSchema(o, depth + 1)).join("|");
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodDate":
      return "date";
    case "ZodRecord":
      return "object";
    default:
      return "any";
  }
}

/**
 * The model speaks JSON, so dates arrive as strings. Server-side callers skip
 * superjson, so coerce strings to Dates wherever the schema expects a z.date().
 */
export function coerceInput(schema: ZodTypeAny | undefined, value: unknown): unknown {
  if (!schema || value === undefined || value === null) return value;
  const def = schema._def as { typeName: string } & Record<string, unknown>;
  switch (def.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return coerceInput(def.innerType as ZodTypeAny, value);
    case "ZodEffects":
      return coerceInput(def.schema as ZodTypeAny, value);
    case "ZodDate":
      return typeof value === "string" || typeof value === "number" ? new Date(value) : value;
    case "ZodArray":
      return Array.isArray(value)
        ? value.map((v) => coerceInput(def.type as ZodTypeAny, v))
        : value;
    case "ZodObject": {
      if (typeof value !== "object") return value;
      const shape = (schema as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
      const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      for (const [k, v] of Object.entries(shape)) out[k] = coerceInput(v, out[k]);
      return out;
    }
    default:
      return value;
  }
}

let cachedActions: AppAction[] | null = null;

/** Every chat-callable procedure on the app router, derived at runtime. */
export function listAppActions(): AppAction[] {
  if (cachedActions) return cachedActions;
  const procedures = (appRouter._def as unknown as { procedures: Record<string, AnyProcedure> })
    .procedures;
  cachedActions = Object.entries(procedures)
    .filter(([name, p]) => p._def.type !== "subscription" && !isDenied(name))
    .map(([name, p]) => {
      const input = p._def.inputs[0];
      return {
        name,
        kind: p._def.type as "query" | "mutation",
        signature: describeSchema(input),
        input,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return cachedActions;
}

/** Prompt block listing every app action, grouped by area. */
export function buildActionCatalog(): string {
  const byArea = new Map<string, string[]>();
  for (const a of listAppActions()) {
    const [area, proc] = a.name.split(".");
    const line = `${proc}${a.kind === "query" ? " (read)" : ""} ${a.signature}`;
    byArea.set(area, [...(byArea.get(area) ?? []), line]);
  }
  return [...byArea.entries()]
    .map(([area, lines]) => {
      const label = AREA_LABELS[area] ? ` — ${AREA_LABELS[area]}` : "";
      return `${area}${label}: ${lines.join("; ")}`;
    })
    .join("\n");
}

/**
 * Resolve a tool name the model wrote to an app action. Small local models
 * write the action as the tool itself and vary the separator
 * ("goals.contribute", "goals:contribute", "goals/contribute").
 */
export function findAppAction(toolName: string): AppAction | undefined {
  const name = toolName.trim().replace(/[:/]/, ".");
  return listAppActions().find((a) => a.name === name);
}

function truncate(data: unknown): unknown {
  const json = JSON.stringify(data ?? null);
  if (json.length <= MAX_RESULT_CHARS) return data;
  return `${json.slice(0, MAX_RESULT_CHARS)}… (truncated — narrow the search/filters to see more)`;
}

const createCaller = createCallerFactory(appRouter);

type AccountRow = { id: string; code: string; name: string };

// Input fields that hold a chart-of-accounts id (not bankAccountId — that's a
// BankAccount row).
const CHART_ACCOUNT_KEY =
  /^(accountId|cashAccountId|chartAccountId|expenseAccountId|incomeAccountId|taxAccountId)$/;

/**
 * The UI picks accounts from a list; the model only knows codes and names
 * ("5300", "Rent & Lease"). Rewrite every `…accountId` field to this
 * organisation's account id, and fail with the valid codes when there's no
 * such account — so the model can correct itself instead of the user
 * approving a card that can only fail.
 */
export async function resolveAccountRefs(
  db: Pick<PrismaClient, "chartAccount">,
  organisationId: string,
  value: unknown
): Promise<unknown> {
  let accounts: AccountRow[] | null = null;
  const load = async () =>
    (accounts ??= await db.chartAccount.findMany({
      where: { organisationId, isArchived: false },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }));

  const resolveOne = async (ref: string): Promise<string> => {
    const all = await load();
    const wanted = ref.trim();
    const hit =
      all.find((a) => a.id === wanted) ??
      all.find((a) => a.code === wanted) ??
      all.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
    if (hit) return hit.id;
    const valid = all.map((a) => `${a.code} ${a.name}`).join("; ");
    throw new Error(
      `No account "${wanted}" in this organisation's chart of accounts. Use one of: ${valid}`
    );
  };

  const walk = async (v: unknown): Promise<unknown> => {
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (!v || typeof v !== "object" || v instanceof Date) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] =
        CHART_ACCOUNT_KEY.test(k) &&
        (typeof x === "string" || typeof x === "number") &&
        String(x).trim()
          ? await resolveOne(String(x))
          : await walk(x);
    }
    return out;
  };
  return walk(value);
}

/**
 * Run one app action as the given user, exactly as their UI session would.
 * Organisation scoping comes from the procedure's own middleware (it re-reads
 * the user's organisation from the DB), not from anything the model supplies.
 */
export async function runAppAction(
  db: PrismaClient,
  userId: string,
  name: string,
  input: unknown
): Promise<{ action: string; kind: "query" | "mutation"; data: unknown }> {
  const action = findAppAction(name);
  if (!action)
    throw new Error(`Unknown or disallowed action "${name}". Use one listed under App actions.`);

  const caller = createCaller({
    session: { user: { id: userId }, expires: new Date(Date.now() + 60_000).toISOString() },
    db,
    ip: "chat",
  } as Parameters<typeof createCaller>[0]);

  const [area, proc] = action.name.split(".");
  const fn = (
    caller as unknown as Record<string, Record<string, (i?: unknown) => Promise<unknown>>>
  )[area][proc];
  const defaults = CHAT_INPUT_DEFAULTS[action.name];
  const merged = defaults ? { ...defaults, ...((input as object | undefined) ?? {}) } : input;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { organisationId: true },
  });
  const resolved = user?.organisationId
    ? await resolveAccountRefs(db, user.organisationId, merged)
    : merged;
  const data = await fn(coerceInput(action.input, resolved ?? undefined));
  return { action: action.name, kind: action.kind, data: truncate(data) };
}
