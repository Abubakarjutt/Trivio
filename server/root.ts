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
// EasyFinance module
import { statementTransactionsRouter } from "./routers/statementTransactions";
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
  // EasyFinance module
  statementTransactions: statementTransactionsRouter,
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
});

export type AppRouter = typeof appRouter;
