/**
 * Unit tests for the month-picker helper functions.
 * Only tests the pure exported helpers — not the React component itself.
 */
import { describe, it, expect } from "vitest";
import {
  prevMonth,
  nextMonth,
  prevYear,
  nextYear,
  fmtMonth,
} from "@/app/(app)/pf/_components/month-picker";

describe("month helpers", () => {
  it("prevMonth goes back one month", () => {
    expect(prevMonth("2026-05")).toBe("2026-04");
  });

  it("prevMonth wraps year correctly", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
  });

  it("nextMonth advances one month", () => {
    expect(nextMonth("2026-05")).toBe("2026-06");
  });

  it("nextMonth wraps year correctly", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
  });

  it("fmtMonth formats nicely", () => {
    expect(fmtMonth("2026-05")).toBe("May 2026");
  });
});

describe("year helpers", () => {
  it("prevYear goes back one year, keeps month", () => {
    expect(prevYear("2026-05")).toBe("2025-05");
  });

  it("prevYear works for January", () => {
    expect(prevYear("2026-01")).toBe("2025-01");
  });

  it("nextYear advances one year, keeps month", () => {
    expect(nextYear("2026-05")).toBe("2027-05");
  });

  it("nextYear works for December", () => {
    expect(nextYear("2026-12")).toBe("2027-12");
  });
});
