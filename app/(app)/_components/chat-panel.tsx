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
  createdAt: Date;
}

interface ToolResult {
  tool: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

const fmt = (v: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(v ?? 0));

const fmtDate = (s: unknown) =>
  s ? new Date(s as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

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

function stripToolCalls(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("TOOL_CALL:"))
    .join("\n")
    .trim();
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium capitalize ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status.toLowerCase()}
    </span>
  );
}

function ToolResultCard({ result }: { result: ToolResult }) {
  if (!result.success) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <span className="font-semibold capitalize">{result.tool.replace(/_/g, " ")}</span>
          {" — "}{result.error}
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
      <Link href={`/invoices/${d?.id}`} className="group block rounded-xl border border-blue-200 bg-blue-50 overflow-hidden text-xs transition-colors hover:bg-blue-100">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-blue-100/60 border-b border-blue-200">
          <div className="flex items-center gap-1.5 font-semibold text-blue-800">
            <FileText className="h-3.5 w-3.5" />
            Invoice created
          </div>
          <ExternalLink className="h-3 w-3 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="px-3.5 py-3 space-y-1.5 text-blue-800">
          <div className="text-sm font-semibold text-blue-900">{d?.number as string}</div>
          <Row label="Customer" value={d?.customer as string} />
          <Row label="Issued" value={fmtDate(d?.date)} />
          <Row label="Due" value={fmtDate(d?.dueDate)} />
        </div>
        <div className="flex items-center justify-between px-3.5 py-2 border-t border-blue-200">
          <StatusBadge status={d?.status as string} />
          <span className="font-bold tabular-nums text-blue-900">{fmt(d?.total)}</span>
        </div>
      </Link>
    );
  }

  // ── Bill creation ─────────────────────────────────────────────────────────

  if (result.tool === "create_bill") {
    return (
      <Link href={`/bills/${d?.id}`} className="group block rounded-xl border border-amber-200 bg-amber-50 overflow-hidden text-xs transition-colors hover:bg-amber-100">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-amber-100/60 border-b border-amber-200">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <Receipt className="h-3.5 w-3.5" />
            Bill created
          </div>
          <ExternalLink className="h-3 w-3 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="px-3.5 py-3 space-y-1.5 text-amber-800">
          <div className="text-sm font-semibold text-amber-900">{d?.number as string}</div>
          <Row label="Supplier" value={d?.supplier as string} />
          <Row label="Issued" value={fmtDate(d?.date)} />
          <Row label="Due" value={fmtDate(d?.dueDate)} />
        </div>
        <div className="flex items-center justify-between px-3.5 py-2 border-t border-amber-200">
          <StatusBadge status={d?.status as string} />
          <span className="font-bold tabular-nums text-amber-900">{fmt(d?.total)}</span>
        </div>
      </Link>
    );
  }

  // ── Journal entry creation ────────────────────────────────────────────────

  if (result.tool === "create_journal_entry") {
    const lines = d?.lines as { account: string; debit: number | null; credit: number | null }[] | undefined;
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50 overflow-hidden text-xs">
        <div className="flex items-center gap-1.5 px-3.5 py-2.5 bg-violet-100/60 border-b border-violet-200 font-semibold text-violet-800">
          <ArrowUpDown className="h-3.5 w-3.5" />
          Journal entry recorded
        </div>
        {typeof d?.description === "string" && (
          <p className="px-3.5 pt-2.5 pb-1 text-violet-700/80">{d.description}</p>
        )}
        {lines && lines.length > 0 && (
          <div className="px-3.5 pb-2.5 pt-1 space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_72px] items-center gap-2 text-violet-800">
                <span className="truncate text-violet-700/80">{l.account}</span>
                <span className="tabular-nums text-right font-medium text-[10px]">
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
      <Link href={href} className="group block rounded-xl border border-green-200 bg-green-50 overflow-hidden text-xs transition-colors hover:bg-green-100">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-green-100/60 border-b border-green-200">
          <div className="flex items-center gap-1.5 font-semibold text-green-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Payment recorded
          </div>
          <ExternalLink className="h-3 w-3 text-green-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="px-3.5 py-3 space-y-1.5 text-green-800">
          <div className="text-sm font-semibold text-green-900">{fmt(d?.amountPaid)}</div>
          <Row label={isInvoice ? "Invoice" : "Bill"} value={d?.number as string} />
          <Row label="Account" value={d?.cashAccount as string} />
        </div>
        <div className="flex items-center justify-between px-3.5 py-2 border-t border-green-200">
          <StatusBadge status={d?.newStatus as string} />
          {!isPaid && (
            <span className="text-green-700/70 tabular-nums">
              Partial payment
            </span>
          )}
        </div>
      </Link>
    );
  }

  // ── Void ─────────────────────────────────────────────────────────────────

  if (result.tool === "void_invoice" || result.tool === "void_bill" || result.tool === "void_transaction") {
    const label = result.tool === "void_invoice" ? "Invoice" : result.tool === "void_bill" ? "Bill" : "Transaction";
    const ref = result.tool === "void_transaction" ? (d?.description as string) : (d?.number as string);
    return (
      <div className="rounded-xl border border-orange-200 bg-orange-50 overflow-hidden text-xs">
        <div className="flex items-center gap-1.5 px-3.5 py-2.5 bg-orange-100/60 border-b border-orange-200 font-semibold text-orange-800">
          <XCircle className="h-3.5 w-3.5" />
          {label} voided
        </div>
        <div className="px-3.5 py-3 space-y-1 text-orange-800">
          <p className="font-medium">{ref}</p>
          <p className="text-orange-700/60 text-[10px]">A reversal journal entry has been created.</p>
        </div>
      </div>
    );
  }

  // ── Status-only actions (send / approve) ──────────────────────────────────

  if (result.tool === "send_invoice") {
    return (
      <Link href="/invoices" className="group flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs transition-colors hover:bg-blue-100">
        <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
        <span className="flex-1 text-blue-800">
          Invoice <span className="font-semibold">{d?.number as string}</span> sent
        </span>
        <StatusBadge status="SENT" />
        <ExternalLink className="h-3 w-3 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>
    );
  }

  if (result.tool === "approve_bill") {
    return (
      <Link href="/bills" className="group flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs transition-colors hover:bg-amber-100">
        <CheckCircle2 className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="flex-1 text-amber-800">
          Bill <span className="font-semibold">{d?.number as string}</span> approved
        </span>
        <StatusBadge status="SENT" />
        <ExternalLink className="h-3 w-3 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>
    );
  }

  // ── Contact create / update ───────────────────────────────────────────────

  if (result.tool === "create_contact" || result.tool === "update_contact") {
    const action = result.tool === "create_contact" ? "Contact created" : "Contact updated";
    const typeColor = CONTACT_TYPE_COLORS[d?.type as string] ?? "bg-slate-100 text-slate-600";
    return (
      <Link href="/contacts" className="group flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs transition-colors hover:bg-slate-100">
        <UserPlus className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 truncate">{d?.name as string}</p>
          <p className="text-slate-500">{action}</p>
        </div>
        <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${typeColor}`}>
          {(d?.type as string)?.toLowerCase()}
        </span>
        <ExternalLink className="h-3 w-3 text-slate-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>
    );
  }

  // ── Account creation ──────────────────────────────────────────────────────

  if (result.tool === "create_account") {
    const typeColor = ACCT_TYPE_COLORS[d?.type as string] ?? "bg-slate-100 text-slate-700";
    return (
      <Link href="/accounts" className="group flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs transition-colors hover:bg-slate-100">
        <BookOpen className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 truncate">
            <span className="font-mono mr-1.5">{d?.code as string}</span>{d?.name as string}
          </p>
          <p className="text-slate-500">Account created</p>
        </div>
        <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${typeColor}`}>
          {(d?.type as string)?.toLowerCase()}
        </span>
        <ExternalLink className="h-3 w-3 text-slate-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>
    );
  }

  // ── List cards ────────────────────────────────────────────────────────────

  if (result.tool === "list_invoices") {
    const items = result.data as unknown as { id: string; number: string; customer: string; dueDate: string; total: number; outstanding: number; status: string }[];
    return (
      <div className="rounded-xl border border-blue-200 bg-white overflow-hidden text-xs">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-blue-50 border-b border-blue-200">
          <div className="flex items-center gap-1.5 font-semibold text-blue-800">
            <FileText className="h-3.5 w-3.5" />
            Invoices
            <span className="font-normal text-blue-500 text-[10px]">({items.length})</span>
          </div>
          <Link href="/invoices" className="text-blue-400 hover:text-blue-600 transition-colors"><ExternalLink className="h-3 w-3" /></Link>
        </div>
        <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
          {items.map((inv) => (
            <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-blue-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-semibold text-slate-800">{inv.number}</span>
                  <StatusBadge status={inv.status} />
                </div>
                <p className="text-slate-500 truncate">{inv.customer} · Due {fmtDate(inv.dueDate)}</p>
              </div>
              <span className="shrink-0 tabular-nums font-semibold text-slate-800">
                {fmt(inv.outstanding)}
              </span>
            </Link>
          ))}
          {items.length === 0 && <p className="py-6 text-center text-slate-400">No invoices found</p>}
        </div>
      </div>
    );
  }

  if (result.tool === "list_bills") {
    const items = result.data as unknown as { id: string; number: string | null; supplier: string; dueDate: string; total: number; outstanding: number; status: string }[];
    return (
      <div className="rounded-xl border border-amber-200 bg-white overflow-hidden text-xs">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-amber-50 border-b border-amber-200">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <Receipt className="h-3.5 w-3.5" />
            Bills
            <span className="font-normal text-amber-500 text-[10px]">({items.length})</span>
          </div>
          <Link href="/bills" className="text-amber-400 hover:text-amber-600 transition-colors"><ExternalLink className="h-3 w-3" /></Link>
        </div>
        <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
          {items.map((b) => (
            <Link key={b.id} href={`/bills/${b.id}`} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-amber-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-semibold text-slate-800">{b.number ?? "—"}</span>
                  <StatusBadge status={b.status} />
                </div>
                <p className="text-slate-500 truncate">{b.supplier} · Due {fmtDate(b.dueDate)}</p>
              </div>
              <span className="shrink-0 tabular-nums font-semibold text-slate-800">
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
    const lines = d?.lines as { description: string; quantity: number; unitPrice: number; amount: number }[] | undefined;
    const isPartial = outstanding > 0 && outstanding < total;

    return (
      <Link href={href} className="group block rounded-xl border border-slate-200 bg-white overflow-hidden text-xs transition-colors hover:bg-slate-50">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Icon className="h-3.5 w-3.5" />
            {isInvoice ? "Invoice" : "Bill"} {d?.number as string ?? "—"}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={d?.status as string} />
            <ExternalLink className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
        <div className="px-3.5 py-3 space-y-1.5 text-slate-700">
          <Row label={partyLabel} value={<span className="text-slate-900">{party}</span>} />
          <Row label="Issued" value={fmtDate(d?.date)} />
          <Row label="Due" value={fmtDate(d?.dueDate)} />
        </div>
        {lines && lines.length > 0 && (
          <div className="border-t border-slate-100 divide-y divide-slate-100 max-h-36 overflow-y-auto">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3.5 py-1.5 text-slate-600">
                <span className="truncate">{l.description}</span>
                <span className="tabular-nums text-slate-400 text-[10px]">{l.quantity}×{fmt(l.unitPrice)}</span>
                <span className="tabular-nums text-right font-medium text-slate-700">{fmt(l.amount)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-slate-200 bg-slate-50">
          <span className="text-slate-500">Total</span>
          <div className="text-right">
            <span className="font-bold tabular-nums text-slate-900">{fmt(total)}</span>
            {isPartial && (
              <p className="text-[10px] text-amber-600 tabular-nums">{fmt(outstanding)} outstanding</p>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // ── Contacts list ─────────────────────────────────────────────────────────

  if (result.tool === "list_contacts") {
    const items = result.data as unknown as { id: string; name: string; type: string; email: string | null }[];
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Users className="h-3.5 w-3.5" />
            Contacts
            <span className="font-normal text-slate-400 text-[10px]">({items.length})</span>
          </div>
          <Link href="/contacts" className="text-slate-400 hover:text-slate-600 transition-colors"><ExternalLink className="h-3 w-3" /></Link>
        </div>
        <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
          {items.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate">{c.name}</p>
                {c.email && <p className="text-slate-400 truncate">{c.email}</p>}
              </div>
              <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${CONTACT_TYPE_COLORS[c.type] ?? "bg-slate-100 text-slate-600"}`}>
                {c.type.toLowerCase()}
              </span>
            </div>
          ))}
          {items.length === 0 && <p className="py-6 text-center text-slate-400">No contacts found</p>}
        </div>
      </div>
    );
  }

  // ── Accounts list ─────────────────────────────────────────────────────────

  if (result.tool === "list_accounts") {
    const items = result.data as unknown as { code: string; name: string; type: string }[];
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <BookOpen className="h-3.5 w-3.5" />
            Chart of Accounts
            <span className="font-normal text-slate-400 text-[10px]">({items.length})</span>
          </div>
          <Link href="/accounts" className="text-slate-400 hover:text-slate-600 transition-colors"><ExternalLink className="h-3 w-3" /></Link>
        </div>
        <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
          {items.map((a) => (
            <div key={a.code} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-3.5 py-2">
              <span className="font-mono text-[10px] text-slate-400">{a.code}</span>
              <span className="truncate text-slate-800 font-medium">{a.name}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${ACCT_TYPE_COLORS[a.type] ?? "bg-slate-100 text-slate-600"}`}>
                {a.type.toLowerCase()}
              </span>
            </div>
          ))}
          {items.length === 0 && <p className="py-6 text-center text-slate-400">No accounts found</p>}
        </div>
      </div>
    );
  }

  // ── Account balance ───────────────────────────────────────────────────────

  if (result.tool === "get_account_balance") {
    const balance = d?.balance as number;
    const isNeg = balance < 0;
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
          <BookOpen className="h-3.5 w-3.5" />
          Account Balance
        </div>
        <div className="flex items-center justify-between gap-4 px-3.5 py-3">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 truncate">
              <span className="font-mono text-slate-400 mr-1.5">{d?.code as string}</span>{d?.name as string}
            </p>
            <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${ACCT_TYPE_COLORS[d?.type as string] ?? "bg-slate-100 text-slate-600"}`}>
              {(d?.type as string)?.toLowerCase()}
            </span>
          </div>
          <span className={`shrink-0 text-lg font-bold tabular-nums ${isNeg ? "text-red-600" : "text-slate-900"}`}>
            {isNeg && "−"}{fmt(Math.abs(balance))}
          </span>
        </div>
      </div>
    );
  }

  // ── Transactions search ───────────────────────────────────────────────────

  if (result.tool === "search_transactions") {
    const items = result.data as unknown as { id: string; date: string; description: string; lines: { account: string; debit: number | null; credit: number | null }[] }[];
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Search className="h-3.5 w-3.5" />
            Transactions
            <span className="font-normal text-slate-400 text-[10px]">({items.length})</span>
          </div>
          <Link href="/transactions" className="text-slate-400 hover:text-slate-600 transition-colors"><ExternalLink className="h-3 w-3" /></Link>
        </div>
        <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
          {items.map((e) => (
            <div key={e.id} className="px-3.5 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-800 truncate">{e.description}</span>
                <span className="shrink-0 text-slate-400">{fmtDate(e.date)}</span>
              </div>
              {e.lines.slice(0, 2).map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_72px] gap-2 text-slate-500">
                  <span className="truncate">{l.account}</span>
                  <span className="tabular-nums text-right text-[10px]">
                    {l.debit ? `DR ${fmt(l.debit)}` : `CR ${fmt(l.credit)}`}
                  </span>
                </div>
              ))}
              {e.lines.length > 2 && (
                <p className="text-slate-400 text-[10px]">+{e.lines.length - 2} more lines</p>
              )}
            </div>
          ))}
          {items.length === 0 && <p className="py-6 text-center text-slate-400">No transactions found</p>}
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
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <TrendingUp className="h-3.5 w-3.5" />
            Profit & Loss
          </div>
          <p className="text-slate-400 mt-0.5">{fmtDate(period?.startDate)} – {fmtDate(period?.endDate)}</p>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {/* Income */}
          <div className="px-3.5 py-2.5 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Income</p>
            {Object.entries(income ?? {}).map(([name, val]) => (
              <div key={name} className="grid grid-cols-[1fr_auto] gap-3 text-slate-700">
                <span className="truncate text-slate-500">{name}</span>
                <span className="tabular-nums">{fmt(val)}</span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto] gap-3 font-semibold text-emerald-700 border-t border-slate-100 pt-1.5">
              <span>Total Income</span>
              <span className="tabular-nums">{fmt(d?.totalIncome)}</span>
            </div>
          </div>
          {/* Expenses */}
          <div className="px-3.5 py-2.5 space-y-1.5 border-t border-slate-100">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-red-500">Expenses</p>
            {Object.entries(expenses ?? {}).map(([name, val]) => (
              <div key={name} className="grid grid-cols-[1fr_auto] gap-3 text-slate-700">
                <span className="truncate text-slate-500">{name}</span>
                <span className="tabular-nums">{fmt(val)}</span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto] gap-3 font-semibold text-red-600 border-t border-slate-100 pt-1.5">
              <span>Total Expenses</span>
              <span className="tabular-nums">{fmt(d?.totalExpenses)}</span>
            </div>
          </div>
        </div>
        <div className={`grid grid-cols-[1fr_auto] gap-3 px-3.5 py-3 border-t-2 font-bold text-sm ${isLoss ? "border-red-300 bg-red-50 text-red-700" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
          <span>{isLoss ? "Net Loss" : "Net Profit"}</span>
          <span className="tabular-nums">{fmt(Math.abs(net))}</span>
        </div>
      </div>
    );
  }

  // ── Balance Sheet ─────────────────────────────────────────────────────────

  if (result.tool === "get_balance_sheet") {
    const sections = [
      { label: "Assets", data: d?.assets as Record<string, number>, total: d?.totalAssets as number, accent: "text-blue-600", border: "border-blue-200", bg: "bg-blue-50" },
      { label: "Liabilities", data: d?.liabilities as Record<string, number>, total: d?.totalLiabilities as number, accent: "text-red-600", border: "border-red-200", bg: "bg-red-50" },
      { label: "Equity", data: d?.equity as Record<string, number>, total: d?.totalEquity as number, accent: "text-purple-600", border: "border-purple-200", bg: "bg-purple-50" },
    ];
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Landmark className="h-3.5 w-3.5" />
            Balance Sheet
          </div>
          <p className="text-slate-400 mt-0.5">As of {fmtDate(d?.asOfDate)}</p>
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
          {sections.map(({ label, data, total, accent, border, bg }) => (
            <div key={label} className="px-3.5 py-2.5 space-y-1.5">
              <p className={`text-[10px] font-bold uppercase tracking-widest ${accent}`}>{label}</p>
              {Object.entries(data ?? {}).map(([name, val]) => (
                <div key={name} className="grid grid-cols-[1fr_auto] gap-3 text-slate-600">
                  <span className="truncate text-slate-500">{name}</span>
                  <span className="tabular-nums">{fmt(val)}</span>
                </div>
              ))}
              <div className={`grid grid-cols-[1fr_auto] gap-3 font-semibold ${accent} rounded-lg ${bg} border ${border} px-2 py-1 mt-1`}>
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
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Table2 className="h-3.5 w-3.5" />
            Trial Balance
          </div>
          <p className="text-slate-400 mt-0.5">{fmtDate(period?.startDate)} – {fmtDate(period?.endDate)}</p>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <div className="grid grid-cols-[1fr_76px_76px] px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400 border-b border-slate-200 bg-slate-50">
            <span>Account</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
          </div>
          {Object.entries(accounts ?? {}).map(([name, bal]) => (
            <div key={name} className="grid grid-cols-[1fr_76px_76px] px-3.5 py-1.5 text-slate-700 border-b border-slate-100 hover:bg-slate-50">
              <span className="truncate text-slate-600">{name}</span>
              <span className="tabular-nums text-right text-slate-800">{bal.debit > 0 ? fmt(bal.debit) : ""}</span>
              <span className="tabular-nums text-right text-slate-800">{bal.credit > 0 ? fmt(bal.credit) : ""}</span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_76px_76px] px-3.5 py-2 font-bold text-slate-900 border-t-2 border-slate-300 bg-slate-50">
            <span>Total</span>
            <span className="tabular-nums text-right">{fmt(d?.totalDebit)}</span>
            <span className="tabular-nums text-right">{fmt(d?.totalCredit)}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── AR / AP Aging ─────────────────────────────────────────────────────────

  if (result.tool === "get_ar_aging" || result.tool === "get_ap_aging") {
    const isAR = result.tool === "get_ar_aging";
    const aging = d?.aging as Record<string, number>;
    const details = d?.details as { customer?: string; supplier?: string; amount: number; daysOverdue: number }[];
    const total = d?.total as number;
    const c = isAR
      ? { text: "text-blue-800", muted: "text-blue-500", track: "bg-blue-100", bar: "bg-blue-400", row: "hover:bg-blue-50", border: "border-blue-200", header: "bg-blue-50" }
      : { text: "text-amber-800", muted: "text-amber-500", track: "bg-amber-100", bar: "bg-amber-400", row: "hover:bg-amber-50", border: "border-amber-200", header: "bg-amber-50" };
    const buckets: [string, string][] = [["current", "Current"], ["1-30", "1–30 d"], ["31-60", "31–60 d"], ["61-90", "61–90 d"], ["90+", "90+ d"]];

    return (
      <div className={`rounded-xl border ${c.border} bg-white overflow-hidden text-xs`}>
        <div className={`flex items-center justify-between px-3.5 py-2.5 ${c.header} border-b ${c.border}`}>
          <div className={`flex items-center gap-1.5 font-semibold ${c.text}`}>
            <Clock className="h-3.5 w-3.5" />
            {isAR ? "AR Aging" : "AP Aging"}
          </div>
          <span className={`font-bold tabular-nums ${c.text}`}>{fmt(total)}</span>
        </div>
        <div className="px-3.5 py-3 space-y-2">
          {buckets.map(([key, label]) => {
            const val = aging?.[key] ?? 0;
            const pct = total > 0 ? Math.round((val / total) * 100) : 0;
            return (
              <div key={key} className="grid grid-cols-[52px_1fr_68px] items-center gap-2">
                <span className={`${c.muted} text-[10px]`}>{label}</span>
                <div className={`h-1.5 rounded-full ${c.track} overflow-hidden`}>
                  <div className={`h-full rounded-full ${c.bar} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`tabular-nums text-right font-medium ${c.text}`}>{fmt(val)}</span>
              </div>
            );
          })}
        </div>
        {details && details.length > 0 && (
          <div className={`border-t ${c.border} divide-y divide-slate-100 max-h-36 overflow-y-auto`}>
            {details.map((item, i) => (
              <div key={i} className={`flex items-center justify-between gap-3 px-3.5 py-2 ${c.row} transition-colors`}>
                <span className={`truncate ${c.text}`}>{item.customer ?? item.supplier}</span>
                <div className="shrink-0 flex items-center gap-1.5">
                  <span className={`tabular-nums font-semibold ${c.text}`}>{fmt(item.amount)}</span>
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const CARD_TOOLS = new Set([
    "create_invoice", "create_bill", "create_journal_entry",
    "record_invoice_payment", "record_bill_payment",
    "void_invoice", "void_bill", "void_transaction",
    "send_invoice", "approve_bill",
    "create_contact", "update_contact",
    "create_account",
    "list_invoices", "list_bills", "get_invoice", "get_bill",
    "list_contacts", "list_accounts", "get_account_balance",
    "search_transactions",
    "get_profit_and_loss", "get_balance_sheet", "get_trial_balance",
    "get_ar_aging", "get_ap_aging",
  ]);
  const toolResults = (message.toolResults ?? []).filter((r) => CARD_TOOLS.has(r.tool) || !r.success);

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isUser ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={`flex flex-col gap-2 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        {message.content && (stripToolCalls(message.content) || toolResults.length === 0) && (
          <div className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm"}`}>
            <p className="whitespace-pre-wrap">{isUser ? message.content : stripToolCalls(message.content)}</p>
          </div>
        )}
        {toolResults.map((r, i) => (
          <ToolResultCard key={i} result={r} />
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
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [loadConvId, setLoadConvId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const { data: conversations, refetch: refetchConversations } = trpc.chat.listConversations.useQuery(
    undefined,
    { enabled: isOpen, retry: false },
  );

  const { data: conversationData } = trpc.chat.getConversation.useQuery(
    { id: loadConvId! },
    { enabled: !!loadConvId, retry: false },
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
          createdAt: m.createdAt,
        })),
      );
      setConversationId(loadConvId);
      setLoadConvId(null);
    }
  }, [conversationData, loadConvId]);

  const handleStreamMessage = useCallback(async (userMessage: string) => {
    setIsStreaming(true);
    setIsThinking(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          conversationId: conversationId ?? undefined,
        }),
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
          try { data = JSON.parse(eventData); } catch { continue; }

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
          createdAt: new Date(),
        },
      ]);

      if (streamConvId && streamConvId !== conversationId) {
        setConversationId(streamConvId);
      }
      refetchConversations();
    } catch (err) {

      if ((err as Error).name !== "AbortError") {
        toast({ variant: "destructive", title: (err as Error).message || "Failed to get response" });
      }
    } finally {
      setIsStreaming(false);
      setIsThinking(false);
      setStreamingContent("");
      abortRef.current = null;
    }
  }, [conversationId, toast, refetchConversations]);

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
            {isStreaming && (
              <div className="flex gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div className="flex flex-col gap-2 max-w-[85%] items-start">
                  <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-sm leading-relaxed">
                    {streamingContent ? (
                      <p className="whitespace-pre-wrap">
                        {streamingContent}
                        <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-middle" />
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 py-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-foreground/50 animate-bounce [animation-delay:300ms]" />
                        {isThinking && <span className="text-xs text-muted-foreground ml-1">Thinking...</span>}
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
