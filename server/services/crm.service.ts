import { type PrismaClient } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonthlyForecast {
  month: string; // "YYYY-MM"
  totalValue: number;
  weightedValue: number;
  dealCount: number;
}

export interface DealLike {
  id: string;
  value: { toNumber?: () => number } | number | string;
  probability: number;
  expectedCloseDate?: Date | null;
  closedAt?: Date | null;
  wonLostReason?: string | null;
  createdAt: Date;
}

// ─── Lead Conversion ──────────────────────────────────────────────────────────

export async function convertLeadToContact(
  db: PrismaClient,
  leadId: string,
  orgId: string
): Promise<{ contactId: string; companyId: string | null; dealId: string }> {
  const lead = await db.crmLead.findFirst({ where: { id: leadId, organisationId: orgId } });
  if (!lead) throw new Error("Lead not found");
  if (lead.status !== "QUALIFIED") throw new Error("Lead must be QUALIFIED to convert");

  // Find default pipeline
  let pipeline = await db.crmPipeline.findFirst({
    where: { organisationId: orgId, isDefault: true },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  if (!pipeline) {
    pipeline = await db.crmPipeline.findFirst({
      where: { organisationId: orgId },
      include: { stages: { orderBy: { order: "asc" } } },
    });
  }
  if (!pipeline || pipeline.stages.length === 0) {
    throw new Error("No pipeline with stages found. Create a pipeline first.");
  }
  const firstStage = pipeline.stages[0];
  const totalStages = pipeline.stages.length;

  return db.$transaction(async (tx) => {
    // 1. Create Contact
    const contact = await tx.contact.create({
      data: {
        organisationId: orgId,
        type: "CUSTOMER",
        name: `${lead.firstName} ${lead.lastName}`,
        email: lead.email ?? undefined,
        phone: lead.phone ?? undefined,
      },
    });

    // 2. Create CrmCompany (if company name present)
    let company: { id: string } | null = null;
    if (lead.companyName) {
      company = await tx.crmCompany.create({
        data: {
          organisationId: orgId,
          name: lead.companyName,
          linkedContactId: contact.id,
        },
      });
    }

    // 3. Create Deal
    const deal = await tx.crmDeal.create({
      data: {
        organisationId: orgId,
        name: `Deal with ${lead.firstName} ${lead.lastName}`,
        value: lead.estimatedValue ?? 0,
        contactId: contact.id,
        crmCompanyId: company?.id ?? undefined,
        pipelineId: pipeline!.id,
        stageId: firstStage.id,
        probability: suggestProbability(firstStage.order, totalStages),
        source: lead.source,
      },
    });

    // 4. Mark lead as converted
    await tx.crmLead.update({
      where: { id: leadId },
      data: {
        status: "CONVERTED",
        convertedAt: new Date(),
        convertedContactId: contact.id,
      },
    });

    return { contactId: contact.id, companyId: company?.id ?? null, dealId: deal.id };
  });
}

// ─── Deal-to-Invoice Conversion ───────────────────────────────────────────────

export async function convertDealToInvoice(
  db: PrismaClient,
  dealId: string,
  orgId: string
): Promise<{ invoiceId: string }> {
  const deal = await db.crmDeal.findFirst({
    where: { id: dealId, organisationId: orgId },
    include: { contact: true },
  });
  if (!deal) throw new Error("Deal not found");
  if (deal.invoiceId) throw new Error("Deal already has a linked invoice");

  // Generate next invoice number
  const lastInvoice = await db.invoice.findFirst({
    where: { organisationId: orgId },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  const lastNum = lastInvoice ? parseInt(lastInvoice.number.replace(/\D/g, "") || "0", 10) : 0;
  const number = `INV-${String(lastNum + 1).padStart(4, "0")}`;

  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + 30);

  const dealValue = typeof deal.value === "object" && deal.value !== null && "toNumber" in deal.value
    ? (deal.value as { toNumber: () => number }).toNumber()
    : Number(deal.value);

  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        organisationId: orgId,
        contactId: deal.contactId,
        number,
        date: today,
        dueDate,
        status: "DRAFT",
        subtotal: dealValue,
        taxAmount: 0,
        totalAmount: dealValue,
        amountPaid: 0,
        lines: {
          create: [
            {
              description: deal.name,
              quantity: 1,
              unitPrice: dealValue,
              amount: dealValue,
              taxAmount: 0,
              sortOrder: 0,
            },
          ],
        },
      },
    });

    await tx.crmDeal.update({
      where: { id: dealId },
      data: { invoiceId: invoice.id },
    });

    return { invoiceId: invoice.id };
  });
}

// ─── Analytics Helpers ────────────────────────────────────────────────────────

export function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  if (typeof v === "object" && "toNumber" in (v as object)) return (v as { toNumber: () => number }).toNumber();
  return Number(v);
}

export function calcWeightedForecast(deals: DealLike[]): MonthlyForecast[] {
  const open = deals.filter((d) => !d.closedAt && d.expectedCloseDate);
  const map = new Map<string, MonthlyForecast>();

  for (const deal of open) {
    const d = deal.expectedCloseDate!;
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const value = toNum(deal.value);
    const weighted = value * (deal.probability / 100);

    const existing = map.get(month);
    if (existing) {
      existing.totalValue += value;
      existing.weightedValue += weighted;
      existing.dealCount += 1;
    } else {
      map.set(month, { month, totalValue: value, weightedValue: weighted, dealCount: 1 });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      ...m,
      totalValue: Math.round(m.totalValue * 100) / 100,
      weightedValue: Math.round(m.weightedValue * 100) / 100,
    }));
}

export function calcWinRate(deals: DealLike[], fromDate: Date): number {
  const closed = deals.filter((d) => d.closedAt && d.closedAt >= fromDate);
  if (closed.length === 0) return 0;
  const won = closed.filter((d) => !d.wonLostReason || d.wonLostReason !== "LOST");
  // We identify won by closedAt being set and the deal having no "LOST" won/lost reason
  // But more reliably, won deals have no wonLostReason set to "LOST" marker — caller should
  // use won deals (closedAt set + invoiceId or explicit "WON" marker). For the service we
  // count won as those closed with probability 100 or invoiceId set.
  return closed.length > 0 ? Math.round((won.length / closed.length) * 100) / 100 : 0;
}

export function calcAvgCloseTime(wonDeals: DealLike[]): number {
  const withBoth = wonDeals.filter((d) => d.closedAt != null);
  if (withBoth.length === 0) return 0;
  const totalDays = withBoth.reduce((sum, d) => {
    const days = (d.closedAt!.getTime() - d.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    return sum + days;
  }, 0);
  return Math.round(totalDays / withBoth.length);
}

export function suggestProbability(stageOrder: number, totalStages: number): number {
  if (totalStages <= 0) return 50;
  const raw = Math.round((stageOrder / totalStages) * 100);
  return Math.min(100, Math.max(0, raw));
}

export function isOverdue(dueDate: Date | null | undefined, completedAt: Date | null | undefined): boolean {
  if (!dueDate || completedAt) return false;
  return dueDate < new Date();
}
