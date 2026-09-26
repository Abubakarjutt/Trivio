// Human-readable ✓/❌ lines for executed chat tool results. Shown to the user
// only — never fed back to the model (it would copy them without acting).
import type { ToolResult } from "./chat.service";

// Summarise executed tool results into a human-readable block appended to the
// assistant's reply. Returns "" when there's nothing worth summarising.
export function buildToolSummary(toolResults: ToolResult[]): string {
  return toolResults
    .map((r) => {
      if (!r.success) return `❌ ${r.tool.replace(/_/g, " ")}: ${r.error}`;
      const d = r.data as Record<string, unknown> | undefined;
      switch (r.tool) {
        case "create_invoice":
          return `✓ Invoice ${d?.number} created for ${d?.customer} — total $${d?.total}`;
        case "create_bill":
          return `✓ Bill ${d?.number} created for ${d?.supplier} — total $${d?.total}`;
        case "create_journal_entry":
          return `✓ Journal entry recorded`;
        case "create_crm_lead":
          return `✓ Lead ${d?.name} added (${d?.source}, status: ${d?.status})`;
        case "update_crm_lead_status":
          return `✓ Lead ${d?.name} updated to ${d?.status}`;
        case "create_crm_deal":
          return `✓ Deal "${d?.name}" created for ${d?.contact} — stage: ${d?.stage}, value: $${d?.value}`;
        case "move_crm_deal":
          return `✓ Deal "${d?.name}" moved to ${d?.newStage}`;
        case "create_crm_activity":
          return `✓ ${d?.type} activity "${d?.subject}" logged${d?.dueDate ? ` (due ${d?.dueDate})` : ""}`;
        case "create_recurring":
          return `✓ Recurring ${String(d?.type ?? "").toLowerCase()} "${d?.name}" created — $${d?.amount} ${String(d?.frequency ?? "").toLowerCase()}, next due ${d?.nextDueDate}`;
        case "mark_recurring_paid":
          return `✓ "${d?.name}" marked paid — next due ${d?.nextDueDate}`;
        case "create_goal":
          return `✓ Goal "${d?.name}" created — target $${d?.targetAmount}${d?.targetDate ? `, by ${d?.targetDate}` : ""}`;
        case "update_goal_progress":
          return `✓ Goal "${d?.name}" progress updated to $${d?.currentAmount} / $${d?.targetAmount} (${d?.progress}%)${d?.status === "COMPLETED" ? " — 🎉 Goal achieved!" : ""}`;
        case "send_invoice":
          return `✓ Invoice ${d?.number} marked as sent`;
        case "void_invoice":
          return `✓ Invoice ${d?.number} voided`;
        case "record_invoice_payment":
          return `✓ Payment of $${d?.amountPaid} recorded on invoice ${d?.number} — now ${d?.newStatus} (via ${d?.cashAccount})`;
        case "approve_bill":
          return `✓ Bill ${d?.number} approved`;
        case "void_bill":
          return `✓ Bill ${d?.number} voided`;
        case "record_bill_payment":
          return `✓ Payment of $${d?.amountPaid} recorded on bill ${d?.number} — now ${d?.newStatus} (via ${d?.cashAccount})`;
        case "void_transaction":
          return `✓ Journal entry voided: "${d?.description}"`;
        case "create_contact":
          return `✓ Contact "${d?.name}" (${d?.type}) created`;
        case "update_contact":
          return `✓ Contact "${d?.name}" updated`;
        case "create_account":
          return `✓ Account ${d?.code} — ${d?.name} (${String(d?.type ?? "").toLowerCase()}) created`;
        case "set_budget":
          return `✓ Budget ${d?.action === "updated" ? "updated" : "created"} — ${d?.category}: $${d?.limitAmount}/${String(d?.period ?? "MONTHLY").toLowerCase()}`;
        case "set_budgets":
          return `✓ ${d?.saved} budget(s) saved`;
        case "extract_document":
          return `✓ Document queued for extraction — check Attachments for results`;
        case "create_crm_company":
          return `✓ Company "${d?.name}" added (${d?.size}, ${d?.industry ?? "no industry set"})`;
        case "list_invoices":
        case "list_bills":
        case "get_invoice":
        case "get_bill":
        case "list_contacts":
        case "list_accounts":
        case "get_account_balance":
        case "search_transactions":
        case "get_profit_and_loss":
        case "get_balance_sheet":
        case "get_trial_balance":
        case "get_ar_aging":
        case "get_ap_aging":
          return "";
        case "add_pf_transaction":
          return `✓ ${d?.type === "INCOME" ? "Income" : "Expense"} recorded — ${d?.merchantName}: ${d?.amount} (${d?.category}, ${d?.date})`;
        case "app_action": {
          const a = d as { action?: string; kind?: string } | undefined;
          if (a?.kind === "query") return "";
          const [area, proc] = String(a?.action ?? "").split(".");
          return `✓ ${proc?.replace(/([A-Z])/g, " $1").toLowerCase()} (${area}) done`;
        }
        case "create_watchlist":
          return `✓ Watchlist "${d?.name}" created — alert when ${d?.category} exceeds $${d?.threshold} per ${String(d?.period ?? "").toLowerCase()}`;
        case "list_budgets":
        case "list_crm_leads":
        case "list_crm_deals":
        case "list_crm_activities":
        case "list_crm_companies":
        case "list_recurring":
        case "list_goals":
        case "list_watchlists":
          return "";
        default:
          return `✓ ${r.tool.replace(/_/g, " ")} completed`;
      }
    })
    .filter(Boolean)
    .join("\n");
}
