"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, GripVertical, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export default function PipelinesSettingsPage() {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [pipelineName, setPipelineName] = useState("");
  const [newStageForms, setNewStageForms] = useState<Record<string, { name: string; probability: string }>>({});

  const { data: pipelines = [], isLoading } = trpc.crmPipelines.list.useQuery();

  const createPipeline = trpc.crmPipelines.create.useMutation({
    onSuccess: () => { utils.crmPipelines.list.invalidate(); setNewPipelineOpen(false); setPipelineName(""); toast.success("Pipeline created"); },
    onError: (e) => toast.error(e.message),
  });

  const deletePipeline = trpc.crmPipelines.delete.useMutation({
    onSuccess: () => { utils.crmPipelines.list.invalidate(); toast.success("Pipeline deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const createStage = trpc.crmPipelines.createStage.useMutation({
    onSuccess: (_, vars) => {
      utils.crmPipelines.list.invalidate();
      setNewStageForms((f) => ({ ...f, [vars.pipelineId]: { name: "", probability: "50" } }));
      toast.success("Stage added");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteStage = trpc.crmPipelines.deleteStage.useMutation({
    onSuccess: () => { utils.crmPipelines.list.invalidate(); toast.success("Stage deleted"); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Pipeline Settings"
        description="Create and configure your sales pipelines and stages."
        action={<Button size="sm" onClick={() => setNewPipelineOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Pipeline</Button>}
      />

      {pipelines.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-muted-foreground text-sm mb-3">No pipelines yet. Create one to start managing deals.</p>
          <Button size="sm" onClick={() => setNewPipelineOpen(true)}><Plus className="h-4 w-4 mr-1" /> New Pipeline</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {pipelines.map((pipeline) => {
            const isOpen = expanded === pipeline.id;
            const stageForm = newStageForms[pipeline.id] ?? { name: "", probability: "50" };
            const nextOrder = (pipeline.stages.at(-1)?.order ?? 0) + 1;

            return (
              <div key={pipeline.id} className="rounded-xl border bg-card overflow-hidden">
                {/* Pipeline header */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpanded(isOpen ? null : pipeline.id)}>
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="font-medium text-sm flex-1">{pipeline.name}</span>
                  {pipeline.isDefault && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-medium">Default</span>}
                  <span className="text-xs text-muted-foreground">{pipeline.stages.length} stages · {pipeline._count.deals} deals</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); deletePipeline.mutate({ id: pipeline.id }); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {isOpen && (
                  <div className="border-t px-4 py-3 space-y-2">
                    {/* Stages list */}
                    {pipeline.stages.map((stage) => (
                      <div key={stage.id} className="flex items-center gap-2 py-1">
                        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                        <span className="flex-1 text-sm">{stage.name}</span>
                        <span className="text-xs text-muted-foreground w-16 text-right">{stage.probability}%</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                          onClick={() => deleteStage.mutate({ stageId: stage.id })}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}

                    {/* Add stage */}
                    <div className="flex items-end gap-2 pt-2 border-t">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Stage name</Label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="e.g. Proposal"
                          value={stageForm.name}
                          onChange={(e) => setNewStageForms((f) => ({ ...f, [pipeline.id]: { ...stageForm, name: e.target.value } }))}
                        />
                      </div>
                      <div className="w-20 space-y-1">
                        <Label className="text-xs">Prob. %</Label>
                        <Input
                          className="h-8 text-xs"
                          type="number" min="0" max="100"
                          value={stageForm.probability}
                          onChange={(e) => setNewStageForms((f) => ({ ...f, [pipeline.id]: { ...stageForm, probability: e.target.value } }))}
                        />
                      </div>
                      <Button size="sm" className="h-8"
                        disabled={!stageForm.name || createStage.isPending}
                        onClick={() => createStage.mutate({
                          pipelineId: pipeline.id,
                          name: stageForm.name,
                          order: nextOrder,
                          probability: parseInt(stageForm.probability) || 50,
                        })}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New pipeline dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Pipeline</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Pipeline name <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. Sales Pipeline" value={pipelineName} onChange={(e) => setPipelineName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPipelineOpen(false)}>Cancel</Button>
            <Button
              disabled={!pipelineName || createPipeline.isPending}
              onClick={() => createPipeline.mutate({ name: pipelineName, isDefault: pipelines.length === 0 })}
            >
              {createPipeline.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
