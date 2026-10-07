"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SignalName, Stage } from "@/server/services/outreach/types";
import { SIGNAL_LABEL, STAGE_LABEL, STAGES } from "../_components/labels";
import { OutreachGate } from "../_components/outreach-gate";
import { ScoreChip } from "../_components/score-chip";
import { StageBadge } from "../_components/stage-badge";

export default function ProspectsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Prospects"
        description="Everyone you're working, highest fit first."
        action={
          <Button size="sm" asChild>
            <Link href="/outreach/prospects/new">
              <Plus className="mr-1 h-4 w-4" /> Add prospect
            </Link>
          </Button>
        }
      />
      <OutreachGate>
        <ProspectTable />
      </OutreachGate>
    </div>
  );
}

function ProspectTable() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage | "ALL">("ALL");
  const {
    data: rows,
    isLoading,
    isError,
    refetch,
  } = trpc.outreachProspects.list.useQuery(stage === "ALL" ? undefined : { stage });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {(["ALL", ...STAGES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStage(s)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              stage === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {s === "ALL" ? "All" : STAGE_LABEL[s]}
          </button>
        ))}
      </div>
      {isError ? (
        <div className="border-border/60 space-y-3 rounded-xl border p-4">
          <p className="text-destructive text-sm">Couldn&apos;t load your prospects.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : isLoading || !rows ? (
        <div className="bg-muted h-64 animate-pulse rounded-xl" />
      ) : rows.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          {stage === "ALL"
            ? "No prospects yet. Add one from a Sales Navigator profile."
            : `No prospects in ${STAGE_LABEL[stage]}.`}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Score</TableHead>
              <TableHead>Prospect</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Primary signal</TableHead>
              <TableHead className="text-right">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                onClick={() => router.push(`/outreach/prospects/${p.id}`)}
              >
                <TableCell>
                  <ScoreChip score={p.score} />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/outreach/prospects/${p.id}`}
                    className="font-medium hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.name}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {[p.title, p.company].filter(Boolean).join(" at ")}
                  </p>
                </TableCell>
                <TableCell>
                  <StageBadge stage={p.stage} />
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {p.primarySignal
                    ? (SIGNAL_LABEL[p.primarySignal as SignalName] ?? p.primarySignal)
                    : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                  {new Date(p.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
