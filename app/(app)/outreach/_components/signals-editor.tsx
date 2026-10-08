"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SIGNAL_NAMES, type Signal, type SignalName } from "@/server/services/outreach/types";
import { SIGNAL_LABEL } from "./labels";

export function SignalsEditor({
  value,
  onChange,
}: {
  value: Signal[];
  onChange: (v: Signal[]) => void;
}) {
  const set = (i: number, patch: Partial<Signal>) =>
    onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-2">
      {value.map((s, i) => (
        <div key={i} className="flex items-start gap-2">
          <Select value={s.name} onValueChange={(v) => set(i, { name: v as SignalName })}>
            <SelectTrigger className="w-44 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIGNAL_NAMES.map((n) => (
                <SelectItem key={n} value={n}>
                  {SIGNAL_LABEL[n]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={s.evidence}
            maxLength={500}
            placeholder="Evidence: what they said or posted"
            onChange={(e) => set(i, { evidence: e.target.value })}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Remove signal"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={value.length >= 20}
        onClick={() => onChange([...value, { name: "pain_post", evidence: "" }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Add signal
      </Button>
    </div>
  );
}
