// Checks the Messages database every minute for new SMS from the user's bank
// senders and queues them for review. Started from instrumentation-node.ts on macOS.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ExistingTransaction } from "@/server/services/statement-parser.service";
import { ChatDbError, PAGE_SIZE, type ChatMessage, type MessageCursor, type readMessages } from "./messages-db";
import { makeSenderMatcher } from "./sender";
import { loadExistingForDedup, type processSms } from "./sms-import.service";

export const POLL_INTERVAL_MS = 60_000;
export const FIRST_SYNC_LOOKBACK_DAYS = 7;
export const MAX_PAGES_PER_TICK = 10;

export interface PollerDeps {
  db: PrismaClient;
  readMessages: typeof readMessages;
  processSms: typeof processSms;
  now: () => Date;
}

interface SourceRow {
  id: string;
  organisationId: string;
  senderIds: string[];
  lastRowId: bigint | null;
}

async function importOne(
  deps: PollerDeps,
  source: SourceRow,
  msg: ChatMessage,
  existing: ExistingTransaction[],
): Promise<void> {
  const { db } = deps;
  const already = await db.smsImportItem.findUnique({
    where: { organisationId_messageGuid: { organisationId: source.organisationId, messageGuid: msg.guid } },
    select: { id: true },
  });
  if (already) return;

  const base = {
    organisationId: source.organisationId,
    sourceId: source.id,
    messageGuid: msg.guid,
    sender: msg.sender,
    receivedAt: msg.receivedAt,
  };
  if (!msg.text) {
    await db.smsImportItem.create({
      data: { ...base, text: "", parsedJson: [], status: "FAILED", errorMessage: "Couldn't read this message's text" },
    });
    return;
  }
  const result = await deps.processSms(msg.text, msg.receivedAt, existing);
  await db.smsImportItem.create({
    data: {
      ...base,
      text: result.redactedText,
      parsedJson: result.parsed as unknown as Prisma.InputJsonValue,
      status: result.status,
      errorMessage: result.status === "FAILED" ? result.error : null,
    },
  });
}

// lastRowId only ever moves to a message that is fully handled, so a crash
// re-reads (harmless: unique guid) but never skips a bank SMS.
async function syncSource(deps: PollerDeps, source: SourceRow): Promise<void> {
  const matches = makeSenderMatcher(source.senderIds);
  const setRowId = (rowId: bigint) =>
    deps.db.smsSource.update({ where: { id: source.id }, data: { lastRowId: rowId } });

  let cursor: MessageCursor =
    source.lastRowId == null
      ? { since: new Date(deps.now().getTime() - FIRST_SYNC_LOOKBACK_DAYS * 86_400_000) }
      : { afterRowId: source.lastRowId };
  let existing: ExistingTransaction[] | null = null;

  for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
    const messages = await deps.readMessages(cursor);
    if (messages.length === 0) return;

    let lastWritten: bigint | null = null;
    for (const msg of messages) {
      if (matches(msg.sender)) {
        existing ??= await loadExistingForDedup(deps.db, source.organisationId, deps.now());
        await importOne(deps, source, msg, existing);
        await setRowId(msg.rowId);
        lastWritten = msg.rowId;
      }
    }
    const last = messages[messages.length - 1]!.rowId;
    if (lastWritten !== last) await setRowId(last);
    cursor = { afterRowId: last };
    if (messages.length < PAGE_SIZE) return;
  }
}

let running = false;

export async function runSmsTick(deps: PollerDeps): Promise<void> {
  if (running) return;
  running = true;
  try {
    const sources = await deps.db.smsSource.findMany({
      where: { enabled: true, status: { not: "NO_ACCESS" } },
      select: { id: true, organisationId: true, senderIds: true, lastRowId: true },
    });
    for (const source of sources) {
      try {
        await syncSource(deps, source);
        await deps.db.smsSource.update({
          where: { id: source.id },
          data: { lastSyncedAt: deps.now(), status: "ACTIVE", lastError: null },
        });
      } catch (err) {
        const noAccess = err instanceof ChatDbError && err.kind === "no_access";
        await deps.db.smsSource.update({
          where: { id: source.id },
          data: {
            status: noAccess ? "NO_ACCESS" : "ERROR",
            lastError: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  } finally {
    running = false;
  }
}

// Next dev re-runs instrumentation on reload; keep a single timer per process.
const g = globalThis as typeof globalThis & { __trivioSmsPoller?: NodeJS.Timeout };

export function startSmsPoller(deps: PollerDeps): void {
  if (g.__trivioSmsPoller) return;
  const tick = () => {
    runSmsTick(deps).catch((err) => console.error("[sms] tick failed:", err));
  };
  tick();
  g.__trivioSmsPoller = setInterval(tick, POLL_INTERVAL_MS);
  g.__trivioSmsPoller.unref?.();
}
