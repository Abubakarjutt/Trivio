"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
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
  Sparkles,
  Landmark,
  CreditCard,
  TrendingUp,
  Target,
  RefreshCw,
  Eye,
  FileStack,
  Users2,
  UserPlus,
  Building2,
  Handshake,
  Calendar,
  MessageSquare,
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
      { label: "Tax Report", href: "/pf/tax-report", icon: FileStack, matchPrefix: true },
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

function NavItemComponent({ icon: Icon, href, label, matchPrefix, onNavigate }: NavItem & { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = matchPrefix ? pathname.startsWith(href) : pathname === href;

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`sb-link${active ? " sb-active" : ""}`}
    >
      <Icon className="sb-icon h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
      {label}
    </Link>
  );
}

export function Sidebar({ orgName, hasSampleData, onNavigate }: { orgName: string; hasSampleData?: boolean; onNavigate?: () => void }) {
  return (
    <>
      <style>{`
        .sb-link {
          position: relative;
          display: flex; align-items: center; gap: 10px;
          border-radius: 9px; padding: 9px 12px;
          font-size: 13.5px; font-weight: 500;
          color: rgba(235, 245, 240, 0.62);
          transition: background 0.15s, color 0.15s;
          text-decoration: none;
        }
        .sb-link:hover { background: rgba(235,245,240,0.06); color: rgba(235,245,240,0.92); }
        .sb-link.sb-active { background: rgba(235,245,240,0.09); color: #F4F3EF; }
        .sb-link.sb-active::before {
          content: "";
          position: absolute;
          left: -12px; top: 50%; transform: translateY(-50%);
          width: 3px; height: 18px; border-radius: 0 3px 3px 0;
          background: #C9A86A;
        }
        .sb-link .sb-icon { color: rgba(147,196,174,0.55); transition: color 0.15s; }
        .sb-link:hover .sb-icon { color: rgba(147,196,174,0.85); }
        .sb-link.sb-active .sb-icon { color: #93C4AE; }
        .sb-signout {
          display: flex; align-items: center; gap: 10px; width: 100%;
          border-radius: 9px; padding: 9px 12px;
          font-size: 13.5px; font-weight: 500;
          color: rgba(235,245,240,0.45);
          transition: background 0.15s, color 0.15s;
          border: none; cursor: pointer; background: transparent;
        }
        .sb-signout:hover { background: rgba(235,245,240,0.06); color: rgba(235,245,240,0.85); }
        .sb-section {
          font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.18em; color: rgba(235,245,240,0.28);
          padding: 0 12px; margin-bottom: 4px;
        }
      `}</style>

      <div
        className="relative flex h-full w-56 flex-col px-3 py-5 gap-1 overflow-hidden"
        style={{
          background: "linear-gradient(178deg, #0C2A1B 0%, #0A2116 60%, #081B12 100%)",
          borderRight: "1px solid rgba(8,27,18,0.9)",
        }}
      >
        {/* Faint ledger grid texture */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.05,
            backgroundImage: "linear-gradient(rgba(147,196,174,1) 1px, transparent 1px)",
            backgroundSize: "100% 28px",
          }}
        />
        {/* Soft glow behind the monogram */}
        <div
          aria-hidden
          className="absolute -top-16 -left-16 h-48 w-48 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(42,138,90,0.25), transparent 70%)" }}
        />

        {/* Masthead */}
        <div className="relative px-3 pt-1 pb-5 mb-3" style={{ borderBottom: "1px solid rgba(235,245,240,0.08)" }}>
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
              style={{ background: "rgba(235,245,240,0.07)", boxShadow: "inset 0 0 0 1px rgba(147,196,174,0.25)" }}
            >
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
                <path d="M2 2h12v3H2zM2 7h8v2H2zM2 11h5v2H2z" stroke="#93C4AE" strokeWidth="1.25" strokeLinejoin="round" fill="none" />
                <circle cx="11" cy="12" r="2.5" stroke="#93C4AE" strokeWidth="1.25" />
                <path d="M11 10.75v1.25l.75.5" stroke="#93C4AE" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <p
                className="truncate"
                style={{ fontWeight: 400, fontSize: "1rem", color: "#F4F3EF", letterSpacing: "-0.01em", lineHeight: 1.15 }}
                title={orgName}
              >
                {orgName}
              </p>
              <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(201,168,106,0.75)", marginTop: 2 }}>
                Trivio
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <div className="relative flex flex-1 flex-col gap-4 overflow-y-auto">
          {NAV_GROUPS.map((group, idx) => (
            <div key={idx} className="flex flex-col gap-0.5">
              {group.label && <p className="sb-section">{group.label}</p>}
              {group.items.map((item, i) => (
                <NavItemComponent key={i} {...item} onNavigate={onNavigate} />
              ))}
            </div>
          ))}
        </div>

        {/* AI Chat */}
        <div className="relative pt-3" style={{ borderTop: "1px solid rgba(235,245,240,0.08)" }}>
          <button
            className="sb-link w-full"
            onClick={() => { onNavigate?.(); window.dispatchEvent(new CustomEvent("open-chat")); }}
          >
            <MessageSquare className="sb-icon h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
            AI Chat
          </button>
        </div>

        {/* Footer */}
        <div className="relative mt-2 pt-3 flex flex-col gap-0.5" style={{ borderTop: "1px solid rgba(235,245,240,0.08)" }}>
          <Link href="/settings" onClick={onNavigate} className="sb-link">
            <Settings className="sb-icon h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
            Settings
          </Link>
          <button
            className="sb-signout"
            onClick={() => { onNavigate?.(); signOut({ callbackUrl: "/login" }); }}
          >
            <LogOut className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} style={{ color: "rgba(147,196,174,0.55)" }} />
            Sign out
          </button>
          {hasSampleData && (
            <div className="pt-3">
              <div
                className="mx-3 rounded-lg px-3 py-2 text-center"
                style={{ background: "rgba(201,168,106,0.12)", border: "1px solid rgba(201,168,106,0.3)" }}
              >
                <p className="text-xs font-semibold" style={{ color: "#C9A86A", letterSpacing: "0.04em" }}>Demo data active</p>
                <p className="text-[10px] mt-0.5" style={{ color: "rgba(201,168,106,0.65)" }}>Import a statement to switch to real data</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
