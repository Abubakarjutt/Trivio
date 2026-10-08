// orgProcedure plus one place that turns Outreach errors into tRPC errors the UI can show.
import { TRPCError } from "@trpc/server";
import { orgProcedure } from "@/server/trpc";
import { OutreachAiError } from "@/server/services/outreach/llm";
import { NotFoundError, OutreachError } from "@/server/services/outreach/types";

export const outreachProcedure = orgProcedure.use(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    // NotFoundError extends OutreachError, so it is checked first.
    if (cause instanceof NotFoundError)
      throw new TRPCError({ code: "NOT_FOUND", message: cause.message, cause });
    if (cause instanceof OutreachError || cause instanceof OutreachAiError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: cause.message, cause });
    }
  }
  return result;
});

export const MAX_PASTE = 50_000;
export const PRICE = /^\d+(\.\d{1,4})?$/;
