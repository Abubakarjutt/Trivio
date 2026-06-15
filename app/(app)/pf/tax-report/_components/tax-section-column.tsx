import { TaxSectionRow } from "./tax-section-row"

interface Section {
  id: string
  label: string
  reference: string
  type: "income" | "deduction"
  total: number
  transactionCount: number
}

interface Props {
  type: "income" | "deduction"
  sections: Section[]
  currency: string
  onSectionClick: (sectionId: string) => void
}

export function TaxSectionColumn({ type, sections, currency, onSectionClick }: Props) {
  const filtered = sections.filter(s => s.type === type)
  const heading  = type === "income" ? "Income" : "Deductions"
  const color    = type === "income" ? "#1A6644" : "#C04545"

  return (
    <div className="flex-1 min-w-0">
      <p
        className="text-xs font-bold uppercase tracking-widest mb-3"
        style={{ color, letterSpacing: "0.12em" }}
      >
        {heading}
      </p>
      <div className="flex flex-col gap-2">
        {filtered.map(section => (
          <TaxSectionRow
            key={section.id}
            section={section}
            currency={currency}
            onClick={() => onSectionClick(section.id)}
          />
        ))}
      </div>
    </div>
  )
}
