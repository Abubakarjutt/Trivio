import type { ChatMessage } from "./messages-db";
import { isPhoneNumber, normalizeSender } from "./sender";

export interface SenderSuggestion {
  sender: string;
  lastText: string;
  count: number;
}

const CURRENCY_AMOUNT = /(PKR|Rs\.?|USD|\$|£|€|AED)\s?[\d,]+(\.\d+)?/i;
const MAX_SUGGESTIONS = 20;
const PREVIEW_CHARS = 80;

// Banks send from short codes ("8250") or names ("HBL"). Personal numbers only
// count when the message mentions money; iMessage email handles never do.
export function rankSenderSuggestions(
  messages: ChatMessage[],
  redact: (text: string) => string,
): SenderSuggestion[] {
  const bySender = new Map<string, SenderSuggestion & { lastAt: number }>();
  for (const msg of messages) {
    if (!msg.text || msg.sender.includes("@")) continue;
    if (isPhoneNumber(msg.sender) && !CURRENCY_AMOUNT.test(msg.text)) continue;
    const key = normalizeSender(msg.sender);
    const at = msg.receivedAt.getTime();
    const prev = bySender.get(key);
    if (!prev) {
      bySender.set(key, { sender: msg.sender, lastText: msg.text, count: 1, lastAt: at });
    } else {
      prev.count++;
      if (at >= prev.lastAt) {
        prev.lastText = msg.text;
        prev.lastAt = at;
      }
    }
  }
  return [...bySender.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ sender, lastText, count }) => ({ sender, count, lastText: redact(lastText).slice(0, PREVIEW_CHARS) }));
}
