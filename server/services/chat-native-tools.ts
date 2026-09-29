// Native tool calling for the local model (Ollama + Gemma).
//
// Instead of writing a "TOOL_CALL_<nonce>: {...}" line in its reply — which
// small models misspell ("ACTION: …", "ACTION_CALL_…") so the request is
// silently dropped — the model calls ONE native tool, `action`, whose
// arguments are the same {tool, args} pair. The action catalog stays in the
// system prompt, so the prompt is no bigger than before.
//
// Calls arrive in Ollama's structured `message.tool_calls`, never in the reply
// text, so text the model echoes (a pasted document, a user message pretending
// to be a call) can't become an action — that's what the nonce guarded before.
// Every data-changing call still waits for the user's Approve.
import type { ToolCall } from "@/server/services/chat.service";

export const ACTION_TOOL = {
  type: "function",
  function: {
    name: "action",
    description:
      "Run one app action. Read actions (list, get, search, reports) return data to you; " +
      "actions that change data are shown to the user as an Approve/Reject card.",
    parameters: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          description:
            'The action name from the system prompt, e.g. "add_pf_transaction" or "goals.contribute".',
        },
        args: {
          type: "object",
          description: "The action's input, as listed in the system prompt.",
        },
      },
      required: ["tool", "args"],
    },
  },
} as const;

/** One entry of Ollama's `message.tool_calls`. */
export interface OllamaToolCall {
  function?: { name?: string; arguments?: unknown };
}

const asObject = (v: unknown): Record<string, unknown> | null => {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
};

/**
 * Ollama's tool calls → the app's {tool, args}. The model normally calls
 * `action({tool, args})`; a small model sometimes calls the action by its own
 * name instead (`add_pf_transaction({...})`) — equally unambiguous, so accept
 * it. Anything malformed is dropped.
 */
export function fromNativeToolCalls(calls: OllamaToolCall[] | undefined): ToolCall[] {
  const out: ToolCall[] = [];
  for (const c of calls ?? []) {
    const name = c.function?.name?.trim();
    const input = asObject(c.function?.arguments);
    if (!name || !input) continue;
    if (name === ACTION_TOOL.function.name) {
      const tool = typeof input.tool === "string" ? input.tool.trim() : "";
      if (tool) out.push({ tool, args: asObject(input.args) ?? {} });
    } else {
      out.push({ tool: name, args: input });
    }
  }
  return out;
}
