import { describe, expect, it } from "vitest";
import { rankSenderSuggestions } from "@/server/services/sms/suggest";
import type { ChatMessage } from "@/server/services/sms/messages-db";

let row = 0;
const m = (sender: string, text: string | null, at = "2026-10-29T10:00:00Z"): ChatMessage => ({
  rowId: BigInt(++row), guid: `g${row}`, sender, text, receivedAt: new Date(at),
});
const upper = (s: string) => s.toUpperCase();

describe("rankSenderSuggestions", () => {
  it("suggests short codes and names, ranked by count, with the latest text redacted and trimmed", () => {
    const out = rankSenderSuggestions([
      m("HBL", "PKR 100 at A", "2026-10-28T10:00:00Z"),
      m("hbl", "PKR 200 at B ".repeat(10), "2026-10-29T10:00:00Z"),
      m("8250", "Rs. 50 debited"),
    ], upper);
    expect(out.map((s) => [s.sender, s.count])).toEqual([["HBL", 2], ["8250", 1]]);
    expect(out[0]!.lastText).toBe("PKR 200 AT B ".repeat(10).slice(0, 80));
  });

  it("drops personal phone numbers and email handles unless they mention money", () => {
    const out = rankSenderSuggestions([
      m("+923001234567", "see you at 5"),
      m("+923009999999", "USD 25.00 charged on card"),
      m("friend@icloud.com", "PKR 500 for lunch?"),
      m("HBL", null),
    ], upper);
    expect(out.map((s) => s.sender)).toEqual(["+923009999999"]);
  });

  it("returns at most 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => m(`BANK${i}`, "PKR 1"));
    expect(rankSenderSuggestions(many, upper)).toHaveLength(20);
  });
});
