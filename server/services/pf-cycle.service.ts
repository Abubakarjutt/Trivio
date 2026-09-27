import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

/**
 * Personal Finance "months" follow the user's pay cycle, not the calendar: a
 * month runs from its start date until the user closes it, and closing starts
 * the next one the following day. Nothing closes on its own.
 *
 * Dates are "YYYY-MM-DD" strings everywhere outside Prisma (DATE columns come
 * back as UTC midnight). History from before the first cycle is shown as
 * calendar months, so nothing that was already there disappears.
 */

export interface PfPeriod {
  /** Stable id for the picker: the start date. */
  key: string;
  from: string; // inclusive
  /** Inclusive end; null for the open (current) month. */
  to: string | null;
  label: string;
  kind: "calendar" | "closed" | "open";
}

type Db = Pick<PrismaClient, "pfCycle" | "statementTransaction" | "$transaction">;

// ── date helpers ────────────────────────────────────────────────────────────

/** A DATE column value (UTC midnight) → "YYYY-MM-DD". */
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** "YYYY-MM-DD" → the Date Prisma needs for a DATE column. */
export const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
/** Today on this machine's calendar (the desktop server runs on the user's computer). */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function addDays(day: string, n: number): string {
  const d = dateOf(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d);
}
const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
const lastOfMonth = (day: string) => {
  const d = dateOf(firstOfMonth(day));
  return dayOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};
/** Number of days in [from, to], inclusive. */
export const daysBetween = (from: string, to: string) =>
  Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000) + 1;

function fmt(day: string, withYear: boolean) {
  return dateOf(day).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

export function periodLabel(from: string, to: string | null): string {
  if (to === null) return `${fmt(from, true)} – now`;
  if (from === firstOfMonth(from) && to === lastOfMonth(from))
    return dateOf(from).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmt(from, !sameYear)} – ${fmt(to, true)}`;
}

// ── periods ─────────────────────────────────────────────────────────────────

/**
 * Every period, oldest first: calendar months from the earliest transaction up
 * to the first cycle, then the cycles themselves (the last one open).
 */
export function buildPeriods(
  cycles: { from: string; to: string | null }[],
  earliestTransaction: string | null
): PfPeriod[] {
  const sorted = [...cycles].sort((a, b) => a.from.localeCompare(b.from));
  const periods: PfPeriod[] = [];
  const first = sorted[0]?.from;
  if (first && earliestTransaction && earliestTransaction < first) {
    for (let m = firstOfMonth(earliestTransaction); m < first; m = addDays(lastOfMonth(m), 1)) {
      const to = lastOfMonth(m) < first ? lastOfMonth(m) : addDays(first, -1);
      periods.push({ key: m, from: m, to, label: periodLabel(m, to), kind: "calendar" });
    }
  }
  for (const c of sorted)
    periods.push({
      key: c.from,
      from: c.from,
      to: c.to,
      label: periodLabel(c.from, c.to),
      kind: c.to === null ? "open" : "closed",
    });
  return periods;
}

// ── persistence ─────────────────────────────────────────────────────────────

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

/** The org's cycles, oldest first. The first time, opens one on the 1st of this month. */
export async function loadCycles(db: Db, organisationId: string, today = localToday()) {
  let rows = await db.pfCycle.findMany({
    where: { organisationId },
    orderBy: { startDate: "asc" },
  });
  if (!rows.length) {
    await db.pfCycle.createMany({
      data: [{ organisationId, startDate: dateOf(firstOfMonth(today)) }],
      skipDuplicates: true, // two first requests at once
    });
    rows = await db.pfCycle.findMany({ where: { organisationId }, orderBy: { startDate: "asc" } });
  }
  return rows;
}

export async function listPeriods(db: Db, organisationId: string, today = localToday()) {
  const [rows, earliest] = await Promise.all([
    loadCycles(db, organisationId, today),
    db.statementTransaction.findFirst({
      where: { organisationId },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
  ]);
  return buildPeriods(
    rows.map((r) => ({ from: dayOf(r.startDate), to: r.endDate ? dayOf(r.endDate) : null })),
    earliest ? dayOf(earliest.date) : null
  );
}

async function openAndPrevious(db: Db, organisationId: string, today: string) {
  const rows = await loadCycles(db, organisationId, today);
  return {
    open: rows[rows.length - 1],
    previous: rows.length > 1 ? rows[rows.length - 2] : null,
  };
}

/** Close the current month on `endDate` (default today); the next starts the day after. */
export async function closeCycle(
  db: Db,
  organisationId: string,
  endDate: string | undefined,
  today = localToday()
) {
  const { open } = await openAndPrevious(db, organisationId, today);
  const end = endDate ?? today;
  const start = dayOf(open.startDate);
  if (end < start)
    throw bad(`This month started on ${fmt(start, true)} — it can't end before that.`);
  if (end > today) throw bad("A month can't be closed on a future date.");
  await db.$transaction([
    db.pfCycle.update({
      where: { id: open.id },
      data: { endDate: dateOf(end), closedAt: new Date() },
    }),
    db.pfCycle.create({ data: { organisationId, startDate: dateOf(addDays(end, 1)) } }),
  ]);
  return { closed: { from: start, to: end }, nextStarts: addDays(end, 1) };
}

/** Undo the last close: the previous month continues, taking in the current one. */
export async function reopenCycle(db: Db, organisationId: string, today = localToday()) {
  const { open, previous } = await openAndPrevious(db, organisationId, today);
  if (!previous) throw bad("There's no closed month to reopen.");
  await db.$transaction([
    db.pfCycle.delete({ where: { id: open.id } }),
    db.pfCycle.update({ where: { id: previous.id }, data: { endDate: null, closedAt: null } }),
  ]);
  return { reopened: dayOf(previous.startDate) };
}

/** Move the current month's start (e.g. to the day the salary arrived). The
 *  previous month, if any, then ends the day before. */
export async function setCycleStart(
  db: Db,
  organisationId: string,
  startDate: string,
  today = localToday()
) {
  const { open, previous } = await openAndPrevious(db, organisationId, today);
  if (startDate > today) throw bad("A month can't start in the future.");
  if (previous && startDate <= dayOf(previous.startDate))
    throw bad(
      `The previous month started on ${fmt(dayOf(previous.startDate), true)} — pick a later date, or reopen it first.`
    );
  await db.$transaction([
    ...(previous
      ? [
          db.pfCycle.update({
            where: { id: previous.id },
            data: { endDate: dateOf(addDays(startDate, -1)) },
          }),
        ]
      : []),
    db.pfCycle.update({ where: { id: open.id }, data: { startDate: dateOf(startDate) } }),
  ]);
  return { startDate };
}
