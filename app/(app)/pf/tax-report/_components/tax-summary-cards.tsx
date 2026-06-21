import { formatCurrency } from "@/lib/utils"

interface Props {
  totalIncome: number
  totalDeductions: number
  taxableIncome: number
  currency: string
}

const CARD_SHADOW = "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)"

export function TaxSummaryCards({ totalIncome, totalDeductions, taxableIncome, currency }: Props) {
  const fmt = (n: number) => formatCurrency(n, currency)
  const taxableLabel = taxableIncome < 0 ? "Tax Loss" : "Taxable Income"
  const taxableColor = taxableIncome < 0 ? "#C04545" : "#0F1117"
  const cards = [
    { label: "Total Income",     value: fmt(totalIncome),     color: "#1A6644" },
    { label: "Total Deductions", value: fmt(totalDeductions), color: "#D97706" },
    { label: taxableLabel,       value: fmt(Math.abs(taxableIncome)), color: taxableColor },
  ]
  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {cards.map(card => (
        <div
          key={card.label}
          className="rounded-2xl p-4"
          style={{ background: "#fff", boxShadow: CARD_SHADOW, border: "1px solid #E4E1D8" }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: "#6B7180" }}>{card.label}</p>
          <p className="text-xl font-semibold" style={{ color: card.color }}>{card.value}</p>
        </div>
      ))}
    </div>
  )
}
