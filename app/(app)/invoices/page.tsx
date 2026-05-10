"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Search, MoreHorizontal, Eye, FileText, Loader2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

type StatusFilter = "ALL" | "DRAFT" | "SENT" | "PARTIAL" | "PAID" | "OVERDUE" | "VOID";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  DRAFT:   { label: "Draft",   cls: "status-draft" },
  SENT:    { label: "Sent",    cls: "status-sent" },
  PARTIAL: { label: "Partial", cls: "status-partial" },
  PAID:    { label: "Paid",    cls: "status-paid" },
  OVERDUE: { label: "Overdue", cls: "status-overdue" },
  VOID:    { label: "Void",    cls: "status-void" },
};

export default function InvoicesPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, refetch, isLoading } = trpc.invoices.list.useQuery({
    status,
    search: search || undefined,
    page,
  });
  const { data: orgData } = trpc.org.get.useQuery();
  const currency = orgData?.currency ?? "USD";

  const sendMutation = trpc.invoices.send.useMutation({
    onSuccess: () => { toast({ title: "Invoice sent" }); refetch(); },
    onError: (e) => toast({ variant: "destructive", title: e.message }),
  });

  const items = data?.items ?? [];
  const pages = data?.pages ?? 1;

  return (
    <div className="min-h-full">
      <div className="border-b border-border/60 bg-white/60 backdrop-blur-sm px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif text-foreground">Invoices</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage customer invoices and payments</p>
          </div>
          <Button size="sm" asChild>
            <Link href="/invoices/new"><Plus className="h-4 w-4" /> New Invoice</Link>
          </Button>
        </div>
      </div>
      <div className="p-8 space-y-5">

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => { setStatus(v as StatusFilter); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="ALL">All</TabsTrigger>
            <TabsTrigger value="DRAFT">Draft</TabsTrigger>
            <TabsTrigger value="SENT">Sent</TabsTrigger>
            <TabsTrigger value="PARTIAL">Partial</TabsTrigger>
            <TabsTrigger value="PAID">Paid</TabsTrigger>
            <TabsTrigger value="OVERDUE">Overdue</TabsTrigger>
            <TabsTrigger value="VOID">Void</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by number or contact…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead className="hidden md:table-cell">Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right hidden lg:table-cell">Amount Due</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileText className="h-8 w-8" />
                      <p>No invoices yet. <Link href="/invoices/new" className="text-primary hover:underline">Create one</Link></p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {items.map((inv) => (
                <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-mono font-medium">
                    <Link href={`/invoices/${inv.id}`} className="hover:underline">{inv.number}</Link>
                  </TableCell>
                  <TableCell>{inv.contact.name}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${STATUS_META[inv.effectiveStatus]?.cls ?? "status-draft"}`}>
                      {STATUS_META[inv.effectiveStatus]?.label ?? inv.effectiveStatus}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{formatDate(inv.date)}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{formatDate(inv.dueDate)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(Number(inv.totalAmount), currency)}</TableCell>
                  <TableCell className="hidden lg:table-cell text-right text-sm text-muted-foreground">
                    {inv.amountDue > 0 ? formatCurrency(inv.amountDue, currency) : "—"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/invoices/${inv.id}`}><Eye className="mr-2 h-3.5 w-3.5" /> View</Link>
                        </DropdownMenuItem>
                        {inv.effectiveStatus === "DRAFT" && (
                          <DropdownMenuItem
                            disabled={sendMutation.isPending}
                            onSelect={() => sendMutation.mutate({ id: inv.id, sendEmail: true })}
                          >
                            Send
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem asChild>
                          <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer">Download PDF</a>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="flex items-center text-sm text-muted-foreground">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
      </div>
    </div>
  );
}
