"use client";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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

export function fmtMonth(m: string | undefined): string {
  if (!m) return "All time";
  const [y, mon] = m.split("-").map(Number);
  return `${MONTHS[mon - 1]} ${y}`;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface MonthPickerProps {
  month: string | undefined;
  onChange: (m: string | undefined) => void;
}

export function MonthPicker({ month, onChange }: MonthPickerProps) {
  const cur = currentMonth();
  const isAllTime = month === undefined;
  const isCurrentMonth = !isAllTime && month >= cur;

  const btnBase =
    "flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[#F4F3EF] transition-colors text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed";

  const prevM = isAllTime ? prevMonth(cur) : prevMonth(month);
  const nextM = isAllTime ? cur : nextMonth(month);
  const prevY = isAllTime ? prevYear(cur) : prevYear(month);
  const nextY = isAllTime ? cur : nextYear(month);

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => onChange(isAllTime ? cur : undefined)}
        title={isAllTime ? "Switch to month view" : "Show all time"}
        className={`h-8 px-2.5 rounded-lg text-xs font-semibold transition-colors mr-1 ${
          isAllTime
            ? "text-white"
            : "bg-[#F4F3EF] text-muted-foreground hover:bg-[#E8E6DF]"
        }`}
        style={isAllTime ? { background: "#1A6644" } : undefined}
      >
        All
      </button>

      <button onClick={() => onChange(prevY)} className={btnBase} aria-label="Previous year" title="Previous year">
        <ChevronsLeft className="h-4 w-4" />
      </button>
      <button onClick={() => onChange(prevM)} className={btnBase} aria-label="Previous month" title="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </button>

      <span className="min-w-[130px] text-center text-sm font-semibold text-foreground">
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
