"use client";

import { use } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

const STATUS_COLOR: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  CONTACTED: "bg-amber-100 text-amber-700",
  QUALIFIED: "bg-emerald-100 text-emerald-700",
  UNQUALIFIED: "bg-slate-100 text-slate-600",
  CONVERTED: "bg-purple-100 text-purple-700",
};

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();

  const { data: lead, isLoading } = trpc.crmLeads.get.useQuery({ id });

  const convert = trpc.crmLeads.convert.useMutation({
    onSuccess: (data) => {
      utils.crmLeads.get.invalidate({ id });
      toast.success("Lead converted! New deal created.");
      router.push(`/crm/deals/${data.dealId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>;
  if (!lead) return <div className="p-6 text-muted-foreground">Lead not found.</div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-2">
        <Link href="/crm/leads"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Leads</Button></Link>
      </div>

      <PageHeader
        title={`${lead.firstName} ${lead.lastName}`}
        description={lead.companyName ?? "Individual lead"}
        action={
          lead.status === "QUALIFIED" && !lead.convertedContactId ? (
            <Button size="sm" disabled={convert.isPending} onClick={() => convert.mutate({ id: lead.id })}>
              {convert.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-1" /> : <ArrowRight className="h-4 w-4 mr-1" />}
              Convert to Contact
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Lead Details</h2>
          <div className="space-y-3 text-sm">
            {[
              { label: "Status", value: <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[lead.status]}`}>{lead.status.replace("_", " ")}</span> },
              { label: "Email", value: lead.email ?? "—" },
              { label: "Phone", value: lead.phone ?? "—" },
              { label: "Job title", value: lead.jobTitle ?? "—" },
              { label: "Source", value: lead.source.replace("_", " ") },
              { label: "Est. value", value: lead.estimatedValue ? `$${Number(lead.estimatedValue).toLocaleString()}` : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-start gap-3">
                <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold">Notes</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{lead.notes ?? "No notes added."}</p>
          {lead.convertedContactId && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">Converted on {lead.convertedAt ? new Date(lead.convertedAt).toLocaleDateString() : "—"}</p>
              <Link href={`/contacts`} className="text-xs text-primary hover:underline">View contact →</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
