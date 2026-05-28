"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ArrowUpDown,
  FileText,
  Receipt,
  Users,
  BookOpen,
  BarChart3,
  Settings,
  LogOut,
  ChevronRight,
  Sparkles,
  Landmark,
  CreditCard,
  TrendingUp,
  Target,
  RefreshCw,
  Eye,
  Users2,
  UserPlus,
  Building2,
  Handshake,
  Calendar,
} from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  matchPrefix?: boolean;
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Invoices", href: "/invoices", icon: FileText, matchPrefix: true },
      { label: "Bills", href: "/bills", icon: Receipt, matchPrefix: true },
      { label: "Accounts", href: "/accounts", icon: Users, matchPrefix: true },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Transactions", href: "/transactions", icon: ArrowUpDown, matchPrefix: true },
      { label: "Reconciliation", href: "/reconciliation", icon: Landmark, matchPrefix: true },
      { label: "Contacts", href: "/contacts", icon: BookOpen, matchPrefix: true },
      { label: "Reports", href: "/reports", icon: BarChart3, matchPrefix: true },
      { label: "AI Extract", href: "/extract", icon: Sparkles, matchPrefix: true },
    ],
  },
  {
    label: "Personal Finance",
    items: [
      { label: "Transactions", href: "/pf/transactions", icon: CreditCard, matchPrefix: true },
      { label: "Budgets", href: "/budgets", icon: TrendingUp, matchPrefix: true },
      { label: "Goals", href: "/goals", icon: Target, matchPrefix: true },
      { label: "Recurring", href: "/recurring", icon: RefreshCw, matchPrefix: true },
      { label: "Watchlists", href: "/watchlists", icon: Eye, matchPrefix: true },
    ],
  },
  {
    label: "CRM",
    items: [
      { label: "CRM Dashboard", href: "/crm", icon: Users2, matchPrefix: false },
      { label: "Leads", href: "/crm/leads", icon: UserPlus, matchPrefix: true },
      { label: "Companies", href: "/crm/companies", icon: Building2, matchPrefix: true },
      { label: "Deals", href: "/crm/deals", icon: Handshake, matchPrefix: true },
      { label: "Activities", href: "/crm/activities", icon: Calendar, matchPrefix: true },
    ],
  },
];

function NavItemComponent({ icon: Icon, href, label, matchPrefix }: NavItem) {
  const pathname = usePathname();
  const active = matchPrefix ? pathname.startsWith(href) : pathname === href;

  return (
    <Link
      href={href}
      className={cn(
        "relative group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-150",
        active
          ? "sidebar-item-active bg-sidebar-accent/80 text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/55 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/90"
      )}
    >
      <Icon
        className={cn(
          "h-[15px] w-[15px] shrink-0 transition-colors",
          active ? "text-sidebar-primary" : "text-sidebar-foreground/35 group-hover:text-sidebar-foreground/60"
        )}
      />
      <span className="flex-1">{label}</span>
      {active && <ChevronRight className="h-3 w-3 text-sidebar-primary/60 shrink-0" />}
    </Link>
  );
}

export function Sidebar({ orgName }: { orgName: string }) {
  return (
    <div
      className="flex flex-col h-full bg-[hsl(var(--sidebar-background))]"
      style={{ width: "var(--sidebar-width, 232px)" }}
    >
      {/* Logo / Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border/40">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/20 ring-1 ring-sidebar-primary/30">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 3h12M2 8h8M2 13h5" stroke="hsl(var(--sidebar-primary))" strokeWidth="1.75" strokeLinecap="round"/>
            <circle cx="12" cy="11" r="3" stroke="hsl(var(--sidebar-primary))" strokeWidth="1.5"/>
            <path d="M12 9.5v1.5l.75.75" stroke="hsl(var(--sidebar-primary))" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/35">AutoAccounts</p>
          <p className="text-sm font-semibold text-sidebar-foreground truncate leading-tight">{orgName}</p>
        </div>
      </div>

      {/* Nav */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, idx) => (
          <div key={idx} className={cn("flex flex-col gap-0.5", idx > 0 && "mt-4")}>
            {group.label && (
              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-sidebar-foreground/28">
                {group.label}
              </p>
            )}
            {group.items.map((item, i) => (
              <NavItemComponent key={i} {...item} />
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border/40 px-3 py-3 space-y-0.5">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/90 transition-all duration-150"
        >
          <Settings className="h-[15px] w-[15px] shrink-0 text-sidebar-foreground/30" />
          <span>Settings</span>
        </Link>
        <button
          className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/90 transition-all duration-150"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-[15px] w-[15px] shrink-0 text-sidebar-foreground/30" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
