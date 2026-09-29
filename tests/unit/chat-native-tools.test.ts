import { describe, it, expect } from "vitest";
import { ACTION_TOOL, fromNativeToolCalls } from "@/server/services/chat-native-tools";
import { buildSystemPrompt, formatToolResultsForModel } from "@/server/services/chat.service";

const ctx = { orgName: "Me", currency: "USD", accounts: [], contacts: [] };

describe("fromNativeToolCalls", () => {
  it("unwraps a call to the action tool", () => {
    expect(
      fromNativeToolCalls([
        {
          function: {
            name: "action",
            arguments: { tool: "add_pf_transaction", args: { merchantName: "Aldi", amount: 5 } },
          },
        },
      ])
    ).toEqual([{ tool: "add_pf_transaction", args: { merchantName: "Aldi", amount: 5 } }]);
  });

  it("accepts arguments sent as a JSON string, and an action called by its own name", () => {
    expect(
      fromNativeToolCalls([
        { function: { name: "action", arguments: '{"tool":"goals.list","args":{}}' } },
        {
          function: { name: "set_budget", arguments: { category: "Groceries", limitAmount: 300 } },
        },
      ])
    ).toEqual([
      { tool: "goals.list", args: {} },
      { tool: "set_budget", args: { category: "Groceries", limitAmount: 300 } },
    ]);
  });

  it("drops malformed calls", () => {
    expect(
      fromNativeToolCalls([
        { function: { name: "action", arguments: { args: {} } } }, // no tool name
        { function: { name: "action", arguments: "not json" } },
        { function: { arguments: { tool: "x" } } }, // no function name
        {},
      ])
    ).toEqual([]);
    expect(fromNativeToolCalls(undefined)).toEqual([]);
  });
});

describe("prompt wording per tool mode", () => {
  it("text mode keeps the TOOL_CALL line with the nonce", () => {
    const prompt = buildSystemPrompt(ctx, "n0nce", "goals: list (read) {}");
    expect(prompt).toContain('TOOL_CALL_n0nce: {"tool":"<name>","args":{...}}');
    expect(prompt).toMatch(/NEVER use function calling/);
    expect(formatToolResultsForModel([], "n0nce")).toContain("TOOL_CALL_n0nce:");
  });

  it("native mode asks for the action tool and never shows the nonce", () => {
    const prompt = buildSystemPrompt(ctx, "n0nce", "goals: list (read) {}", "native");
    expect(prompt).not.toContain("n0nce");
    expect(prompt).not.toMatch(/TOOL_CALL|ACTION line|NEVER use function calling/);
    expect(prompt).toContain(`call the \`${ACTION_TOOL.function.name}\` tool`);
    expect(prompt).toContain("add_pf_transaction");
    const results = formatToolResultsForModel([], "n0nce", "native");
    expect(results).not.toContain("n0nce");
    expect(results).toMatch(/use the action tool/);
  });
});
