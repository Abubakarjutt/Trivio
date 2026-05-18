"use client";

import { use, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ArrowLeft, Trophy, XCircle, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

const ACTIVITY_TYPE_COLOR: Record<string, string> = {
  CALL: "bg-blue-100 text-blue-700",
  EMAIL: "bg-indigo-100 text-indigo-700",
  MEETING: "bg-emerald-100 text-emerald-700",
  NOTE: "bg-amber-100 text-amber-700",
  TASK: "bg-slate-100 text-slate-700",
};

function fmt(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();

  const [closeDialog, setCloseDialog] = useState(false);
  const [outcome, setOutcome] = useState<"WON" | "LOST">("WON");
  const [reason, setReason] = useState("");

  const { data: deal, isLoading } = trpc.crmDeals.get.useQuery({ id });

  const close = trpc.crmDeals.close.useMutation({
    onSuccess: () => { utils.crmDeals.get.invalidate({ id }); setCloseDialog(false); toast.success(`Deal marked ${outcome}`); },
    onError: (e) => toast.error(e.message),
  });

  const convertToInvoice = trpc.crmDeals.convertToInvoice.useMutation({
    onSuccess: (data) => {
      utils.crmDeals.get.invalidate({ id });
      toast.success("Invoice created from deal");
      router.push(`/invoices/${data.invoiceId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>;
  if (!deal) return <div className="p-6 text-muted-foreground">Deal not found.</div>;

  const isWon = deal.probability === 100 || deal.invoiceId != null;
  const isClosed = deal.closedAt != null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link href="/crm/deals"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Deals</Button></Link>

      <PageHeader
        title={deal.name}
        description={`${deal.contact.name} · ${deal.stage.name}`}
        action={
          <div className="flex gap-2">
            {!isClosed && (
              <>
                <Button variant="outline" size="sm" onClick={() => { setOutcome("LOST"); setCloseDialog(true); }}>
                  <XCircle className="h-4 w-4 mr-1 text-red-500" /> Lost
                </Button>
                <Button size="sm" onClick={() => { setOutcome("WON"); setCloseDialog(true); }}>
                  <Trophy className="h-4 w-4 mr-1" /> Won
                </Button>
              </>
            )}
            {isWon && !deal.invoiceId && (
              <Button size="sm" variant="outline" disabled={convertToInvoice.isPending} onClick={() => convertToInvoice.mutate({ id: deal.id })}>
                {convertToInvoice.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
                Convert to Invoice
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Deal info */}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Deal Details</h2>
          <div className="space-y-3 text-sm">
            {[
              { label: "Value", value: fmt(Number(deal.value)) },
              { label: "Probability", value: `${deal.probability}%` },
              { label: "Stage", value: deal.stage.name },
              { label: "Pipeline", value: deal.pipeline.name },
              { label: "Contact", value: deal.contact.name },
              { label: "Company", value: deal.crmCompany?.name ?? "—" },
              { label: "Close date", value: deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString() : "—" },
              { label: "Source", value: deal.source ?? "—" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-start gap-3">
                <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
          {isClosed && (
            <div className={`rounded-lg p-3 mt-2 ${isWon ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
              <p className={`text-sm font-medium flex items-center gap-1 ${isWon ? "text-emerald-700" : "text-red-700"}`}>
                {isWon ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {isWon ? "Won" : "Lost"} on {new Date(deal.closedAt!).toLocaleDateString()}
              </p>
              {deal.wonLostReason && <p className="text-xs text-muted-foreground mt-1">Reason: {deal.wonLostReason}</p>}
            </div>
          )}
          {deal.invoiceId && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Linked invoice</p>
              <Link href={`/invoices/${deal.invoiceId}`} className="flex items-center gap-1 text-sm text-primary hover:underline">
                <FileText className="h-3.5 w-3.5" />
                {deal.invoice?.number ?? "View invoice"}
                <span className="text-xs text-muted-foreground">({deal.invoice?.status})</span>
              </Link>
            </div>
          )}
        </div>

        {/* Activity timeline */}
        <div className="md:col-span-2 rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Activity Timeline ({deal.activities.length})</h2>
          {deal.activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activities logged yet.</p>
          ) : (
            <div className="space-y-3">
              {deal.activities.map((a) => (
                <div key={a.id} className="flex gap-3">
                  <span className={`mt-0.5 px-2 py-0.5 rounded text-xs font-medium shrink-0 h-fit ${ACTIVITY_TYPE_COLOR[a.type]}`}>{a.type}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{a.subject}</p>
                    {a.notes && <p className="text-xs text-muted-foreground mt-0.5">{a.notes}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      {a.createdBy.name} · {new Date(a.createdAt).toLocaleDateString()}
                      {a.completedAt && <span className="text-emerald-600 ml-1">✓ Completed</span>}
                      {a.dueDate && !a.completedAt && <span className={new Date(a.dueDate) < new Date() ? "text-red-600 ml-1" : "text-muted-foreground ml-1"}>
                        Due {new Date(a.dueDate).toLocaleDateString()}
                      </span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Close deal dialog */}
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark Deal {outcome === "WON" ? "Won" : "Lost"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {outcome === "WON"
                ? "Congratulations! You can convert this deal to an invoice after marking it won."
                : "Sorry to hear that. Adding a reason helps track why deals are lost."}
            </p>
            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Input placeholder={outcome === "WON" ? "e.g. Annual contract signed" : "e.g. Budget constraints"} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)}>Cancel</Button>
            <Button
              variant={outcome === "LOST" ? "destructive" : "default"}
              disabled={close.isPending}
              onClick={() => close.mutate({ id: deal.id, outcome, reason: reason || undefined })}
            >
              {close.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />}
              Mark {outcome === "WON" ? "Won" : "Lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
