// Port of linkedin-outreach/outreach/caps.py (the pure part). Days and weeks use the
// machine's local zone: on desktop that is the user's Mac.
export type CapStatus = {
  today: number;
  week: number;
  dailyCap: number;
  weeklyCap: number;
  remaining: number;
};

export function capWindows(now: Date): { dayStart: Date; weekStart: Date } {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const daysSinceMonday = (dayStart.getDay() + 6) % 7;
  const weekStart = new Date(dayStart);
  weekStart.setDate(dayStart.getDate() - daysSinceMonday);
  return { dayStart, weekStart };
}

export function capStatusFrom(
  today: number,
  week: number,
  dailyCap: number,
  weeklyCap: number
): CapStatus {
  return {
    today,
    week,
    dailyCap,
    weeklyCap,
    remaining: Math.max(0, Math.min(dailyCap - today, weeklyCap - week)),
  };
}
