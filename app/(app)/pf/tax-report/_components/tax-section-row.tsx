import { ChevronRight } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

interface Section {
  id: string
  label: string
  reference: string
  type: "income" | "deduction"
  total: number
  transactionCount: number
}

interface Props {
  section: Section
  currency: string
  onClick: () => void
}

export function TaxSectionRow({ section, currency, onClick }: Props) {
  const fmt = (n: number) => formatCurrency(n, currency)
  const hasData = section.transactionCount > 0

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 rounded-xl px-4 py-3 transition-colors"
      style={{
        background: hasData ? "#fff" : "#FAFAF9",
        border: "1px solid #E4E1D8",
        opacity: hasData ? 1 : 0.6,
        cursor: "pointer",
      }}
      onMouseEnter={e => { if (hasData) (e.currentTarget as HTMLButtonElement).style.background = "#F9F8F5" }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = hasData ? "#fff" : "#FAFAF9" }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "#0F1117" }}>{section.label}</p>
        <p className="text-xs mt-0.5" style={{ color: "#9CA3AF" }}>{section.reference}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p
          className="text-sm font-semibold"
          style={{ color: section.type === "income" ? "#1A6644" : "#C04545" }}
        >
          {hasData ? fmt(section.total) : "—"}
        </p>
        {hasData && (
          <p className="text-xs" style={{ color: "#9CA3AF" }}>
            {section.transactionCount} txn{section.transactionCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: "#D1D5DB" }} />
    </button>
  )
}
