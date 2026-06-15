"use client"
import { useState } from "react"
import Link from "next/link"
import { trpc } from "@/lib/trpc/client"
import { PageHeader } from "@/app/(app)/_components/page-header"
import { FiscalYearPicker } from "./_components/fiscal-year-picker"
import { TaxSummaryCards } from "./_components/tax-summary-cards"
import { TaxSectionColumn } from "./_components/tax-section-column"
import { TaxSectionDrawer } from "./_components/tax-section-drawer"
import { Loader2 } from "lucide-react"

export default function TaxReportPage() {
  const { data: org } = trpc.org.get.useQuery()
  const currency = org?.currency ?? "USD"

  const { data: yearsData, isLoading: yearsLoading } = trpc.taxReport.availableYears.useQuery(
    undefined,
    { enabled: !!org?.taxJurisdiction }
  )

  const currentFiscalYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState<number>(currentFiscalYear)

  const years = yearsData?.years ?? []
  const activeYear = years.length > 0 && !years.includes(selectedYear) ? years[0] : selectedYear

  const { data: report, isLoading: reportLoading } = trpc.taxReport.get.useQuery(
    { fiscalYear: activeYear },
    { enabled: !!org?.taxJurisdiction && years.length > 0 }
  )

  const [drawerSectionId, setDrawerSectionId] = useState<string | null>(null)
  const drawerSection = report?.sections.find(s => s.id === drawerSectionId) ?? null

  if (!yearsLoading && !org?.taxJurisdiction) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Tax Report" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-xs">
            <p className="text-sm font-medium mb-1" style={{ color: "#0F1117" }}>
              No tax jurisdiction configured
            </p>
            <p className="text-xs mb-4" style={{ color: "#6B7180" }}>
              Go to Settings to select your jurisdiction and enable the Tax Report.
            </p>
            <Link
              href="/settings"
              className="inline-block text-xs font-semibold px-4 py-2 rounded-lg"
              style={{ background: "#1A6644", color: "#fff" }}
            >
              Go to Settings
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const isLoading = yearsLoading || reportLoading

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Tax Report"
        description={report?.jurisdictionName}
        action={
          years.length > 0 ? (
            <FiscalYearPicker
              years={years}
              value={activeYear}
              onChange={y => { setSelectedYear(y) }}
            />
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#9CA3AF" }} />
          </div>
        )}

        {!isLoading && years.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm" style={{ color: "#9CA3AF" }}>
              No transactions found. Import bank statements to generate your tax report.
            </p>
          </div>
        )}

        {!isLoading && report && (
          <>
            <TaxSummaryCards
              totalIncome={report.summary.totalIncome}
              totalDeductions={report.summary.totalDeductions}
              taxableIncome={report.summary.taxableIncome}
              currency={currency}
            />

            <div className="flex gap-4">
              <TaxSectionColumn
                type="income"
                sections={report.sections}
                currency={currency}
                onSectionClick={setDrawerSectionId}
              />
              <TaxSectionColumn
                type="deduction"
                sections={report.sections}
                currency={currency}
                onSectionClick={setDrawerSectionId}
              />
            </div>

            <p className="text-xs mt-6" style={{ color: "#9CA3AF" }}>
              Period: {report.periodStart} – {report.periodEnd}
            </p>
          </>
        )}
      </div>

      <TaxSectionDrawer
        section={drawerSection}
        fiscalYear={activeYear}
        currency={currency}
        open={!!drawerSectionId}
        onClose={() => setDrawerSectionId(null)}
      />
    </div>
  )
}
