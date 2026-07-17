"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/hooks/use-toast";

export function TaxRegimePicker() {
  const { data: org, refetch } = trpc.org.get.useQuery();
  const { data: taxRegimes } = trpc.org.getTaxRegimes.useQuery();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string | null>(null);

  const mutation = trpc.org.setTaxRegime.useMutation({
    onSuccess: () => {
      refetch();
      toast({ title: "Tax regime updated" });
      setSelected(null);
    },
    onError: () => toast({ title: "Failed to update tax regime", variant: "destructive" }),
  });

  const current = org?.taxRegimeId ?? "";

  return (
    <div className="flex items-center gap-3">
      <Select value={selected ?? current} onValueChange={setSelected}>
        <SelectTrigger className="h-9 text-sm flex-1" style={{ borderColor: "#E4E1D8" }}>
          <SelectValue placeholder="Select tax regime…" />
        </SelectTrigger>
        <SelectContent>
          {(taxRegimes ?? []).map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={!selected || selected === current || mutation.isPending}
        onClick={() => { if (selected) mutation.mutate({ taxRegimeId: selected }); }}
      >
        {mutation.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
