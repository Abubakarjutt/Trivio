"use client";

import { use } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Globe, Phone } from "lucide-react";
import Link from "next/link";

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: company, isLoading } = trpc.crmCompanies.get.useQuery({ id });

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>;
  if (!company) return <div className="p-6 text-muted-foreground">Company not found.</div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link href="/crm/companies"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Companies</Button></Link>

      <PageHeader title={company.name} description={`${company.industry ?? "Company"} · ${company.size}`} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Company info */}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Details</h2>
          {company.website && (
            <a href={company.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
              <Globe className="h-4 w-4" />{company.website}
            </a>
          )}
          {company.phone && (
            <p className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4 text-muted-foreground" />{company.phone}</p>
          )}
          {company.linkedContact && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Linked contact</p>
              <p className="text-sm font-medium">{company.linkedContact.name}</p>
              {company.linkedContact.email && <p className="text-xs text-muted-foreground">{company.linkedContact.email}</p>}
            </div>
          )}
          {company.notes && <div className="pt-2 border-t"><p className="text-xs text-muted-foreground">Notes</p><p className="text-sm mt-1">{company.notes}</p></div>}
        </div>

        {/* Deals */}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Deals ({company.deals.length})</h2>
          {company.deals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals associated.</p>
          ) : (
            <div className="space-y-2">
              {company.deals.map((deal) => (
                <Link key={deal.id} href={`/crm/deals/${deal.id}`} className="block p-2 rounded-lg hover:bg-muted/50 transition-colors">
                  <p className="text-sm font-medium">{deal.name}</p>
                  <p className="text-xs text-muted-foreground">{deal.stage.name} · ${Number(deal.value).toLocaleString()}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Activities */}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Activities ({company.activities.length})</h2>
          {company.activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activities logged.</p>
          ) : (
            <div className="space-y-2">
              {company.activities.slice(0, 5).map((a) => (
                <div key={a.id} className="p-2 rounded-lg bg-muted/30">
                  <p className="text-xs font-medium">{a.type} — {a.subject}</p>
                  <p className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
