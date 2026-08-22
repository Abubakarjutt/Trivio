"use client";
import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { FiscalYearPicker } from "./_components/fiscal-year-picker";
import { TaxSummaryCards } from "./_components/tax-summary-cards";
import { TaxSectionColumn } from "./_components/tax-section-column";
import { TaxSectionDrawer } from "./_components/tax-section-drawer";
import { SalesTaxPanel } from "./_components/sales-tax-panel";
import { Loader2 } from "lucide-react";

export default function TaxReportPage() {
  const { data: org } = trpc.org.get.useQuery();
  const currency = org?.currency ?? "USD";

  const { data: yearsData, isLoading: yearsLoading } = trpc.taxReport.availableYears.useQuery(
    undefined,
    { enabled: !!org?.taxJurisdiction }
  );

  const currentFiscalYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentFiscalYear);

  const years = yearsData?.years ?? [];
  // With a jurisdiction configured we only offer years that actually have
  // statement transactions. Without one (sales-tax-only users) we fall back to
  // the current fiscal year so the sales tax view is still navigable.
  const activeYear = years.length > 0 && !years.includes(selectedYear) ? years[0] : selectedYear;

  const { data: report, isLoading: reportLoading } = trpc.taxReport.get.useQuery(
    { fiscalYear: activeYear },
    { enabled: !!org?.taxJurisdiction && years.length > 0 }
  );

  // Sales tax (output/input from invoices & bills) does not require a tax
  // jurisdiction — the router falls back to a calendar year — so it is always
  // fetched and shown alongside the income-tax report.
  const { data: salesTax, isLoading: salesTaxLoading } = trpc.taxReport.salesTax.useQuery({
    fiscalYear: activeYear,
  });

  const [drawerSectionId, setDrawerSectionId] = useState<string | null>(null);
  const drawerSection = report?.sections.find((s) => s.id === drawerSectionId) ?? null;

  const hasJurisdiction = !!org?.taxJurisdiction;
  const showPicker = years.length > 0 || !!salesTax;
  const pickerYears = years.length > 0 ? years : [activeYear];

  const isLoading = yearsLoading || reportLoading || salesTaxLoading;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Tax Report"
        description={report?.jurisdictionName ?? "Income & sales tax"}
        action={
          showPicker ? (
            <FiscalYearPicker
              years={pickerYears}
              value={activeYear}
              onChange={(y) => {
                setSelectedYear(y);
              }}
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

        {!isLoading && (
          <>
            {/* Income tax (personal finance) — needs a configured jurisdiction */}
            {hasJurisdiction ? (
              years.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <div className="max-w-xs text-center">
                    <p className="mb-1 text-sm font-medium" style={{ color: "#0F1117" }}>
                      No transactions yet
                    </p>
                    <p className="mb-4 text-xs" style={{ color: "#6B7180" }}>
                      Import bank statements to generate your income tax report.
                    </p>
                    <Link
                      href="/pf/transactions"
                      className="inline-block rounded-lg px-4 py-2 text-xs font-semibold"
                      style={{ background: "#1A6644", color: "#fff" }}
                    >
                      Import Transactions
                    </Link>
                  </div>
                </div>
              ) : report ? (
                <>
                  <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    <strong>Estimate only.</strong> Figures are based on imported bank statement
                    transactions categorised in the Personal Finance module. Invoices, bills, and
                    journal entries from the accounting module are not included. Review each section
                    with a qualified tax professional before filing.
                  </div>

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

                  <p className="mt-6 text-xs" style={{ color: "#9CA3AF" }}>
                    Period: {report.periodStart} – {report.periodEnd}
                  </p>
                </>
              ) : null
            ) : (
              <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <strong>No tax jurisdiction configured.</strong> Set your jurisdiction in
                    Settings to unlock the income tax (personal finance) report. Sales tax below is
                    still available from your invoices and bills.
                  </div>
                  <Link
                    href="/settings"
                    className="inline-block shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold"
                    style={{ background: "#1A6644", color: "#fff" }}
                  >
                    Go to Settings
                  </Link>
                </div>
              </div>
            )}

            {/* Sales tax (business accounting) — from invoices & bills */}
            <SalesTaxPanel data={salesTax} currency={currency} />
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
  );
}
