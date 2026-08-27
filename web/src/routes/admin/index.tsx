import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminShell } from "@/components/layout/AdminShell";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import {
  AdminMetricStrip,
  AdminMetricStripSkeleton,
} from "@/components/admin/AdminMetricStrip";
import { amountSummaryCards } from "@/components/admin/StatsCards";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { COLORS } from "@/constants/colors";
import {
  Users,
  Wallet,
  Inbox,
  Smartphone,
  Banknote,
  AlertTriangle,
  Coins,
  Handshake,
  UserPlus,
  TrendingUp,
  Receipt,
} from "lucide-react";
import { adminLiveQueryOptions } from "@/lib/refresh";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — MySewa Console" },
      {
        name: "description",
        content:
          "MySewa super admin overview: total users, wallet float, pending deposits and daily top-up and transfer volume.",
      },
      { property: "og:title", content: "Admin Dashboard — MySewa" },
      {
        property: "og:description",
        content: "KPIs and the pending deposit approval queue for MySewa operations.",
      },
    ],
  }),
  component: AdminDashboard,
});

const PIE_COLORS = [COLORS.brand, COLORS.ocean, COLORS.success, COLORS.warning];

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] shadow-sm">
      {label ? <p className="mb-1 font-medium text-muted-foreground">{label}</p> : null}
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={entry.name} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="size-1.5 rounded-full" style={{ background: entry.color }} />
              {entry.name}
            </span>
            <span className="tabular font-medium text-foreground">{formatNPR(entry.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdminDashboard() {
  const dash = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => apiClient.adminDashboard(),
    ...adminLiveQueryOptions(),
  });

  const dashKpis = dash.data?.kpis;
  const kpis = dashKpis
    ? [
        {
          key: "users",
          label: "Users",
          value: String(dashKpis.total_users ?? 0),
          icon: Users,
          tone: "brand" as const,
          to: "/admin/users",
        },
        {
          key: "float",
          label: "Wallet float",
          value: formatNPR(dashKpis.wallet_float ?? 0),
          icon: Wallet,
          tone: "default" as const,
          to: "/admin/wallets",
        },
        {
          key: "pending",
          label: "Pending",
          value: String(dashKpis.pending_deposits ?? 0),
          icon: Inbox,
          tone: "warning" as const,
          to: "/admin/deposits",
        },
        {
          key: "topups",
          label: "Top-ups",
          value: String(dashKpis.topups_today ?? 0),
          hint: "Today",
          icon: Smartphone,
          tone: "info" as const,
          to: "/admin/topups",
        },
        {
          key: "transfers",
          label: "Transfers",
          value: String(dashKpis.transfers_today ?? 0),
          hint: "Today",
          icon: Banknote,
          tone: "debit" as const,
          to: "/admin/transfers",
        },
        {
          key: "commission",
          label: "Commission",
          value: formatNPR(dashKpis.commission_today ?? 0),
          hint: `All-time ${formatNPR(dashKpis.commission_total ?? 0)}`,
          icon: Coins,
          tone: "credit" as const,
          to: "/admin/commission-history",
        },
        {
          key: "dealers",
          label: "Dealers",
          value: String(dashKpis.total_dealers ?? 0),
          icon: Handshake,
          tone: "brand" as const,
          to: "/admin/dealers",
        },
        {
          key: "subAgents",
          label: "Sub-Agents",
          value: String(dashKpis.total_sub_agents ?? 0),
          icon: UserPlus,
          tone: "info" as const,
          to: "/admin/users",
        },
        {
          key: "customers",
          label: "Customers",
          value: String(dashKpis.total_customers ?? 0),
          icon: Users,
          tone: "default" as const,
          to: "/admin/users",
        },
        {
          key: "tds",
          label: "TDS today",
          value: formatNPR(dashKpis.tds_today ?? 0),
          icon: Receipt,
          tone: "warning" as const,
          to: "/admin/dealer-profit",
        },
        {
          key: "profit",
          label: "SA profit",
          value: formatNPR(dashKpis.super_admin_profit_today ?? 0),
          hint: "Today",
          icon: TrendingUp,
          tone: "credit" as const,
          to: "/admin/dealer-profit",
        },
        {
          key: "statement",
          label: "Issues",
          value: String(dashKpis.open_statement_issues ?? 0),
          icon: AlertTriangle,
          tone:
            (dashKpis.open_statement_issues ?? 0) > 0
              ? ("warning" as const)
              : ("default" as const),
          to: "/admin/statement",
        },
      ]
    : [];

  const amountCards = amountSummaryCards(dash.data?.summary, {
    keys: ["total_volume", "total_credit", "total_debit", "today_amount", "monthly_amount"],
    labels: {
      total_volume: "Volume",
      total_credit: "Credit",
      total_debit: "Debit",
      today_amount: "Today",
      monthly_amount: "This month",
    },
  });

  const volumeSeries = dash.data?.volume_series ?? [];
  const operatorSplit = dash.data?.operator_split ?? [];
  const pending = dash.data?.pending_deposits ?? [];
  const openIssues = dashKpis?.open_statement_issues ?? 0;

  return (
    <AdminShell title="Dashboard" description="Live ops overview" dense>
      {dash.isLoading ? (
        <div className="space-y-3">
          <AdminMetricStripSkeleton cells={12} />
          <AdminMetricStripSkeleton cells={5} />
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="h-52 animate-pulse rounded-lg border border-border bg-surface lg:col-span-2" />
            <div className="h-52 animate-pulse rounded-lg border border-border bg-surface" />
          </div>
        </div>
      ) : dash.isError ? (
        <p className="text-sm text-danger">Failed to load dashboard.</p>
      ) : (
        <div className="space-y-3">
          {openIssues > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
              <p>
                <span className="font-semibold">
                  {openIssues} HimalPay statement issue{openIssues === 1 ? "" : "s"}
                </span>{" "}
                need review.
              </p>
              <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-[11px]">
                <Link to="/admin/statement">Check statement</Link>
              </Button>
            </div>
          ) : null}

          <AdminMetricStrip items={kpis} />
          {amountCards.length > 0 ? <AdminMetricStrip items={amountCards} /> : null}

          <div className="grid gap-3 lg:grid-cols-3">
            <section className="rounded-lg border border-border bg-surface p-3 lg:col-span-2">
              <h2 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Weekly volume
              </h2>
              <div className="mt-2 h-40 sm:h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeSeries} margin={{ top: 4, left: -18, right: 4, bottom: 0 }} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLORS.separator} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 10, fill: COLORS.secondary }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: COLORS.secondary }}
                      width={44}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(15,23,42,0.04)" }} />
                    <Bar dataKey="deposits" fill={COLORS.brand} name="Deposits" radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Bar dataKey="topups" fill={COLORS.ocean} name="Top-ups" radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Bar
                      dataKey="transfers"
                      fill={COLORS.success}
                      name="Transfers"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={18}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface p-3">
              <h2 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Operator split
              </h2>
              <div className="mt-2 h-40 sm:h-44">
                {operatorSplit.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No top-up volume
                  </p>
                ) : (
                  <div className="flex h-full items-center gap-3">
                    <div className="h-full min-w-0 flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={operatorSplit}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={42}
                            outerRadius={62}
                            paddingAngle={2}
                            stroke="none"
                          >
                            {operatorSplit.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="w-[42%] shrink-0 space-y-1.5">
                      {operatorSplit.map((op, i) => (
                        <li key={op.name} className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-[11px] font-medium text-foreground">
                            <span
                              className="size-1.5 shrink-0 rounded-full"
                              style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                            />
                            {op.name}
                          </p>
                          <p className="tabular pl-3 text-[10px] text-muted-foreground">
                            {formatNPR(op.value)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Pending deposits
              </h2>
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[11px]">
                <Link to="/admin/deposits">View all</Link>
              </Button>
            </div>
            <AdminDataList
              isEmpty={pending.length === 0}
              empty={<AdminEmptyState>No pending deposits.</AdminEmptyState>}
              table={
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8 px-3 text-[10px] uppercase tracking-wide">ID</TableHead>
                      <TableHead className="h-8 px-3 text-[10px] uppercase tracking-wide">Phone</TableHead>
                      <TableHead className="h-8 px-3 text-right text-[10px] uppercase tracking-wide">
                        Amount
                      </TableHead>
                      <TableHead className="h-8 px-3 text-[10px] uppercase tracking-wide">Created</TableHead>
                      <TableHead className="h-8 px-3 text-[10px] uppercase tracking-wide">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((d) => (
                      <TableRow key={d.id} className="text-[13px]">
                        <TableCell className="px-3 py-1.5">
                          <Link
                            to="/admin/deposits/$depositId"
                            params={{ depositId: String(d.id) }}
                            className="font-medium text-brand hover:underline"
                          >
                            #{d.id}
                          </Link>
                        </TableCell>
                        <TableCell className="px-3 py-1.5 tabular">{d.phone}</TableCell>
                        <TableCell className="tabular px-3 py-1.5 text-right font-semibold">
                          {formatNPR(d.amount)}
                        </TableCell>
                        <TableCell className="px-3 py-1.5 text-muted-foreground">
                          {formatDateTime(d.created_at)}
                        </TableCell>
                        <TableCell className="px-3 py-1.5">
                          <StatusChip status={d.status} compact />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              mobile={
                <AdminMobileCardGrid className="gap-2">
                  {pending.map((d) => (
                    <AdminMobileCard key={d.id} className="p-3 shadow-none">
                      <Link
                        to="/admin/deposits/$depositId"
                        params={{ depositId: String(d.id) }}
                        className="block no-underline"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{d.phone}</p>
                            <p className="text-[11px] text-muted-foreground">#{d.id}</p>
                          </div>
                          <StatusChip status={d.status} compact />
                        </div>
                        <AdminMobileMeta
                          items={[
                            { label: "Amount", value: formatNPR(d.amount) },
                            { label: "Created", value: formatDateTime(d.created_at) },
                          ]}
                        />
                      </Link>
                    </AdminMobileCard>
                  ))}
                </AdminMobileCardGrid>
              }
            />
          </section>
        </div>
      )}
    </AdminShell>
  );
}
