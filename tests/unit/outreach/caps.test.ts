import { afterEach, describe, expect, it } from "vitest";
import { capStatusFrom, capWindows } from "@/server/services/outreach/caps";

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe("capWindows", () => {
  it("starts the day at local midnight and the week on local Monday", () => {
    process.env.TZ = "UTC";
    const { dayStart, weekStart } = capWindows(new Date("2026-10-07T12:00:00Z")); // Wednesday
    expect(dayStart.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(weekStart.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("uses the local zone for the week boundary", () => {
    process.env.TZ = "Asia/Karachi"; // UTC+5
    const mondayLocal0001 = new Date("2026-10-04T19:01:00Z");
    const { dayStart, weekStart } = capWindows(mondayLocal0001);
    expect(dayStart.toISOString()).toBe("2026-10-04T19:00:00.000Z");
    expect(weekStart.toISOString()).toBe("2026-10-04T19:00:00.000Z");
    const sundayLocal2359 = new Date(mondayLocal0001.getTime() - 2 * 60_000);
    expect(sundayLocal2359 < weekStart).toBe(true);
  });

  it("treats Sunday as the end of the week", () => {
    process.env.TZ = "UTC";
    expect(capWindows(new Date("2026-10-11T23:00:00Z")).weekStart.toISOString()).toBe(
      "2026-10-05T00:00:00.000Z"
    );
  });
});

describe("capStatusFrom", () => {
  it("limits remaining by the daily cap", () => {
    expect(capStatusFrom(3, 8, 20, 100).remaining).toBe(17);
  });
  it("limits remaining by the weekly cap", () => {
    expect(capStatusFrom(0, 95, 20, 100).remaining).toBe(5);
  });
  it("never goes negative", () => {
    expect(capStatusFrom(25, 25, 20, 100).remaining).toBe(0);
  });
});
