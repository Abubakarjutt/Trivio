"use client";
import { formatCurrency } from "@/lib/utils";

export interface SalesTaxRate {
  key: string;
  regime: string;
  rateCode: string;
  output: number;
  input: number;
  net: number;
  invoiceCount: number;
  billCount: number;
}

export interface SalesTaxData {
  fiscalYear: number;
  periodStart: string;
  periodEnd: string;
  summary: {
    outputTax: number;
    inputTax: number;
    netTaxPayable: number;
    invoiceCount: number;
    billCount: number;
  };
  byRate: SalesTaxRate[];
}

const CARD_SHADOW = "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06)";

interface Props {
  data: SalesTaxData | null | undefined;
  currency: string;
}

/**
 * Sales tax (output/input) view for the Tax Report. Complements the income-tax
 * sections by summarising VAT/GST/sales tax collected on invoices (output) and
 * paid on bills (input) for the selected fiscal year, plus a per-rate breakdown.
 */
export function SalesTaxPanel({ data, currency }: Props) {
  const fmt = (n: number) => formatCurrency(n, currency);
  if (!data) return null;

  const { outputTax, inputTax, netTaxPayable, invoiceCount, billCount } = data.summary;
  const isRefund = netTaxPayable < 0;

  const cards = [
    {
      label: "Output Tax Collected",
      value: outputTax,
      color: "#1A6644",
      sub: `${invoiceCount} invoice${invoiceCount !== 1 ? "s" : ""}`,
    },
    {
      label: "Input Tax Paid",
      value: inputTax,
      color: "#C04545",
      sub: `${billCount} bill${billCount !== 1 ? "s" : ""}`,
    },
    {
      label: isRefund ? "Net Tax Refund" : "Net Tax Payable",
      value: Math.abs(netTaxPayable),
      color: isRefund ? "#2563EB" : "#D97706",
      sub: isRefund ? "Input − Output (credit)" : "Output − Input",
    },
  ];

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <p
          className="text-xs font-bold tracking-widest uppercase"
          style={{ color: "#6B7180", letterSpacing: "0.12em" }}
        >
          Sales Tax
        </p>
        <p className="text-xs" style={{ color: "#9CA3AF" }}>
          From invoices & bills
        </p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl p-4"
            style={{ background: "#fff", boxShadow: CARD_SHADOW, border: "1px solid #E4E1D8" }}
          >
            <p className="mb-1 text-xs font-medium" style={{ color: "#6B7180" }}>
              {c.label}
            </p>
            <p className="text-xl font-semibold" style={{ color: c.color }}>
              {fmt(c.value)}
            </p>
            <p className="mt-1 text-xs" style={{ color: "#9CA3AF" }}>
              {c.sub}
            </p>
          </div>
        ))}
      </div>

      {data.byRate.length > 0 ? (
        <div
          className="overflow-hidden rounded-2xl"
          style={{ border: "1px solid #E4E1D8", background: "#fff" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#FAFAF9", borderBottom: "1px solid #E4E1D8" }}>
                <th
                  className="px-4 py-2 text-left text-xs font-bold tracking-wider uppercase"
                  style={{ color: "#6B7180" }}
                >
                  Rate
                </th>
                <th
                  className="px-4 py-2 text-right text-xs font-bold tracking-wider uppercase"
                  style={{ color: "#6B7180" }}
                >
                  Output
                </th>
                <th
                  className="px-4 py-2 text-right text-xs font-bold tracking-wider uppercase"
                  style={{ color: "#6B7180" }}
                >
                  Input
                </th>
                <th
                  className="px-4 py-2 text-right text-xs font-bold tracking-wider uppercase"
                  style={{ color: "#6B7180" }}
                >
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {data.byRate.map((r) => (
                <tr key={r.key} style={{ borderTop: "1px solid #F0EEE8" }}>
                  <td className="px-4 py-2" style={{ color: "#0F1117" }}>
                    <span className="font-medium">{r.regime}</span>
                    <span className="text-xs" style={{ color: "#9CA3AF" }}>
                      {" "}
                      · {r.rateCode}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: "#1A6644" }}>
                    {fmt(r.output)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" style={{ color: "#C04545" }}>
                    {fmt(r.input)}
                  </td>
                  <td
                    className="px-4 py-2 text-right font-medium tabular-nums"
                    style={{ color: r.net < 0 ? "#2563EB" : "#0F1117" }}
                  >
                    {fmt(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-6 text-center text-sm" style={{ color: "#9CA3AF" }}>
          No taxable sales or purchases in this period.
        </p>
      )}
    </div>
  );
}
