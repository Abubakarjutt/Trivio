"use client";

import Link from "next/link";
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
  FileText,
  Receipt,
  ArrowUpDown,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  XCircle,
  UserPlus,
  BookOpen,
  TrendingUp,
  Landmark,
  Table2,
  Clock,
  Users,
  Search,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: unknown[];
  toolResults?: ToolResult[];
  pendingActions?: PendingAction[];
  createdAt: Date;
}

// A data-changing action the assistant proposed — saved only on Approve.
interface PendingAction {
  id: string;
  tool: string;
  preview: { title: string; fields: { label: string; value: string }[] };
  status: "PENDING" | "EXECUTING" | "APPROVED" | "REJECTED" | "FAILED";
  summary?: string | null;
  error?: string | null;
  result?: unknown;
}

type Decide = (actionId: string, decision: "approve" | "reject") => Promise<void>;

interface ToolResult {
  tool: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

import { formatCurrency } from "@/lib/utils";

const fmtDate = (s: unknown) =>
  s
    ? new Date(s as string).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  SENT: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  VOID: "bg-red-100 text-red-600",
  OVERDUE: "bg-red-100 text-red-600",
};

const ACCT_TYPE_COLORS: Record<string, string> = {
  ASSET: "bg-blue-100 text-blue-700",
  LIABILITY: "bg-red-100 text-red-700",
  EQUITY: "bg-purple-100 text-purple-700",
  INCOME: "bg-green-100 text-green-700",
  EXPENSE: "bg-orange-100 text-orange-700",
};

const CONTACT_TYPE_COLORS: Record<string, string> = {
  CUSTOMER: "bg-blue-100 text-blue-700",
  SUPPLIER: "bg-amber-100 text-amber-700",
  BOTH: "bg-violet-100 text-violet-700",
};

// Matches the server's nonce-suffixed protocol line, e.g. "TOOL_CALL_a1b2c3d4e5f6a7b8:
// {...}" (see parseToolCalls in server/services/chat.service.ts) — the nonce is a
// random per-request hex string, so it can't be matched as a literal prefix.
const TOOL_CALL_LINE = /^TOOL_CALL_[0-9a-f]+:/;

function stripToolCalls(text: string): string {
  return text
    .split("\n")
    .filter((l) => !TOOL_CALL_LINE.test(l.trimStart()))
    .join("\n")
    .trim();
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium capitalize ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {status.toLowerCase()}
    </span>
  );
}

function ToolResultCard({ result, fmt }: { result: ToolResult; fmt: (v: unknown) => string }) {
  if (!result.success) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <span className="font-semibold capitalize">{result.tool.replace(/_/g, " ")}</span>
          {" — "}
          {result.error}
        </span>
      </div>
    );
  }

  const d = result.data as Record<string, unknown> | undefined;

  // ── Shared sub-components ─────────────────────────────────────────────────

  // A key/value row: label fades left, value bold right — no colons
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-current opacity-60">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );

  // ── Invoice creation ─────────────────────────────────────────────────────

  if (result.tool === "create_invoice") {
    return (
      <Link
        href={`/invoices/${d?.id}`}
        className="group block overflow-hidden rounded-xl border border-blue-200 bg-blue-50 text-xs transition-colors hover:bg-blue-100"
      >
        <div className="flex items-center justify-between border-b border-blue-200 bg-blue-100/60 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-blue-800">
            <FileText className="h-3.5 w-3.5" />
            Invoice created
          </div>
          <ExternalLink className="h-3 w-3 text-blue-400 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="space-y-1.5 px-3.5 py-3 text-blue-800">
          <div className="text-sm font-semibold text-blue-900">{d?.number as string}</div>
          <Row label="Customer" value={d?.customer as string} />
          <Row label="Issued" value={fmtDate(d?.date)} />
          <Row label="Due" value={fmtDate(d?.dueDate)} />
        </div>
        <div className="flex items-center justify-between border-t border-blue-200 px-3.5 py-2">
          <StatusBadge status={d?.status as string} />
          <span className="font-bold text-blue-900 tabular-nums">{fmt(d?.total)}</span>
        </div>
      </Link>
    );
  }

  // ── Bill creation ─────────────────────────────────────────────────────────

  if (result.tool === "create_bill") {
    return (
      <Link
        href={`/bills/${d?.id}`}
        className="group block overflow-hidden rounded-xl border border-amber-200 bg-amber-50 text-xs transition-colors hover:bg-amber-100"
      >
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-100/60 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <Receipt className="h-3.5 w-3.5" />
            Bill created
          </div>
          <ExternalLink className="h-3 w-3 text-amber-400 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="space-y-1.5 px-3.5 py-3 text-amber-800">
          <div className="text-sm font-semibold text-amber-900">{d?.number as string}</div>
          <Row label="Supplier" value={d?.supplier as string} />
          <Row label="Issued" value={fmtDate(d?.date)} />
          <Row label="Due" value={fmtDate(d?.dueDate)} />
        </div>
        <div className="flex items-center justify-between border-t border-amber-200 px-3.5 py-2">
          <StatusBadge status={d?.status as string} />
          <span className="font-bold text-amber-900 tabular-nums">{fmt(d?.total)}</span>
        </div>
      </Link>
    );
  }

  // ── Journal entry creation ────────────────────────────────────────────────

  if (result.tool === "create_journal_entry") {
    const lines = d?.lines as
      | { account: string; debit: number | null; credit: number | null }[]
      | undefined;
    return (
      <div className="overflow-hidden rounded-xl border border-violet-200 bg-violet-50 text-xs">
        <div className="flex items-center gap-1.5 border-b border-violet-200 bg-violet-100/60 px-3.5 py-2.5 font-semibold text-violet-800">
          <ArrowUpDown className="h-3.5 w-3.5" />
          Journal entry recorded
        </div>
        {typeof d?.description === "string" && (
          <p className="px-3.5 pt-2.5 pb-1 text-violet-700/80">{d.description}</p>
        )}
        {lines && lines.length > 0 && (
          <div className="space-y-1.5 px-3.5 pt-1 pb-2.5">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_72px] items-center gap-2 text-violet-800">
                <span className="truncate text-violet-700/80">{l.account}</span>
                <span className="text-right text-[10px] font-medium tabular-nums">
                  {l.debit ? `DR ${fmt(l.debit)}` : `CR ${fmt(l.credit)}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Payment recorded ──────────────────────────────────────────────────────

  if (result.tool === "record_invoice_payment" || result.tool === "record_bill_payment") {
    const isInvoice = result.tool === "record_invoice_payment";
    const href = isInvoice ? `/invoices` : `/bills`;
    const isPaid = d?.newStatus === "PAID";

    return (
      <Link
        href={href}
        className="group block overflow-hidden rounded-xl border border-green-200 bg-green-50 text-xs transition-colors hover:bg-green-100"
      >
        <div className="flex items-center justify-between border-b border-green-200 bg-green-100/60 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-green-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Payment recorded
          </div>
          <ExternalLink className="h-3 w-3 text-green-400 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="space-y-1.5 px-3.5 py-3 text-green-800">
          <div className="text-sm font-semibold text-green-900">{fmt(d?.amountPaid)}</div>
          <Row label={isInvoice ? "Invoice" : "Bill"} value={d?.number as string} />
          <Row label="Account" value={d?.cashAccount as string} />
        </div>
        <div className="flex items-center justify-between border-t border-green-200 px-3.5 py-2">
          <StatusBadge status={d?.newStatus as string} />
          {!isPaid && <span className="text-green-700/70 tabular-nums">Partial payment</span>}
        </div>
      </Link>
    );
  }

  // ── Void ─────────────────────────────────────────────────────────────────

  if (
    result.tool === "void_invoice" ||
    result.tool === "void_bill" ||
    result.tool === "void_transaction"
  ) {
    const label =
      result.tool === "void_invoice"
        ? "Invoice"
        : result.tool === "void_bill"
          ? "Bill"
          : "Transaction";
    const ref =
      result.tool === "void_transaction" ? (d?.description as string) : (d?.number as string);
    return (
      <div className="overflow-hidden rounded-xl border border-orange-200 bg-orange-50 text-xs">
        <div className="flex items-center gap-1.5 border-b border-orange-200 bg-orange-100/60 px-3.5 py-2.5 font-semibold text-orange-800">
          <XCircle className="h-3.5 w-3.5" />
          {label} voided
        </div>
        <div className="space-y-1 px-3.5 py-3 text-orange-800">
          <p className="font-medium">{ref}</p>
          <p className="text-[10px] text-orange-700/60">
            A reversal journal entry has been created.
          </p>
        </div>
      </div>
    );
  }

  // ── Status-only actions (send / approve) ──────────────────────────────────

  if (result.tool === "send_invoice") {
    return (
      <Link
        href="/invoices"
        className="group flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs transition-colors hover:bg-blue-100"
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
        <span className="flex-1 text-blue-800">
          Invoice <span className="font-semibold">{d?.number as string}</span> sent
        </span>
        <StatusBadge status="SENT" />
        <ExternalLink className="h-3 w-3 text-blue-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    );
  }

  if (result.tool === "approve_bill") {
    return (
      <Link
        href="/bills"
        className="group flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs transition-colors hover:bg-amber-100"
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="flex-1 text-amber-800">
          Bill <span className="font-semibold">{d?.number as string}</span> approved
        </span>
        <StatusBadge status="SENT" />
        <ExternalLink className="h-3 w-3 text-amber-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    );
  }

  // ── Contact create / update ───────────────────────────────────────────────

  if (result.tool === "create_contact" || result.tool === "update_contact") {
    const action = result.tool === "create_contact" ? "Contact created" : "Contact updated";
    const typeColor = CONTACT_TYPE_COLORS[d?.type as string] ?? "bg-slate-100 text-slate-600";
    return (
      <Link
        href="/contacts"
        className="group flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs transition-colors hover:bg-slate-100"
      >
        <UserPlus className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{d?.name as string}</p>
          <p className="text-slate-500">{action}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${typeColor}`}
        >
          {(d?.type as string)?.toLowerCase()}
        </span>
        <ExternalLink className="h-3 w-3 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    );
  }

  // ── Account creation ──────────────────────────────────────────────────────

  if (result.tool === "create_account") {
    const typeColor = ACCT_TYPE_COLORS[d?.type as string] ?? "bg-slate-100 text-slate-700";
    return (
      <Link
        href="/accounts"
        className="group flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs transition-colors hover:bg-slate-100"
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">
            <span className="mr-1.5 font-mono">{d?.code as string}</span>
            {d?.name as string}
          </p>
          <p className="text-slate-500">Account created</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${typeColor}`}
        >
          {(d?.type as string)?.toLowerCase()}
        </span>
        <ExternalLink className="h-3 w-3 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    );
  }

  // ── List cards ────────────────────────────────────────────────────────────

  if (result.tool === "list_invoices") {
    const items = result.data as unknown as {
      id: string;
      number: string;
      customer: string;
      dueDate: string;
      total: number;
      outstanding: number;
      status: string;
    }[];
    return (
      <div className="overflow-hidden rounded-xl border border-blue-200 bg-white text-xs">
        <div className="flex items-center justify-between border-b border-blue-200 bg-blue-50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-blue-800">
            <FileText className="h-3.5 w-3.5" />
            Invoices
            <span className="text-[10px] font-normal text-blue-500">({items.length})</span>
          </div>
          <Link href="/invoices" className="text-blue-400 transition-colors hover:text-blue-600">
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
          {items.map((inv) => (
            <Link
              key={inv.id}
              href={`/invoices/${inv.id}`}
              className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-blue-50"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="font-semibold text-slate-800">{inv.number}</span>
                  <StatusBadge status={inv.status} />
                </div>
                <p className="truncate text-slate-500">
                  {inv.customer} · Due {fmtDate(inv.dueDate)}
                </p>
              </div>
              <span className="shrink-0 font-semibold text-slate-800 tabular-nums">
                {fmt(inv.outstanding)}
              </span>
            </Link>
          ))}
          {items.length === 0 && (
            <p className="py-6 text-center text-slate-400">No invoices found</p>
          )}
        </div>
      </div>
    );
  }

  if (result.tool === "list_bills") {
    const items = result.data as unknown as {
      id: string;
      number: string | null;
      supplier: string;
      dueDate: string;
      total: number;
      outstanding: number;
      status: string;
    }[];
    return (
      <div className="overflow-hidden rounded-xl border border-amber-200 bg-white text-xs">
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <Receipt className="h-3.5 w-3.5" />
            Bills
            <span className="text-[10px] font-normal text-amber-500">({items.length})</span>
          </div>
          <Link href="/bills" className="text-amber-400 transition-colors hover:text-amber-600">
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
          {items.map((b) => (
            <Link
              key={b.id}
              href={`/bills/${b.id}`}
              className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-amber-50"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="font-semibold text-slate-800">{b.number ?? "—"}</span>
                  <StatusBadge status={b.status} />
                </div>
                <p className="truncate text-slate-500">
                  {b.supplier} · Due {fmtDate(b.dueDate)}
                </p>
              </div>
              <span className="shrink-0 font-semibold text-slate-800 tabular-nums">
                {fmt(b.outstanding)}
              </span>
            </Link>
          ))}
          {items.length === 0 && <p className="py-6 text-center text-slate-400">No bills found</p>}
        </div>
      </div>
    );
  }

  // ── Invoice / Bill detail ─────────────────────────────────────────────────

  if (result.tool === "get_invoice" || result.tool === "get_bill") {
    const isInvoice = result.tool === "get_invoice";
    const Icon = isInvoice ? FileText : Receipt;
    const href = isInvoice ? `/invoices/${d?.id}` : `/bills/${d?.id}`;
    const party = isInvoice ? (d?.customer as string) : (d?.supplier as string);
    const partyLabel = isInvoice ? "Customer" : "Supplier";
    const total = d?.total as number;
    const outstanding = d?.outstanding as number;
    const lines = d?.lines as
      | { description: string; quantity: number; unitPrice: number; amount: number }[]
      | undefined;
    const isPartial = outstanding > 0 && outstanding < total;

    return (
      <Link
        href={href}
        className="group block overflow-hidden rounded-xl border border-slate-200 bg-white text-xs transition-colors hover:bg-slate-50"
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Icon className="h-3.5 w-3.5" />
            {isInvoice ? "Invoice" : "Bill"} {(d?.number as string) ?? "—"}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={d?.status as string} />
            <ExternalLink className="h-3 w-3 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
        <div className="space-y-1.5 px-3.5 py-3 text-slate-700">
          <Row label={partyLabel} value={<span className="text-slate-900">{party}</span>} />
          <Row label="Issued" value={fmtDate(d?.date)} />
          <Row label="Due" value={fmtDate(d?.dueDate)} />
        </div>
        {lines && lines.length > 0 && (
          <div className="max-h-36 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3.5 py-1.5 text-slate-600"
              >
                <span className="truncate">{l.description}</span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {l.quantity}×{fmt(l.unitPrice)}
                </span>
                <span className="text-right font-medium text-slate-700 tabular-nums">
                  {fmt(l.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <span className="text-slate-500">Total</span>
          <div className="text-right">
            <span className="font-bold text-slate-900 tabular-nums">{fmt(total)}</span>
            {isPartial && (
              <p className="text-[10px] text-amber-600 tabular-nums">
                {fmt(outstanding)} outstanding
              </p>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // ── Contacts list ─────────────────────────────────────────────────────────

  if (result.tool === "list_contacts") {
    const items = result.data as unknown as {
      id: string;
      name: string;
      type: string;
      email: string | null;
    }[];
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Users className="h-3.5 w-3.5" />
            Contacts
            <span className="text-[10px] font-normal text-slate-400">({items.length})</span>
          </div>
          <Link href="/contacts" className="text-slate-400 transition-colors hover:text-slate-600">
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
          {items.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">{c.name}</p>
                {c.email && <p className="truncate text-slate-400">{c.email}</p>}
              </div>
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${CONTACT_TYPE_COLORS[c.type] ?? "bg-slate-100 text-slate-600"}`}
              >
                {c.type.toLowerCase()}
              </span>
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-6 text-center text-slate-400">No contacts found</p>
          )}
        </div>
      </div>
    );
  }

  // ── Accounts list ─────────────────────────────────────────────────────────

  if (result.tool === "list_accounts") {
    const items = result.data as unknown as { code: string; name: string; type: string }[];
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <BookOpen className="h-3.5 w-3.5" />
            Chart of Accounts
            <span className="text-[10px] font-normal text-slate-400">({items.length})</span>
          </div>
          <Link href="/accounts" className="text-slate-400 transition-colors hover:text-slate-600">
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
          {items.map((a) => (
            <div
              key={a.code}
              className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-3.5 py-2"
            >
              <span className="font-mono text-[10px] text-slate-400">{a.code}</span>
              <span className="truncate font-medium text-slate-800">{a.name}</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${ACCT_TYPE_COLORS[a.type] ?? "bg-slate-100 text-slate-600"}`}
              >
                {a.type.toLowerCase()}
              </span>
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-6 text-center text-slate-400">No accounts found</p>
          )}
        </div>
      </div>
    );
  }

  // ── Account balance ───────────────────────────────────────────────────────

  if (result.tool === "get_account_balance") {
    const balance = d?.balance as number;
    const isNeg = balance < 0;
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
        <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3.5 py-2.5 font-semibold text-slate-700">
          <BookOpen className="h-3.5 w-3.5" />
          Account Balance
        </div>
        <div className="flex items-center justify-between gap-4 px-3.5 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">
              <span className="mr-1.5 font-mono text-slate-400">{d?.code as string}</span>
              {d?.name as string}
            </p>
            <span
              className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${ACCT_TYPE_COLORS[d?.type as string] ?? "bg-slate-100 text-slate-600"}`}
            >
              {(d?.type as string)?.toLowerCase()}
            </span>
          </div>
          <span
            className={`shrink-0 text-lg font-bold tabular-nums ${isNeg ? "text-red-600" : "text-slate-900"}`}
          >
            {isNeg && "−"}
            {fmt(Math.abs(balance))}
          </span>
        </div>
      </div>
    );
  }

  // ── Transactions search ───────────────────────────────────────────────────

  if (result.tool === "search_transactions") {
    const items = result.data as unknown as {
      id: string;
      date: string;
      description: string;
      lines: { account: string; debit: number | null; credit: number | null }[];
    }[];
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Search className="h-3.5 w-3.5" />
            Transactions
            <span className="text-[10px] font-normal text-slate-400">({items.length})</span>
          </div>
          <Link
            href="/transactions"
            className="text-slate-400 transition-colors hover:text-slate-600"
          >
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
          {items.map((e) => (
            <div key={e.id} className="space-y-1.5 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium text-slate-800">{e.description}</span>
                <span className="shrink-0 text-slate-400">{fmtDate(e.date)}</span>
              </div>
              {e.lines.slice(0, 2).map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_72px] gap-2 text-slate-500">
                  <span className="truncate">{l.account}</span>
                  <span className="text-right text-[10px] tabular-nums">
                    {l.debit ? `DR ${fmt(l.debit)}` : `CR ${fmt(l.credit)}`}
                  </span>
                </div>
              ))}
              {e.lines.length > 2 && (
                <p className="text-[10px] text-slate-400">+{e.lines.length - 2} more lines</p>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-6 text-center text-slate-400">No transactions found</p>
          )}
        </div>
      </div>
    );
  }

  // ── Profit & Loss ─────────────────────────────────────────────────────────

  if (result.tool === "get_profit_and_loss") {
    const income = d?.income as Record<string, number>;
    const expenses = d?.expenses as Record<string, number>;
    const period = d?.period as { startDate: string; endDate: string };
    const net = d?.netProfit as number;
    const isLoss = net < 0;
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
        <div className="border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <TrendingUp className="h-3.5 w-3.5" />
            Profit & Loss
          </div>
          <p className="mt-0.5 text-slate-400">
            {fmtDate(period?.startDate)} – {fmtDate(period?.endDate)}
          </p>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {/* Income */}
          <div className="space-y-1.5 px-3.5 py-2.5">
            <p className="text-[10px] font-semibold tracking-widest text-emerald-600 uppercase">
              Income
            </p>
            {Object.entries(income ?? {}).map(([name, val]) => (
              <div key={name} className="grid grid-cols-[1fr_auto] gap-3 text-slate-700">
                <span className="truncate text-slate-500">{name}</span>
                <span className="tabular-nums">{fmt(val)}</span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto] gap-3 border-t border-slate-100 pt-1.5 font-semibold text-emerald-700">
              <span>Total Income</span>
              <span className="tabular-nums">{fmt(d?.totalIncome)}</span>
            </div>
          </div>
          {/* Expenses */}
          <div className="space-y-1.5 border-t border-slate-100 px-3.5 py-2.5">
            <p className="text-[10px] font-semibold tracking-widest text-red-500 uppercase">
              Expenses
            </p>
            {Object.entries(expenses ?? {}).map(([name, val]) => (
              <div key={name} className="grid grid-cols-[1fr_auto] gap-3 text-slate-700">
                <span className="truncate text-slate-500">{name}</span>
                <span className="tabular-nums">{fmt(val)}</span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto] gap-3 border-t border-slate-100 pt-1.5 font-semibold text-red-600">
              <span>Total Expenses</span>
              <span className="tabular-nums">{fmt(d?.totalExpenses)}</span>
            </div>
          </div>
        </div>
        <div
          className={`grid grid-cols-[1fr_auto] gap-3 border-t-2 px-3.5 py-3 text-sm font-bold ${isLoss ? "border-red-300 bg-red-50 text-red-700" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}
        >
          <span>{isLoss ? "Net Loss" : "Net Profit"}</span>
          <span className="tabular-nums">{fmt(Math.abs(net))}</span>
        </div>
      </div>
    );
  }

  // ── Balance Sheet ─────────────────────────────────────────────────────────

  if (result.tool === "get_balance_sheet") {
    const sections = [
      {
        label: "Assets",
        data: d?.assets as Record<string, number>,
        total: d?.totalAssets as number,
        accent: "text-blue-600",
        border: "border-blue-200",
        bg: "bg-blue-50",
      },
      {
        label: "Liabilities",
        data: d?.liabilities as Record<string, number>,
        total: d?.totalLiabilities as number,
        accent: "text-red-600",
        border: "border-red-200",
        bg: "bg-red-50",
      },
      {
        label: "Equity",
        data: d?.equity as Record<string, number>,
        total: d?.totalEquity as number,
        accent: "text-purple-600",
        border: "border-purple-200",
        bg: "bg-purple-50",
      },
    ];
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
        <div className="border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Landmark className="h-3.5 w-3.5" />
            Balance Sheet
          </div>
          <p className="mt-0.5 text-slate-400">As of {fmtDate(d?.asOfDate)}</p>
        </div>
        <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
          {sections.map(({ label, data, total, accent, border, bg }) => (
            <div key={label} className="space-y-1.5 px-3.5 py-2.5">
              <p className={`text-[10px] font-bold tracking-widest uppercase ${accent}`}>{label}</p>
              {Object.entries(data ?? {}).map(([name, val]) => (
                <div key={name} className="grid grid-cols-[1fr_auto] gap-3 text-slate-600">
                  <span className="truncate text-slate-500">{name}</span>
                  <span className="tabular-nums">{fmt(val)}</span>
                </div>
              ))}
              <div
                className={`grid grid-cols-[1fr_auto] gap-3 font-semibold ${accent} rounded-lg ${bg} border ${border} mt-1 px-2 py-1`}
              >
                <span>Total {label}</span>
                <span className="tabular-nums">{fmt(total)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Trial Balance ─────────────────────────────────────────────────────────

  if (result.tool === "get_trial_balance") {
    const accounts = d?.accounts as Record<string, { debit: number; credit: number }>;
    const period = d?.period as { startDate: string; endDate: string };
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
        <div className="border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Table2 className="h-3.5 w-3.5" />
            Trial Balance
          </div>
          <p className="mt-0.5 text-slate-400">
            {fmtDate(period?.startDate)} – {fmtDate(period?.endDate)}
          </p>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <div className="grid grid-cols-[1fr_76px_76px] border-b border-slate-200 bg-slate-50 px-3.5 py-1.5 text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
            <span>Account</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
          </div>
          {Object.entries(accounts ?? {}).map(([name, bal]) => (
            <div
              key={name}
              className="grid grid-cols-[1fr_76px_76px] border-b border-slate-100 px-3.5 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              <span className="truncate text-slate-600">{name}</span>
              <span className="text-right text-slate-800 tabular-nums">
                {bal.debit > 0 ? fmt(bal.debit) : ""}
              </span>
              <span className="text-right text-slate-800 tabular-nums">
                {bal.credit > 0 ? fmt(bal.credit) : ""}
              </span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_76px_76px] border-t-2 border-slate-300 bg-slate-50 px-3.5 py-2 font-bold text-slate-900">
            <span>Total</span>
            <span className="text-right tabular-nums">{fmt(d?.totalDebit)}</span>
            <span className="text-right tabular-nums">{fmt(d?.totalCredit)}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── AR / AP Aging ─────────────────────────────────────────────────────────

  if (result.tool === "get_ar_aging" || result.tool === "get_ap_aging") {
    const isAR = result.tool === "get_ar_aging";
    const aging = d?.aging as Record<string, number>;
    const details = d?.details as {
      customer?: string;
      supplier?: string;
      amount: number;
      daysOverdue: number;
    }[];
    const total = d?.total as number;
    const c = isAR
      ? {
          text: "text-blue-800",
          muted: "text-blue-500",
          track: "bg-blue-100",
          bar: "bg-blue-400",
          row: "hover:bg-blue-50",
          border: "border-blue-200",
          header: "bg-blue-50",
        }
      : {
          text: "text-amber-800",
          muted: "text-amber-500",
          track: "bg-amber-100",
          bar: "bg-amber-400",
          row: "hover:bg-amber-50",
          border: "border-amber-200",
          header: "bg-amber-50",
        };
    const buckets: [string, string][] = [
      ["current", "Current"],
      ["1-30", "1–30 d"],
      ["31-60", "31–60 d"],
      ["61-90", "61–90 d"],
      ["90+", "90+ d"],
    ];

    return (
      <div className={`rounded-xl border ${c.border} overflow-hidden bg-white text-xs`}>
        <div
          className={`flex items-center justify-between px-3.5 py-2.5 ${c.header} border-b ${c.border}`}
        >
          <div className={`flex items-center gap-1.5 font-semibold ${c.text}`}>
            <Clock className="h-3.5 w-3.5" />
            {isAR ? "AR Aging" : "AP Aging"}
          </div>
          <span className={`font-bold tabular-nums ${c.text}`}>{fmt(total)}</span>
        </div>
        <div className="space-y-2 px-3.5 py-3">
          {buckets.map(([key, label]) => {
            const val = aging?.[key] ?? 0;
            const pct = total > 0 ? Math.round((val / total) * 100) : 0;
            return (
              <div key={key} className="grid grid-cols-[52px_1fr_68px] items-center gap-2">
                <span className={`${c.muted} text-[10px]`}>{label}</span>
                <div className={`h-1.5 rounded-full ${c.track} overflow-hidden`}>
                  <div
                    className={`h-full rounded-full ${c.bar} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={`text-right font-medium tabular-nums ${c.text}`}>{fmt(val)}</span>
              </div>
            );
          })}
        </div>
        {details && details.length > 0 && (
          <div
            className={`border-t ${c.border} max-h-36 divide-y divide-slate-100 overflow-y-auto`}
          >
            {details.map((item, i) => (
              <div
                key={i}
                className={`flex items-center justify-between gap-3 px-3.5 py-2 ${c.row} transition-colors`}
              >
                <span className={`truncate ${c.text}`}>{item.customer ?? item.supplier}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={`font-semibold tabular-nums ${c.text}`}>{fmt(item.amount)}</span>
                  {item.daysOverdue > 0 && (
                    <span className={`text-[10px] ${c.muted}`}>{item.daysOverdue}d</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// Tools whose results render as a rich card; the rest show as a summary line.
const CARD_TOOLS = new Set([
  "create_invoice",
  "create_bill",
  "create_journal_entry",
  "record_invoice_payment",
  "record_bill_payment",
  "void_invoice",
  "void_bill",
  "void_transaction",
  "send_invoice",
  "approve_bill",
  "create_contact",
  "update_contact",
  "create_account",
  "list_invoices",
  "list_bills",
  "get_invoice",
  "get_bill",
  "list_contacts",
  "list_accounts",
  "get_account_balance",
  "search_transactions",
  "get_profit_and_loss",
  "get_balance_sheet",
  "get_trial_balance",
  "get_ar_aging",
  "get_ap_aging",
]);

function ApprovalCard({
  action,
  onDecide,
  disabled,
  fmt,
}: {
  action: PendingAction;
  onDecide: Decide;
  disabled: boolean;
  fmt: (v: unknown) => string;
}) {
  const result = action.result as ToolResult | undefined;
  if (action.status === "APPROVED" && result && CARD_TOOLS.has(result.tool)) {
    return <ToolResultCard result={result} fmt={fmt} />;
  }

  const tone =
    action.status === "APPROVED"
      ? "border-green-200 bg-green-50"
      : action.status === "FAILED"
        ? "border-red-200 bg-red-50"
        : action.status === "REJECTED"
          ? "border-slate-200 bg-slate-50 opacity-70"
          : "border-amber-200 bg-amber-50";

  return (
    <div
      className={`w-full rounded-xl border px-3.5 py-2.5 text-xs ${tone}`}
      data-testid="chat-approval-card"
      data-status={action.status}
    >
      <p className="mb-1.5 font-semibold">{action.preview.title}</p>
      {action.preview.fields.length > 0 && (
        <dl className="mb-2 space-y-0.5">
          {action.preview.fields.map((f) => (
            <div key={f.label} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 opacity-60">{f.label}</dt>
              <dd className="text-right font-medium whitespace-pre-wrap tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {action.status === "PENDING" && (
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-7 flex-1 text-xs"
            disabled={disabled}
            onClick={() => void onDecide(action.id, "approve")}
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 text-xs"
            disabled={disabled}
            onClick={() => void onDecide(action.id, "reject")}
          >
            <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
          </Button>
        </div>
      )}
      {action.status === "EXECUTING" && (
        <p className="flex items-center gap-1.5 text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </p>
      )}
      {action.status === "APPROVED" && (
        <p className="flex items-center gap-1.5 text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {action.summary || "Approved and saved"}
        </p>
      )}
      {action.status === "REJECTED" && (
        <p className="flex items-center gap-1.5 text-slate-600">
          <XCircle className="h-3.5 w-3.5" /> Rejected — nothing was saved
        </p>
      )}
      {action.status === "FAILED" && (
        <p className="flex items-center gap-1.5 text-red-700">
          <AlertCircle className="h-3.5 w-3.5" /> Not saved — {action.error}
        </p>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  fmt,
  onDecide,
  busy,
}: {
  message: Message;
  fmt: (v: unknown) => string;
  onDecide: Decide;
  busy: boolean;
}) {
  const isUser = message.role === "user";
  const toolResults = (message.toolResults ?? []).filter(
    (r) => CARD_TOOLS.has(r.tool) || !r.success
  );

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isUser ? "bg-primary text-primary-foreground" : "bg-muted"}`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={`flex max-w-[85%] flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}>
        {message.content &&
          (stripToolCalls(message.content) ||
            (toolResults.length === 0 && !message.pendingActions?.length)) && (
            <div
              className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}
            >
              <p className="whitespace-pre-wrap">
                {isUser ? message.content : stripToolCalls(message.content)}
              </p>
            </div>
          )}
        {toolResults.map((r, i) => (
          <ToolResultCard key={i} result={r} fmt={fmt} />
        ))}
        {(message.pendingActions ?? []).map((a) => (
          <ApprovalCard key={a.id} action={a} onDecide={onDecide} disabled={busy} fmt={fmt} />
        ))}
        {(message.pendingActions ?? []).filter((a) => a.status === "PENDING").length > 1 && (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            disabled={busy}
            onClick={async () => {
              for (const a of message.pendingActions ?? []) {
                if (a.status === "PENDING") await onDecide(a.id, "approve");
              }
            }}
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve all
          </Button>
        )}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("open-chat", handler);
    return () => window.removeEventListener("open-chat", handler);
  }, []);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [loadConvId, setLoadConvId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const utils = trpc.useUtils();
  const { data: orgData } = trpc.org.get.useQuery(undefined, { enabled: isOpen });
  const fmt = (v: unknown) => formatCurrency(Number(v ?? 0), orgData?.currency ?? "USD");

  const { data: conversations, refetch: refetchConversations } =
    trpc.chat.listConversations.useQuery(undefined, { enabled: isOpen, retry: false });

  const { data: conversationData } = trpc.chat.getConversation.useQuery(
    { id: loadConvId! },
    { enabled: !!loadConvId, retry: false }
  );

  useEffect(() => {
    if (conversationData?.messages && loadConvId) {
      setMessages(
        conversationData.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          toolCalls: m.toolCalls as unknown[] | undefined,
          toolResults: m.toolResults as unknown as ToolResult[] | undefined,
          pendingActions: m.pendingActions as unknown as PendingAction[] | undefined,
          createdAt: m.createdAt,
        }))
      );
      setConversationId(loadConvId);
      setLoadConvId(null);
    }
  }, [conversationData, loadConvId]);

  const handleStreamMessage = useCallback(
    // userMessage null = continue the turn after the user answered the
    // assistant's proposed actions (no new user bubble).
    async (userMessage: string | null) => {
      setIsStreaming(true);
      setIsThinking(true);
      setStreamingContent("");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            userMessage === null
              ? { resume: true, conversationId }
              : { message: userMessage, conversationId: conversationId ?? undefined }
          ),
          signal: controller.signal,
          credentials: "include",
        });

        if (!res.ok || !res.body) {
          throw new Error(`Server returned ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalContent = "";
        let finalToolCalls: unknown[] = [];
        let finalToolResults: ToolResult[] = [];
        let finalPending: PendingAction[] = [];
        let streamConvId = conversationId;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const event of events) {
            if (!event.trim()) continue;
            const lines = event.split("\n");
            let eventType = "";
            let eventData = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) eventType = line.slice(7).trim();
              else if (line.startsWith("data: ")) eventData = line.slice(6);
            }

            if (!eventType || !eventData) continue;

            let data: Record<string, unknown>;
            try {
              data = JSON.parse(eventData);
            } catch {
              continue;
            }

            switch (eventType) {
              case "start":
                streamConvId = data.conversationId as string;
                setConversationId(data.conversationId as string);
                break;
              case "thinking":
                setIsThinking(true);
                break;
              case "token":
                setIsThinking(false);
                finalContent += data.content as string;
                setStreamingContent(stripToolCalls(finalContent));
                break;
              case "tool_result":
                finalToolResults = [...finalToolResults, data as unknown as ToolResult];
                break;
              case "done":
                finalContent = (data.content as string) || finalContent;
                finalToolCalls = (data.toolCalls as unknown[]) || [];
                finalToolResults = (data.toolResults as ToolResult[]) || finalToolResults;
                finalPending = (data.pendingActions as PendingAction[]) || [];
                break;
              case "error":
                throw new Error(data.message as string);
            }
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: finalContent,
            toolCalls: finalToolCalls,
            toolResults: finalToolResults,
            pendingActions: finalPending,
            createdAt: new Date(),
          },
        ]);

        if (streamConvId && streamConvId !== conversationId) {
          setConversationId(streamConvId);
        }
        refetchConversations();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          toast({
            variant: "destructive",
            title: (err as Error).message || "Failed to get response",
          });
        }
      } finally {
        setIsStreaming(false);
        setIsThinking(false);
        setStreamingContent("");
        abortRef.current = null;
      }
    },
    [conversationId, toast, refetchConversations]
  );

  const setActionState = (updated: PendingAction) =>
    setMessages((prev) =>
      prev.map((m) =>
        m.pendingActions?.some((a) => a.id === updated.id)
          ? {
              ...m,
              pendingActions: m.pendingActions.map((a) => (a.id === updated.id ? updated : a)),
            }
          : m
      )
    );

  const decideAction = useCallback<Decide>(
    async (actionId, decision) => {
      const current = messages
        .flatMap((m) => m.pendingActions ?? [])
        .find((a) => a.id === actionId);
      if (current && decision === "approve") setActionState({ ...current, status: "EXECUTING" });
      try {
        const res = await fetch("/api/chat/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: actionId, decision }),
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const { action, resume } = (await res.json()) as {
          action: PendingAction;
          resume: boolean;
        };
        setActionState(action);
        // Refresh whatever page is open so the new transaction/invoice/etc.
        // shows up right away.
        if (action.status === "APPROVED") void utils.invalidate();
        // Multi-step requests carry on (e.g. add stages to the new pipeline).
        if (resume) void handleStreamMessage(null);
      } catch (err) {
        if (current) setActionState(current);
        toast({
          variant: "destructive",
          title: (err as Error).message || "Couldn't update the action",
        });
      }
    },
    [messages, utils, handleStreamMessage, toast]
  );

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
    if (!trimmed || isStreaming) return;

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

    handleStreamMessage(trimmed);
  }, [input, isStreaming, handleStreamMessage]);

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const loadConversation = (id: string) => {
    setLoadConvId(id);
    setShowHistory(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open AI assistant"
        className="bg-primary text-primary-foreground hover:bg-primary/90 fixed right-6 bottom-6 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105 active:scale-95"
      >
        <MessageSquare className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="bg-background fixed right-6 bottom-6 z-50 flex h-[600px] w-[400px] flex-col rounded-2xl border shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        {showHistory ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowHistory(false)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Bot className="text-primary h-4 w-4 shrink-0" />
          <h3 className="truncate text-sm font-semibold">
            {showHistory ? "Chat History" : "Accounting Assistant"}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {!showHistory && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowHistory(true)}
                title="History"
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleNewChat}
                title="New chat"
              >
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
            <p className="text-muted-foreground py-8 text-center text-sm">No conversations yet</p>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`hover:bg-muted flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors ${conv.id === conversationId ? "bg-muted" : ""}`}
                  onClick={() => loadConversation(conv.id)}
                >
                  <MessageSquare className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{conv.title || "Untitled"}</p>
                    <p className="text-muted-foreground text-xs">{conv._count.messages} messages</p>
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
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-full">
                  <Bot className="text-primary h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium">How can I help?</p>
                  <p className="text-muted-foreground mt-1 max-w-[250px] text-xs">
                    Create invoices, record expenses, view reports, or upload receipts — all through
                    chat.
                  </p>
                </div>
                <div className="mt-2 grid w-full grid-cols-2 gap-2">
                  {[
                    "Show me this month's P&L",
                    "Create an invoice",
                    "What's my AR aging?",
                    "List my accounts",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      className="hover:bg-muted rounded-lg border px-3 py-2 text-left text-xs transition-colors"
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
              <MessageBubble
                key={msg.id}
                message={msg}
                fmt={fmt}
                onDecide={decideAction}
                busy={isStreaming}
              />
            ))}
            {isStreaming && (
              <div className="flex gap-2.5">
                <div className="bg-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="flex max-w-[85%] flex-col items-start gap-2">
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2 text-sm leading-relaxed">
                    {streamingContent ? (
                      <p className="whitespace-pre-wrap">
                        {streamingContent}
                        <span className="bg-foreground/70 ml-0.5 inline-block h-4 w-1.5 animate-pulse align-middle" />
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 py-0.5">
                        <span className="bg-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
                        <span className="bg-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
                        <span className="bg-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
                        {isThinking && (
                          <span className="text-muted-foreground ml-1 text-xs">Thinking...</span>
                        )}
                      </div>
                    )}
                  </div>
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
                disabled={isStreaming}
                className="flex-1 text-sm"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || isStreaming}
                className="shrink-0"
              >
                {isStreaming ? (
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
