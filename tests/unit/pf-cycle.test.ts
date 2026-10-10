import { describe, it, expect } from "vitest";
import {
  addDays,
  buildPeriods,
  closedMonthWarning,
  daysBetween,
  localToday,
  periodLabel,
} from "@/server/services/pf-cycle.service";

describe("pay-month dates", () => {
  it("adds days across month and leap-year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts days inclusively", () => {
    expect(daysBetween("2026-08-25", "2026-09-24")).toBe(31);
    expect(daysBetween("2026-09-27", "2026-09-27")).toBe(1);
  });

  it("takes today from the machine's own calendar, not UTC", () => {
    // 1am on Sep 1 local time — east of UTC that is still Aug 31 in UTC.
    const d = new Date(2026, 8, 1, 1, 0);
    expect(localToday(d)).toBe("2026-09-01");
  });

  it("labels a whole calendar month by name and a pay month by its dates", () => {
    expect(periodLabel("2026-03-01", "2026-03-31")).toBe("March 2026");
    expect(periodLabel("2026-08-25", "2026-09-24")).toBe("Aug 25 – Sep 24, 2026");
    expect(periodLabel("2025-12-24", "2026-01-23")).toBe("Dec 24, 2025 – Jan 23, 2026");
    expect(periodLabel("2026-09-25", null)).toBe("Sep 25, 2026 – now");
  });
});

describe("buildPeriods", () => {
  it("lists closed pay months then the open one, oldest first", () => {
    const periods = buildPeriods(
      [
        { from: "2026-09-25", to: null },
        { from: "2026-08-25", to: "2026-09-24" },
      ],
      "2026-08-30"
    );
    expect(periods.map((p) => [p.from, p.to, p.kind])).toEqual([
      ["2026-08-25", "2026-09-24", "closed"],
      ["2026-09-25", null, "open"],
    ]);
    expect(periods[1].key).toBe("2026-09-25");
  });

  it("keeps older history as calendar months, up to the day before the first pay month", () => {
    const periods = buildPeriods([{ from: "2026-08-25", to: null }], "2026-06-10");
    expect(periods.map((p) => [p.from, p.to, p.kind, p.label])).toEqual([
      ["2026-06-01", "2026-06-30", "calendar", "June 2026"],
      ["2026-07-01", "2026-07-31", "calendar", "July 2026"],
      ["2026-08-01", "2026-08-24", "calendar", "Aug 1 – Aug 24, 2026"],
      ["2026-08-25", null, "open", "Aug 25, 2026 – now"],
    ]);
  });

  it("adds no calendar months when there's no earlier history", () => {
    expect(buildPeriods([{ from: "2026-09-01", to: null }], "2026-09-01")).toHaveLength(1);
    expect(buildPeriods([{ from: "2026-09-01", to: null }], null)).toHaveLength(1);
  });
});

describe("closedMonthWarning", () => {
  it("names the closed month and why the transaction won't show", () => {
    expect(closedMonthWarning({ from: "2026-09-01", to: "2026-10-09" })).toBe(
      "This date is in a closed month (Sep 1 – Oct 9, 2026), so it won't show in the current month."
    );
  });
});
