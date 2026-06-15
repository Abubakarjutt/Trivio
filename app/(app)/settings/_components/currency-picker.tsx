"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/hooks/use-toast";

export function CurrencyPicker() {
  const { data: org, refetch } = trpc.org.get.useQuery();
  const { data: currencies } = trpc.org.getCurrencies.useQuery();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string | null>(null);

  const mutation = trpc.org.setCurrency.useMutation({
    onSuccess: () => {
      refetch();
      toast({ title: "Currency updated" });
      setSelected(null);
    },
    onError: () => toast({ title: "Failed to update currency", variant: "destructive" }),
  });

  const current = org?.currency ?? "USD";

  return (
    <div className="flex items-center gap-3">
      <Select value={selected ?? current} onValueChange={setSelected}>
        <SelectTrigger className="h-9 text-sm flex-1" style={{ borderColor: "#E4E1D8" }}>
          <SelectValue placeholder="Select currency…" />
        </SelectTrigger>
        <SelectContent>
          {(currencies ?? []).map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.code} — {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={!selected || selected === current || mutation.isPending}
        onClick={() => { if (selected) mutation.mutate({ currency: selected }); }}
      >
        {mutation.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
