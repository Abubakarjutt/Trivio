import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { createTRPCRouter, orgProcedure } from "@/server/trpc"
import { db } from "@/lib/db"
import { JURISDICTIONS, dateToFiscalYear, getSection } from "@/lib/tax/sections"

export const taxReportRouter = createTRPCRouter({

  get: orgProcedure
    .input(z.object({ fiscalYear: z.number().int().min(2000).max(2100) }))
    .query(async ({ ctx, input }) => {
      const { organisationId } = ctx
      const { fiscalYear } = input

      const org = await db.organisation.findFirst({
        where: { id: organisationId },
        select: { taxJurisdiction: true },
      })
      if (!org?.taxJurisdiction) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tax jurisdiction not configured" })
      }

      const config = JURISDICTIONS[org.taxJurisdiction]
      if (!config) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown jurisdiction: ${org.taxJurisdiction}` })
      }

      const periodStart = config.fiscalYearStart(fiscalYear)
      const periodEnd   = config.fiscalYearEnd(fiscalYear)

      const [creditRows, debitRows] = await Promise.all([
        db.statementTransaction.groupBy({
          by: ["category"],
          where: { organisationId, type: "CREDIT", date: { gte: periodStart, lte: periodEnd }, isExcluded: false },
          _sum: { amount: true },
          _count: { id: true },
        }),
        db.statementTransaction.groupBy({
          by: ["category"],
          where: { organisationId, type: "DEBIT", date: { gte: periodStart, lte: periodEnd }, isExcluded: false },
          _sum: { amount: true },
          _count: { id: true },
        }),
      ])

      type Row = { category: string; _sum: { amount: { toNumber(): number } | null }; _count: { id: number } }
      const toMap = (rows: Row[]) =>
        Object.fromEntries(rows.map(r => [r.category, { total: r._sum.amount?.toNumber() ?? 0, count: r._count.id }]))

      const creditMap = toMap(creditRows as Row[])
      const debitMap  = toMap(debitRows as Row[])

      const sections = config.sections.map(section => {
        const map = section.type === "income" ? creditMap : debitMap
        const cats = section.categories.map(cat => ({
          name:  cat,
          total: map[cat]?.total ?? 0,
          count: map[cat]?.count ?? 0,
        }))
        const total = cats.reduce((sum, c) => sum + c.total, 0)
        const transactionCount = cats.reduce((sum, c) => sum + c.count, 0)
        return { id: section.id, label: section.label, type: section.type, reference: section.reference, total, transactionCount, categories: cats }
      })

      const totalIncome     = sections.filter(s => s.type === "income").reduce((sum, s) => sum + s.total, 0)
      const totalDeductions = sections.filter(s => s.type === "deduction").reduce((sum, s) => sum + s.total, 0)

      const toLocalDateStr = (d: Date) => {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, "0")
        const day = String(d.getDate()).padStart(2, "0")
        return `${y}-${m}-${day}`
      }

      return {
        jurisdiction: config.code,
        jurisdictionName: config.name,
        fiscalYear,
        periodStart: toLocalDateStr(periodStart),
        periodEnd:   toLocalDateStr(periodEnd),
        summary: { totalIncome, totalDeductions, taxableIncome: totalIncome - totalDeductions },
        sections,
      }
    }),

  availableYears: orgProcedure
    .query(async ({ ctx }) => {
      const { organisationId } = ctx

      const org = await db.organisation.findFirst({
        where: { id: organisationId },
        select: { taxJurisdiction: true },
      })
      if (!org?.taxJurisdiction) return { years: [] }

      const config = JURISDICTIONS[org.taxJurisdiction]
      if (!config) return { years: [] }

      const agg = await db.statementTransaction.aggregate({
        where: { organisationId },
        _min: { date: true },
        _max: { date: true },
      })

      if (!agg._min.date || !agg._max.date) return { years: [] }

      const minYear = dateToFiscalYear(new Date(agg._min.date), config)
      const maxYear = dateToFiscalYear(new Date(agg._max.date), config)

      const years: number[] = []
      for (let y = maxYear; y >= minYear; y--) years.push(y)
      return { years }
    }),

  sectionTransactions: orgProcedure
    .input(z.object({
      fiscalYear: z.number().int().min(2000).max(2100),
      sectionId:  z.string(),
      page:       z.number().int().min(1).default(1),
      pageSize:   z.number().int().min(1).max(50).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const { organisationId } = ctx
      const { fiscalYear, sectionId, page, pageSize } = input

      const org = await db.organisation.findFirst({
        where: { id: organisationId },
        select: { taxJurisdiction: true },
      })
      if (!org?.taxJurisdiction) throw new TRPCError({ code: "BAD_REQUEST", message: "Tax jurisdiction not configured" })

      const config = JURISDICTIONS[org.taxJurisdiction]
      if (!config) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown jurisdiction" })

      const section = getSection(org.taxJurisdiction, sectionId)
      if (!section) throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown section: ${sectionId}` })

      const periodStart = config.fiscalYearStart(fiscalYear)
      const periodEnd   = config.fiscalYearEnd(fiscalYear)
      const txnType     = section.type === "income" ? "CREDIT" : "DEBIT"

      const where = {
        organisationId,
        category: { in: section.categories },
        type: txnType as "CREDIT" | "DEBIT",
        date: { gte: periodStart, lte: periodEnd },
        isExcluded: false,
      }

      const [items, total] = await Promise.all([
        db.statementTransaction.findMany({
          where,
          orderBy: { date: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.statementTransaction.count({ where }),
      ])

      return { items, total, page, pageSize }
    }),
})
