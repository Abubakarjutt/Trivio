"use client"
import { useEffect, useState } from "react"
import { trpc } from "@/lib/trpc/client"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/utils"
import { X } from "lucide-react"

interface Section {
  id: string
  label: string
  reference: string
  type: "income" | "deduction"
  total: number
  transactionCount: number
}

interface Props {
  section: Section | null
  fiscalYear: number
  currency: string
  open: boolean
  onClose: () => void
}

const PAGE_SIZE = 20

export function TaxSectionDrawer({ section, fiscalYear, currency, open, onClose }: Props) {
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [section?.id])

  const { data, isLoading } = trpc.taxReport.sectionTransactions.useQuery(
    { fiscalYear, sectionId: section?.id ?? "", page, pageSize: PAGE_SIZE },
    { enabled: open && !!section }
  )

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0
  const fmt = (n: number) => formatCurrency(n, currency)

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col p-0"
        style={{ background: "#F9F8F5" }}
      >
        <SheetHeader
          className="flex-row items-start justify-between px-6 pt-6 pb-4"
          style={{ borderBottom: "1px solid #E4E1D8" }}
        >
          <div>
            <SheetTitle className="text-base font-semibold" style={{ color: "#0F1117" }}>
              {section?.label ?? ""}
            </SheetTitle>
            <p className="text-xs mt-0.5" style={{ color: "#9CA3AF" }}>
              {section?.reference} · FY {fiscalYear}
            </p>
          </div>
          <SheetClose asChild>
            <button
              className="rounded-lg p-1.5 transition-colors"
              style={{ color: "#6B7180" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#E4E1D8")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <X className="h-4 w-4" />
            </button>
          </SheetClose>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {isLoading && (
            <p className="text-sm text-center py-8" style={{ color: "#9CA3AF" }}>Loading…</p>
          )}
          {!isLoading && data?.items.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: "#9CA3AF" }}>
              No transactions in this section for FY {fiscalYear}.
            </p>
          )}
          {data?.items.map(txn => {
            const dateStr = new Date(txn.date).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
            })
            return (
              <div
                key={txn.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: "#fff", border: "1px solid #E4E1D8" }}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold bg-gray-100 text-gray-600">
                  {txn.merchantName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "#0F1117" }}>{txn.merchantName}</p>
                  <p className="text-xs" style={{ color: "#9CA3AF" }}>{dateStr} · {txn.category}</p>
                </div>
                <span
                  className="text-sm font-semibold tabular-nums shrink-0"
                  style={{ color: txn.type === "DEBIT" ? "#C04545" : "#1A6644" }}
                >
                  {txn.type === "DEBIT" ? "−" : "+"}{fmt(Number(txn.amount))}
                </span>
              </div>
            )
          })}
        </div>

        {totalPages > 1 && (
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ borderTop: "1px solid #E4E1D8" }}
          >
            <p className="text-xs" style={{ color: "#6B7180" }}>
              {data?.total} transactions · page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
