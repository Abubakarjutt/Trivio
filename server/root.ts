import { createTRPCRouter } from "@/server/trpc";
import { authRouter } from "@/server/routers/auth";
import { orgRouter } from "@/server/routers/org";
import { accountsRouter } from "@/server/routers/accounts";
import { transactionsRouter } from "@/server/routers/transactions";
import { contactsRouter } from "@/server/routers/contacts";
import { invoicesRouter } from "@/server/routers/invoices";
import { billsRouter } from "@/server/routers/bills";
import { attachmentsRouter } from "@/server/routers/attachments";
import { bankAccountsRouter } from "@/server/routers/bankAccounts";
import { reportsRouter } from "@/server/routers/reports";
import { subscriptionRouter } from "@/server/routers/subscription";
import { dashboardRouter } from "@/server/routers/dashboard";
import { chatRouter } from "@/server/routers/chat";
import { voiceRouter } from "@/server/routers/voice";
import { gdprRouter } from "@/server/routers/gdpr";
// EasyFinance module
import { statementTransactionsRouter } from "./routers/statementTransactions";
import { pfCyclesRouter } from "@/server/routers/pfCycles";
import { taxReportRouter } from "@/server/routers/taxReport";
import { budgetsRouter } from "@/server/routers/budgets";
import { goalsRouter } from "@/server/routers/goals";
import { recurringItemsRouter } from "@/server/routers/recurringItems";
import { watchlistsRouter } from "@/server/routers/watchlists";
// CRM module
import { crmLeadsRouter } from "@/server/routers/crmLeads";
import { crmCompaniesRouter } from "@/server/routers/crmCompanies";
import { crmDealsRouter } from "@/server/routers/crmDeals";
import { crmActivitiesRouter } from "@/server/routers/crmActivities";
import { crmPipelinesRouter } from "@/server/routers/crmPipelines";
import { crmReportsRouter } from "@/server/routers/crmReports";
import { outreachSettingsRouter } from "@/server/routers/outreachSettings";
import { outreachProspectsRouter } from "@/server/routers/outreachProspects";
import { outreachDraftsRouter } from "@/server/routers/outreachDrafts";
import { outreachDocsRouter } from "@/server/routers/outreachDocs";
import { outreachTodayRouter } from "@/server/routers/outreachToday";
import { outreachVoiceRouter } from "@/server/routers/outreachVoice";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  org: orgRouter,
  accounts: accountsRouter,
  transactions: transactionsRouter,
  contacts: contactsRouter,
  invoices: invoicesRouter,
  bills: billsRouter,
  attachments: attachmentsRouter,
  bankAccounts: bankAccountsRouter,
  reports: reportsRouter,
  subscription: subscriptionRouter,
  dashboard: dashboardRouter,
  chat: chatRouter,
  voice: voiceRouter,
  gdpr: gdprRouter,
  // EasyFinance module
  statementTransactions: statementTransactionsRouter,
  pfCycles: pfCyclesRouter,
  taxReport: taxReportRouter,
  budgets: budgetsRouter,
  goals: goalsRouter,
  recurringItems: recurringItemsRouter,
  watchlists: watchlistsRouter,
  // CRM module
  crmLeads: crmLeadsRouter,
  crmCompanies: crmCompaniesRouter,
  crmDeals: crmDealsRouter,
  crmActivities: crmActivitiesRouter,
  crmPipelines: crmPipelinesRouter,
  crmReports: crmReportsRouter,
  outreachSettings: outreachSettingsRouter,
  outreachProspects: outreachProspectsRouter,
  outreachDrafts: outreachDraftsRouter,
  outreachDocs: outreachDocsRouter,
  outreachToday: outreachTodayRouter,
  outreachVoice: outreachVoiceRouter,
});

export type AppRouter = typeof appRouter;
