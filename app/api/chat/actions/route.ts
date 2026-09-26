// Approve or reject an action the AI chat proposed. Nothing the assistant
// suggests is written until the signed-in user approves it here.
import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  approvePendingAction,
  PendingActionNotFound,
  rejectPendingAction,
} from "@/server/services/chat-approval";

const bodySchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, organisationId: true },
  });
  if (!user?.organisationId) return new Response("No organisation", { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request body", { status: 400 });

  const scope = { id: parsed.data.id, organisationId: user.organisationId, userId: user.id };
  try {
    const { action, messageId } =
      parsed.data.decision === "approve"
        ? await approvePendingAction(db, scope)
        : await rejectPendingAction(db, scope);

    // Continue the conversation once every proposal on that reply has an
    // answer and at least one was acted on (so e.g. "create a pipeline with
    // stages" can go on to add the stages using the new pipeline's id).
    const siblings = await db.chatPendingAction.findMany({
      where: { messageId, organisationId: user.organisationId },
      select: { status: true },
    });
    const allAnswered = siblings.every((s) => s.status !== "PENDING" && s.status !== "EXECUTING");
    const anyActed = siblings.some((s) => s.status === "APPROVED" || s.status === "FAILED");

    return Response.json({ action, resume: allAnswered && anyActed });
  } catch (err) {
    if (err instanceof PendingActionNotFound) return new Response("Not found", { status: 404 });
    throw err;
  }
}
