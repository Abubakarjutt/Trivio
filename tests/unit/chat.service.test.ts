import { describe, it, expect } from "vitest";
import { parseToolCalls } from "@/server/services/chat.service";

describe("ChatService", () => {
  describe("parseToolCalls", () => {
    it("parses a single tool call from response", () => {
      const response = `I'll create that invoice for you.
TOOL_CALL: {"tool": "create_invoice", "args": {"contactName": "Acme Corp", "lines": [{"description": "Consulting", "quantity": 5, "unitPrice": 150}]}}
Done!`;

      const { text, toolCalls } = parseToolCalls(response);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].tool).toBe("create_invoice");
      expect(toolCalls[0].args).toEqual({
        contactName: "Acme Corp",
        lines: [{ description: "Consulting", quantity: 5, unitPrice: 150 }],
      });
      expect(text).toBe("I'll create that invoice for you.\nDone!");
    });

    it("parses multiple tool calls", () => {
      const response = `Let me get those reports for you.
TOOL_CALL: {"tool": "get_profit_and_loss", "args": {"startDate": "2026-01-01", "endDate": "2026-05-10"}}
TOOL_CALL: {"tool": "get_ar_aging", "args": {}}`;

      const { text, toolCalls } = parseToolCalls(response);

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].tool).toBe("get_profit_and_loss");
      expect(toolCalls[1].tool).toBe("get_ar_aging");
      expect(text).toBe("Let me get those reports for you.");
    });

    it("handles response with no tool calls", () => {
      const response = "I can help you with that! What would you like to do?";

      const { text, toolCalls } = parseToolCalls(response);

      expect(toolCalls).toHaveLength(0);
      expect(text).toBe(response);
    });

    it("handles malformed tool call JSON gracefully", () => {
      const response = `Here's what I found:
TOOL_CALL: {invalid json here}
Some follow-up text.`;

      const { text, toolCalls } = parseToolCalls(response);

      expect(toolCalls).toHaveLength(0);
      expect(text).toContain("TOOL_CALL: {invalid json here}");
      expect(text).toContain("Some follow-up text.");
    });

    it("handles tool call with no args", () => {
      const response = `TOOL_CALL: {"tool": "get_ar_aging"}`;

      const { text, toolCalls } = parseToolCalls(response);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].tool).toBe("get_ar_aging");
      expect(toolCalls[0].args).toEqual({});
    });

    it("handles empty response", () => {
      const { text, toolCalls } = parseToolCalls("");

      expect(toolCalls).toHaveLength(0);
      expect(text).toBe("");
    });

    it("preserves multiline text around tool calls", () => {
      const response = `Line 1
Line 2
TOOL_CALL: {"tool": "list_accounts", "args": {"type": "ASSET"}}
Line 3
Line 4`;

      const { text, toolCalls } = parseToolCalls(response);

      expect(toolCalls).toHaveLength(1);
      expect(text).toBe("Line 1\nLine 2\nLine 3\nLine 4");
    });

    it("handles tool call with complex nested args", () => {
      const response = `TOOL_CALL: {"tool": "create_journal_entry", "args": {"date": "2026-05-10", "description": "Office supplies", "lines": [{"accountCode": "5000", "debit": 200, "credit": null}, {"accountCode": "1000", "debit": null, "credit": 200}]}}`;

      const { text, toolCalls } = parseToolCalls(response);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].tool).toBe("create_journal_entry");
      expect(toolCalls[0].args.lines).toHaveLength(2);
    });

    it("ignores TOOL_CALL without a tool property", () => {
      const response = `TOOL_CALL: {"args": {"foo": "bar"}}`;

      const { text, toolCalls } = parseToolCalls(response);

      expect(toolCalls).toHaveLength(0);
    });

    it("handles extra whitespace in TOOL_CALL line", () => {
      const response = `  TOOL_CALL:   {"tool": "list_contacts", "args": {"type": "CUSTOMER"}}  `;

      const { text, toolCalls } = parseToolCalls(response);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].tool).toBe("list_contacts");
      expect(toolCalls[0].args.type).toBe("CUSTOMER");
    });
  });
});
