/**
 * Unit tests for parseCsv and mapRow from csv-import-dialog.tsx
 *
 * These are pure utility functions with no side effects.
 */
import { describe, it, expect } from "vitest";
import { parseCsv, mapRow } from "@/app/(app)/transactions/_components/csv-import-dialog";

// ── parseCsv ─────────────────────────────────────────────────────────────────

describe("parseCsv", () => {
  it("parses basic CSV with lowercase headers", () => {
    const csv = "date,description,amount\n2024-01-15,Coffee,5.00\n2024-01-16,Lunch,12.50";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2024-01-15", description: "Coffee", amount: "5.00" });
    expect(rows[1]).toMatchObject({ date: "2024-01-16", description: "Lunch", amount: "12.50" });
  });

  it("handles uppercase header names (Date, Description, Amount)", () => {
    const csv = "Date,Description,Amount\n2024-03-01,Salary,3000.00";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2024-03-01");
    expect(rows[0]!.description).toBe("Salary");
    expect(rows[0]!.amount).toBe("3000.00");
  });

  it("handles mixed-case headers", () => {
    const csv = "DATE,DESCRIPTION,AMOUNT\n2024-03-01,Rent,1500.00";
    const rows = parseCsv(csv);
    expect(rows[0]!.date).toBe("2024-03-01");
    expect(rows[0]!.description).toBe("Rent");
  });

  it("returns empty array for header-only CSV", () => {
    const csv = "date,description,amount";
    expect(parseCsv(csv)).toHaveLength(0);
  });

  it("returns empty array for empty string", () => {
    expect(parseCsv("")).toHaveLength(0);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseCsv("   \n  ")).toHaveLength(0);
  });

  it("filters out rows with no date", () => {
    const csv = "date,description,amount\n,Coffee,5.00\n2024-01-15,Valid,10.00";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("Valid");
  });

  it("filters out rows with no description", () => {
    const csv = "date,description,amount\n2024-01-15,,5.00\n2024-01-16,Valid,10.00";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2024-01-16");
  });

  it("reads amount from 'debit' column alias", () => {
    const csv = "date,description,debit\n2024-01-15,Groceries,80.00";
    const rows = parseCsv(csv);
    expect(rows[0]!.amount).toBe("80.00");
  });

  it("reads amount from 'credit' column alias", () => {
    const csv = "date,description,credit\n2024-01-15,Salary,2500.00";
    const rows = parseCsv(csv);
    expect(rows[0]!.amount).toBe("2500.00");
  });

  it("reads transaction type from 'type' column", () => {
    const csv = "date,description,amount,type\n2024-01-15,Income,100.00,income";
    const rows = parseCsv(csv);
    expect(rows[0]!.rawType).toBe("income");
  });

  it("infers income type when amount is positive and no type column", () => {
    const csv = "date,description,amount\n2024-01-15,Payout,500.00";
    const rows = parseCsv(csv);
    expect(rows[0]!.rawType).toBe("income");
  });

  it("infers expense type when amount is negative and no type column", () => {
    const csv = "date,description,amount\n2024-01-15,Coffee,-5.00";
    const rows = parseCsv(csv);
    expect(rows[0]!.rawType).toBe("expense");
  });

  it("trims whitespace from cell values", () => {
    const csv = "date , description , amount\n 2024-01-15 , Coffee , 5.00 ";
    const rows = parseCsv(csv);
    expect(rows[0]!.date).toBe("2024-01-15");
    expect(rows[0]!.description).toBe("Coffee");
    expect(rows[0]!.amount).toBe("5.00");
  });

  it("removes surrounding double-quotes from cell values", () => {
    const csv = 'date,description,amount\n"2024-01-15","Coffee","5.00"';
    const rows = parseCsv(csv);
    expect(rows[0]!.date).toBe("2024-01-15");
    expect(rows[0]!.description).toBe("Coffee");
    expect(rows[0]!.amount).toBe("5.00");
  });

  it("handles Windows CRLF line endings", () => {
    const csv = "date,description,amount\r\n2024-01-15,Coffee,5.00\r\n2024-01-16,Tea,3.00";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.date).toBe("2024-01-15");
    expect(rows[1]!.date).toBe("2024-01-16");
  });

  it("parses quoted field containing a comma correctly", () => {
    const csv = 'date,description,amount\n2024-01-15,"Starbucks, NYC",4.50';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("Starbucks, NYC");
    expect(rows[0]!.amount).toBe("4.50");
  });

  it("parses multiple quoted fields containing commas", () => {
    const csv = 'date,description,amount,type\n"2024-01-15","Coffee, milk, sugar","12.00","expense"';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("Coffee, milk, sugar");
    expect(rows[0]!.amount).toBe("12.00");
  });

  it("handles a CSV with a trailing newline", () => {
    const csv = "date,description,amount\n2024-01-15,Coffee,5.00\n";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
  });
});

// ── mapRow ────────────────────────────────────────────────────────────────────

const DEFAULT_CASH_ID = "cash-001";
const DEFAULT_INCOME_ID = "income-001";
const DEFAULT_EXPENSE_ID = "expense-001";

function map(partial: Partial<{ date: string; description: string; amount: string; rawType: string }>) {
  return mapRow(
    { date: "2024-01-15", description: "Test", amount: "10.00", rawType: "", ...partial },
    DEFAULT_CASH_ID,
    DEFAULT_INCOME_ID,
    DEFAULT_EXPENSE_ID,
  );
}

describe("mapRow", () => {
  it("maps a positive amount as income type", () => {
    const row = map({ amount: "100.00", rawType: "" });
    expect(row.type).toBe("income");
    expect(row.amount).toBe(100);
    expect(row.valid).toBe(true);
  });

  it("maps a negative amount as expense type using absolute value", () => {
    const row = map({ amount: "-50.00", rawType: "" });
    expect(row.type).toBe("expense");
    expect(row.amount).toBe(50);
    expect(row.valid).toBe(true);
  });

  it("uses income accountId for income rows", () => {
    const row = map({ amount: "200.00", rawType: "" });
    expect(row.accountId).toBe(DEFAULT_INCOME_ID);
    expect(row.cashAccountId).toBe(DEFAULT_CASH_ID);
  });

  it("uses expense accountId for expense rows", () => {
    const row = map({ amount: "-30.00", rawType: "" });
    expect(row.accountId).toBe(DEFAULT_EXPENSE_ID);
    expect(row.cashAccountId).toBe(DEFAULT_CASH_ID);
  });

  it("rawType containing 'income' forces income type even for negative amount", () => {
    const row = map({ amount: "-100.00", rawType: "income" });
    expect(row.type).toBe("income");
    expect(row.amount).toBe(100);
  });

  it("rawType 'expense' does not override positive amount → still income", () => {
    // The current logic: rawType.includes("income") OR amount>0 → income
    // "expense" does not include "income", amount 50 > 0 → income
    const row = map({ amount: "50.00", rawType: "expense" });
    expect(row.type).toBe("income");
  });

  it("returns invalid row for amount = 0", () => {
    const row = map({ amount: "0" });
    expect(row.valid).toBe(false);
    expect(row.error).toContain("amount");
  });

  it("returns invalid row for non-numeric amount", () => {
    const row = map({ amount: "abc" });
    expect(row.valid).toBe(false);
    expect(row.error).toContain("amount");
  });

  it("returns invalid row for empty amount", () => {
    const row = map({ amount: "" });
    expect(row.valid).toBe(false);
  });

  it("returns invalid row for invalid date", () => {
    const row = map({ date: "not-a-date" });
    expect(row.valid).toBe(false);
    expect(row.error).toContain("date");
  });

  it("returns invalid row for empty date", () => {
    const row = map({ date: "" });
    expect(row.valid).toBe(false);
  });

  it("parses ISO date string correctly", () => {
    const row = map({ date: "2024-06-15", amount: "100" });
    expect(row.valid).toBe(true);
    expect(row.date.getFullYear()).toBe(2024);
    expect(row.date.getMonth()).toBe(5); // June = 5 (0-indexed)
    expect(row.date.getDate()).toBe(15);
  });

  it("handles integer amount without decimal", () => {
    const row = map({ amount: "500" });
    expect(row.valid).toBe(true);
    expect(row.amount).toBe(500);
  });

  it("invalid rows still have description preserved", () => {
    const row = map({ amount: "bad", description: "My expense" });
    expect(row.valid).toBe(false);
    expect(row.description).toBe("My expense");
  });
});
