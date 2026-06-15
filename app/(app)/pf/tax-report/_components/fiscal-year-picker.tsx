"use client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Props {
  years: number[]
  value: number
  onChange: (year: number) => void
}

export function FiscalYearPicker({ years, value, onChange }: Props) {
  return (
    <Select value={String(value)} onValueChange={v => onChange(Number(v))}>
      <SelectTrigger
        className="h-8 text-sm w-28"
        style={{ borderColor: "#E4E1D8", background: "#fff" }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map(y => (
          <SelectItem key={y} value={String(y)}>FY {y}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
