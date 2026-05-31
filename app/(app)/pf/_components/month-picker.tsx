"use client";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

// ── pure helpers (exported for tests) ─────────────────────────────────────────
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function prevMonth(m: string): string {
  const [y, mon] = m.split("-").map(Number);
  if (mon === 1) return `${y - 1}-12`;
  return `${y}-${String(mon - 1).padStart(2, "0")}`;
}

export function nextMonth(m: string): string {
  const [y, mon] = m.split("-").map(Number);
  if (mon === 12) return `${y + 1}-01`;
  return `${y}-${String(mon + 1).padStart(2, "0")}`;
}

export function prevYear(m: string): string {
  const [y, mon] = m.split("-").map(Number);
  return `${y - 1}-${String(mon).padStart(2, "0")}`;
}

export function nextYear(m: string): string {
  const [y, mon] = m.split("-").map(Number);
  return `${y + 1}-${String(mon).padStart(2, "0")}`;
}

export function fmtMonth(m: string): string {
  const [y, mon] = m.split("-").map(Number);
  return `${MONTHS[mon - 1]} ${y}`;
}

/** Returns "YYYY-MM" for the current month (in local time) */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── component ─────────────────────────────────────────────────────────────────
interface MonthPickerProps {
  month: string | undefined;  // "YYYY-MM" or undefined = All time
  onChange: (m: string | undefined) => void;
}

export function MonthPicker({ month, onChange }: MonthPickerProps) {
  const cur = currentMonth();
  const isAllTime = month === undefined;
  const isCurrentMonth = !isAllTime && month >= cur;
  const btnBase = "flex h-8 w-8 items-center justify-center rounded-md hover:bg-gray-100 transition-colors text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed";

  // When in All time mode, nav buttons jump to a real month
  const prevM = isAllTime ? prevMonth(cur) : prevMonth(month);
  const nextM = isAllTime ? cur             : nextMonth(month);
  const prevY = isAllTime ? prevYear(cur)   : prevYear(month);
  const nextY = isAllTime ? cur             : nextYear(month);

  return (
    <div className="flex items-center gap-0.5">
      {/* All-time toggle */}
      <button
        onClick={() => onChange(isAllTime ? cur : undefined)}
        title={isAllTime ? "Switch to month view" : "Show all time"}
        className={`h-8 px-2.5 rounded-md text-xs font-semibold transition-colors mr-1
          ${isAllTime
            ? "bg-indigo-600 text-white hover:bg-indigo-700"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
      >
        All
      </button>

      <button onClick={() => onChange(prevY)} className={btnBase} aria-label="Previous year" title="Previous year">
        <ChevronsLeft className="h-4 w-4" />
      </button>
      <button onClick={() => onChange(prevM)} className={btnBase} aria-label="Previous month" title="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </button>

      <span className="min-w-[130px] text-center text-sm font-semibold text-gray-800">
        {isAllTime ? "All time" : fmtMonth(month)}
      </span>

      <button
        onClick={() => !isCurrentMonth && !isAllTime && onChange(nextM)}
        disabled={isCurrentMonth || isAllTime}
        className={btnBase}
        aria-label="Next month"
        title="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        onClick={() => !isCurrentMonth && !isAllTime && onChange(nextY)}
        disabled={isCurrentMonth || isAllTime}
        className={btnBase}
        aria-label="Next year"
        title="Next year"
      >
        <ChevronsRight className="h-4 w-4" />
      </button>
    </div>
  );
}
