"use client"
import { useState } from "react"
import { trpc } from "@/lib/trpc/client"
import { JURISDICTIONS } from "@/lib/tax/sections"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useToast } from "@/lib/hooks/use-toast"

export function JurisdictionPicker() {
  const { data: org, refetch } = trpc.org.get.useQuery()
  const { toast } = useToast()
  const [selected, setSelected] = useState<string | null>(null)

  const mutation = trpc.org.setTaxJurisdiction.useMutation({
    onSuccess: () => {
      refetch()
      toast({ title: "Tax jurisdiction updated" })
      setSelected(null)
    },
    onError: () => toast({ title: "Failed to update tax jurisdiction", variant: "destructive" }),
  })

  const current = org?.taxJurisdiction ?? ""

  return (
    <div className="flex items-center gap-3">
      <Select value={selected ?? current} onValueChange={setSelected}>
        <SelectTrigger className="h-9 text-sm flex-1" style={{ borderColor: "#E4E1D8" }}>
          <SelectValue placeholder="Select jurisdiction…" />
        </SelectTrigger>
        <SelectContent>
          {Object.values(JURISDICTIONS).map(j => (
            <SelectItem key={j.code} value={j.code}>{j.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={!selected || selected === current || mutation.isPending}
        onClick={() => {
          if (selected) mutation.mutate({ jurisdiction: selected })
        }}
      >
        {mutation.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  )
}
