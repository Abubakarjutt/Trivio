"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  Plus,
  Trash2,
  Bot,
  User,
  ChevronLeft,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: unknown[];
  toolResults?: ToolResult[];
  createdAt: Date;
}

interface ToolResult {
  tool: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

function ToolResultCard({ result }: { result: ToolResult }) {
  if (!result.success) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="font-medium text-destructive">Failed: {result.tool}</p>
        <p className="text-muted-foreground mt-1">{result.error}</p>
      </div>
    );
  }

  const data = result.data as Record<string, unknown>;

  if (result.tool === "create_invoice" || result.tool === "create_bill") {
    const type = result.tool === "create_invoice" ? "Invoice" : "Bill";
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-3 text-sm">
        <p className="font-medium text-green-700 dark:text-green-400">{type} Created</p>
        <div className="mt-2 space-y-1 text-muted-foreground">
          <p>Number: <span className="font-medium text-foreground">{data.number as string}</span></p>
          <p>{result.tool === "create_invoice" ? "Customer" : "Supplier"}: {(data.customer ?? data.supplier) as string}</p>
          <p>Total: <span className="font-medium text-foreground">${(data.total as number)?.toFixed(2)}</span></p>
          <p>Status: {data.status as string}</p>
        </div>
      </div>
    );
  }

  if (result.tool === "create_journal_entry") {
    const lines = data.lines as { account: string; debit: number | null; credit: number | null }[];
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-3 text-sm">
        <p className="font-medium text-green-700 dark:text-green-400">Journal Entry Created</p>
        <p className="text-muted-foreground mt-1">{data.description as string}</p>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1">Account</th>
              <th className="text-right py-1">Debit</th>
              <th className="text-right py-1">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines?.map((l, i) => (
              <tr key={i} className="border-b border-dashed">
                <td className="py-1">{l.account}</td>
                <td className="text-right">{l.debit ? `$${l.debit.toFixed(2)}` : ""}</td>
                <td className="text-right">{l.credit ? `$${l.credit.toFixed(2)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (result.tool === "get_profit_and_loss") {
    const income = data.income as Record<string, number>;
    const expenses = data.expenses as Record<string, number>;
    return (
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <p className="font-medium">Profit & Loss</p>
        <p className="text-xs text-muted-foreground">{(data.period as Record<string, string>)?.startDate} to {(data.period as Record<string, string>)?.endDate}</p>
        <div className="mt-2 space-y-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase">Income</p>
            {Object.entries(income || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span>{k}</span><span>${v.toFixed(2)}</span></div>
            ))}
            <div className="flex justify-between font-medium border-t mt-1 pt-1">
              <span>Total Income</span><span>${(data.totalIncome as number)?.toFixed(2)}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase">Expenses</p>
            {Object.entries(expenses || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span>{k}</span><span>${v.toFixed(2)}</span></div>
            ))}
            <div className="flex justify-between font-medium border-t mt-1 pt-1">
              <span>Total Expenses</span><span>${(data.totalExpenses as number)?.toFixed(2)}</span>
            </div>
          </div>
          <div className="flex justify-between font-semibold text-base border-t pt-2">
            <span>Net Profit</span><span className={(data.netProfit as number) >= 0 ? "text-green-600" : "text-red-600"}>${(data.netProfit as number)?.toFixed(2)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (result.tool === "get_ar_aging" || result.tool === "get_ap_aging") {
    const aging = data.aging as Record<string, number>;
    const label = result.tool === "get_ar_aging" ? "AR" : "AP";
    return (
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <p className="font-medium">{label} Aging</p>
        <div className="mt-2 grid grid-cols-5 gap-1 text-xs text-center">
          {Object.entries(aging || {}).map(([period, amount]) => (
            <div key={period} className="rounded bg-background p-2">
              <p className="text-muted-foreground">{period}</p>
              <p className="font-medium">${amount.toFixed(2)}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-between font-medium mt-2 pt-2 border-t">
          <span>Total</span><span>${(data.total as number)?.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <p className="font-medium">{result.tool}</p>
      <pre className="mt-1 text-xs overflow-x-auto whitespace-pre-wrap text-muted-foreground">
        {JSON.stringify(data, null, 2)?.slice(0, 500)}
      </pre>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const toolResults = (message.toolResults ?? []) as ToolResult[];

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isUser ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={`flex flex-col gap-2 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        <div className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {toolResults.map((result, i) => (
          <ToolResultCard key={i} result={result} />
        ))}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: conversations, refetch: refetchConversations } = trpc.chat.listConversations.useQuery(
    undefined,
    { enabled: isOpen, retry: false },
  );

  const { data: conversationData } = trpc.chat.getConversation.useQuery(
    { id: conversationId! },
    { enabled: !!conversationId, retry: false },
  );

  useEffect(() => {
    if (conversationData?.messages) {
      setMessages(
        conversationData.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          toolCalls: m.toolCalls as unknown[] | undefined,
          toolResults: m.toolResults as unknown as ToolResult[] | undefined,
          createdAt: m.createdAt,
        })),
      );
    }
  }, [conversationData]);

  const sendMessage = trpc.chat.sendMessage.useMutation({
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: data.message.id,
          role: data.message.role,
          content: data.message.content,
          toolCalls: data.message.toolCalls,
          toolResults: data.message.toolResults as ToolResult[],
          createdAt: data.message.createdAt,
        },
      ]);
      refetchConversations();
    },
    onError: (err) => {
      toast({ variant: "destructive", title: err.message });
    },
  });

  const deleteConversation = trpc.chat.deleteConversation.useMutation({
    onSuccess: () => {
      refetchConversations();
      if (conversationId) {
        setConversationId(null);
        setMessages([]);
      }
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || sendMessage.isPending) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        role: "user",
        content: trimmed,
        createdAt: new Date(),
      },
    ]);
    setInput("");

    sendMessage.mutate({
      conversationId: conversationId ?? undefined,
      message: trimmed,
    });
  }, [input, conversationId, sendMessage]);

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const loadConversation = (id: string) => {
    setConversationId(id);
    setShowHistory(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
      >
        <MessageSquare className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[600px] w-[400px] flex-col rounded-2xl border bg-background shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        {showHistory ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowHistory(false)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <h3 className="font-semibold text-sm truncate">
            {showHistory ? "Chat History" : "Accounting Assistant"}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {!showHistory && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowHistory(true)} title="History">
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewChat} title="New chat">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* History view */}
      {showHistory ? (
        <div className="flex-1 overflow-y-auto p-2">
          {!conversations?.length ? (
            <p className="text-center text-sm text-muted-foreground py-8">No conversations yet</p>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer hover:bg-muted transition-colors ${conv.id === conversationId ? "bg-muted" : ""}`}
                  onClick={() => loadConversation(conv.id)}
                >
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{conv.title || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground">{conv._count.messages} messages</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation.mutate({ id: conv.id });
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">How can I help?</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[250px]">
                    Create invoices, record expenses, view reports, or upload receipts — all through chat.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 w-full">
                  {[
                    "Show me this month's P&L",
                    "Create an invoice",
                    "What's my AR aging?",
                    "List my accounts",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      className="rounded-lg border px-3 py-2 text-xs text-left hover:bg-muted transition-colors"
                      onClick={() => {
                        setInput(suggestion);
                        inputRef.current?.focus();
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {sendMessage.isPending && (
              <div className="flex gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                placeholder="Ask me anything..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={sendMessage.isPending}
                className="flex-1 text-sm"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || sendMessage.isPending}
                className="shrink-0"
              >
                {sendMessage.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
