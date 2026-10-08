"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DRAFT_KINDS } from "@/server/services/outreach/types";
import { AiNotice } from "../../_components/ai-notice";
import { ConversationPanel } from "../../_components/conversation-panel";
import { DraftList } from "../../_components/draft-list";
import { ACTION_LABEL, dueText, ENRICHMENT_LABEL } from "../../_components/labels";
import { OutreachGate } from "../../_components/outreach-gate";
import { ProposalPanel } from "../../_components/proposal-panel";
import {
  CrmCard,
  EventLog,
  PrivacyCard,
  ScoreCard,
  type Confirm,
} from "../../_components/side-panels";
import { StageBadge } from "../../_components/stage-badge";
import { TeardownPanel } from "../../_components/teardown-panel";
import type { ProspectDetail } from "../../_components/types";

export default function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <OutreachGate>
      <ProspectBody id={id} />
    </OutreachGate>
  );
}

function ProspectBody({ id }: { id: string }) {
  const { data, isLoading, error, refetch, isFetching } = trpc.outreachProspects.get.useQuery(
    { id },
    { retry: (count, e) => e.data?.code !== "NOT_FOUND" && count < 3 }
  );
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  if (error && !data) {
    const notFound = error.data?.code === "NOT_FOUND";
    return (
      <div className="space-y-3 p-6 text-sm">
        <p className="text-destructive">
          {notFound ? "This prospect doesn't exist or was deleted." : error.message}
        </p>
        <div className="flex items-center gap-4">
          {!notFound && (
            <Button size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
              Retry
            </Button>
          )}
          <Link href="/outreach/prospects" className="underline">
            Back to prospects
          </Link>
        </div>
      </div>
    );
  }
  if (isLoading || !data) return <div className="bg-muted m-6 h-96 animate-pulse rounded-xl" />;
  const { prospect: p } = data;
  const optedOut = p.stage === "DNC";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={p.name}
        description={[p.title, p.company].filter(Boolean).join(" at ")}
        action={
          <div className="flex items-center gap-3">
            <StageBadge stage={p.stage} />
            <a
              href={p.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
            >
              Open in Sales Navigator <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        }
      />
      <div className="flex flex-col gap-6 px-6 pb-6">
        <Link
          href="/outreach/prospects"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Prospects
        </Link>
        <AiNotice />

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-6">
            {data.next && (
              <div className="border-border/60 bg-muted/40 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
                <Clock className="text-muted-foreground h-4 w-4" />
                Next step: <span className="font-medium">{ACTION_LABEL[data.next.kind]}</span>
                <span className="text-muted-foreground">
                  · {dueText(data.next.dueAt, new Date())}
                </span>
              </div>
            )}
            {optedOut ? (
              <p className="border-border text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
                This person is on your do-not-contact list, so nothing more can be drafted.
              </p>
            ) : (
              <>
                <DraftsCard data={data} />
                <ConversationPanel
                  data={data}
                  onHandoffError={setHandoffError}
                  onDnc={() => setConfirm("dnc")}
                />
                {["ENGAGED", "TEARDOWN", "PILOT"].includes(p.stage) && (
                  <TeardownPanel data={data} />
                )}
                {["TEARDOWN", "PILOT"].includes(p.stage) && <ProposalPanel data={data} />}
              </>
            )}
          </div>
          <aside className="space-y-6">
            <ScoreCard data={data} />
            <EventLog data={data} onHandoffError={setHandoffError} />
            <CrmCard data={data} handoffError={handoffError} onHandoffError={setHandoffError} />
            <PrivacyCard data={data} confirm={confirm} setConfirm={setConfirm} />
            <p className="text-muted-foreground text-xs">
              {ENRICHMENT_LABEL[p.enrichmentStatus] ?? p.enrichmentStatus}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function DraftsCard({ data }: { data: ProspectDetail }) {
  const id = data.prospect.id;
  const utils = trpc.useUtils();
  const generate = trpc.outreachDrafts.generate.useMutation({
    onSuccess: () => utils.outreachProspects.get.invalidate({ id }),
  });
  const kinds = DRAFT_KINDS.filter((k) => k !== "REPLY"); // replies live in the conversation panel
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Drafts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {kinds.map((kind) => (
          <DraftList
            key={kind}
            kind={kind}
            drafts={data.drafts.filter((d) => d.kind === kind)}
            busy={generate.isPending}
            error={generate.variables?.kind === kind ? generate.error?.message : null}
            onGenerate={() => generate.mutate({ id, kind })}
          />
        ))}
      </CardContent>
    </Card>
  );
}
