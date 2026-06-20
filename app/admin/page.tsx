import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const ADMIN_EMAIL = "abubakarsahi@hotmail.com";

function kpi(label: string, value: string | number, sub?: string) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-zinc-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect("/dashboard");
  }

  const now = new Date();
  const d7  = new Date(now.getTime() - 7  * 86400_000);
  const d30 = new Date(now.getTime() - 30 * 86400_000);

  const [
    totalUsers,
    totalOrgs,
    newUsers7d,
    newUsers30d,
    newOrgs7d,
    newOrgs30d,
    paidOrgs,
    recentUsers,
    topOrgs,
    totalInvoices,
    totalBills,
    totalChats,
    totalTransactions,
    signupsByDay,
  ] = await Promise.all([
    db.user.count(),
    db.organisation.count(),
    db.user.count({ where: { createdAt: { gte: d7 } } }),
    db.user.count({ where: { createdAt: { gte: d30 } } }),
    db.organisation.count({ where: { createdAt: { gte: d7 } } }),
    db.organisation.count({ where: { createdAt: { gte: d30 } } }),
    db.organisation.count({ where: { plan: "PRO" } }),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, name: true, email: true, createdAt: true, organisation: { select: { name: true, plan: true } } },
    }),
    // Orgs with most invoices
    db.organisation.findMany({
      orderBy: { invoices: { _count: "desc" } },
      take: 10,
      select: {
        id: true,
        name: true,
        plan: true,
        createdAt: true,
        _count: { select: { invoices: true, bills: true, users: true } },
      },
    }),
    db.invoice.count(),
    db.bill.count(),
    db.chatMessage.count({ where: { role: "user" } }),
    db.journalEntry.count(),
    // Signups per day for last 14d
    db.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*) AS count
      FROM "User"
      WHERE "createdAt" >= NOW() - INTERVAL '14 days'
      GROUP BY day
      ORDER BY day ASC
    `,
  ]);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="min-h-screen bg-zinc-50 p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Trivio Admin</h1>
            <p className="text-sm text-zinc-500">Real-time platform statistics</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            Live
          </span>
        </div>

        {/* KPI grid */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Overview</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {kpi("Total Users", totalUsers)}
            {kpi("Total Orgs", totalOrgs)}
            {kpi("Paid Orgs (PRO)", paidOrgs, `${totalOrgs ? Math.round((paidOrgs / totalOrgs) * 100) : 0}% of all orgs`)}
            {kpi("Invoices Created", totalInvoices)}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Growth</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {kpi("New Users (7d)", newUsers7d)}
            {kpi("New Users (30d)", newUsers30d)}
            {kpi("New Orgs (7d)", newOrgs7d)}
            {kpi("New Orgs (30d)", newOrgs30d)}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Feature usage</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {kpi("Bills Created", totalBills)}
            {kpi("Chat Messages", totalChats)}
            {kpi("Journal Entries", totalTransactions)}
            {kpi("Avg invoices / org", totalOrgs ? Math.round(totalInvoices / totalOrgs) : 0)}
          </div>
        </section>

        {/* Signups by day */}
        {signupsByDay.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Signups — last 14 days
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-end gap-1" style={{ height: 80 }}>
                {signupsByDay.map((row) => {
                  const max = Math.max(...signupsByDay.map((r) => Number(r.count)), 1);
                  const pct = (Number(row.count) / max) * 100;
                  const label = new Date(row.day).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                  return (
                    <div key={label} className="group relative flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-emerald-500 transition-all group-hover:bg-emerald-400"
                        style={{ height: `${pct}%`, minHeight: 4 }}
                      />
                      <span className="text-[9px] text-zinc-400">{Number(row.count)}</span>
                      <span className="absolute -bottom-5 text-[8px] text-zinc-400">{label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-7" />
            </div>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent sign-ups */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Recent sign-ups
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Org</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsers.map((u) => (
                    <tr key={u.id} className="border-b border-zinc-50 last:border-0">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-zinc-800">{u.name ?? "—"}</p>
                        <p className="text-xs text-zinc-400">{u.email}</p>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">{u.organisation?.name ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            u.organisation?.plan === "PRO"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {u.organisation?.plan ?? "FREE"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-400">
                        {fmtDate(u.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Most active orgs */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Most active organisations
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs text-zinc-400">
                    <th className="px-4 py-3 font-medium">Org</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium text-right">Inv</th>
                    <th className="px-4 py-3 font-medium text-right">Bills</th>
                    <th className="px-4 py-3 font-medium text-right">Users</th>
                  </tr>
                </thead>
                <tbody>
                  {topOrgs.map((o) => (
                    <tr key={o.id} className="border-b border-zinc-50 last:border-0">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-zinc-800">{o.name}</p>
                        <p className="text-xs text-zinc-400">{fmtDate(o.createdAt)}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            o.plan === "PRO"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {o.plan}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">{o._count.invoices}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">{o._count.bills}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">{o._count.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <p className="text-center text-xs text-zinc-300">
          Refreshes on page load · {now.toUTCString()}
        </p>
      </div>
    </div>
  );
}
