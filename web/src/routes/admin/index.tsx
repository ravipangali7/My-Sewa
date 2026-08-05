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
import { StatsCards, amountSummaryCards } from "@/components/admin/StatsCards";
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
import { Users, Wallet, Inbox, Smartphone, Banknote } from "lucide-react";

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

function AdminDashboard() {
  const dash = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => apiClient.adminDashboard(),
  });

  const kpis = dash.data
    ? [
        {
          key: "users",
          label: "Total users",
          value: String(dash.data.kpis.total_users),
          icon: Users,
          tone: "brand" as const,
        },
        {
          key: "float",
          label: "Wallet float",
          value: formatNPR(dash.data.kpis.wallet_float),
          icon: Wallet,
          tone: "default" as const,
        },
        {
          key: "pending",
          label: "Pending deposits",
          value: String(dash.data.kpis.pending_deposits),
          icon: Inbox,
          tone: "warning" as const,
        },
        {
          key: "topups",
          label: "Top-ups today",
          value: String(dash.data.kpis.topups_today),
          icon: Smartphone,
          tone: "info" as const,
        },
        {
          key: "transfers",
          label: "Transfers today",
          value: String(dash.data.kpis.transfers_today),
          icon: Banknote,
          tone: "debit" as const,
        },
      ]
    : [];

  const amountCards = amountSummaryCards(dash.data?.summary, {
    keys: ["total_volume", "total_credit", "total_debit", "today_amount", "monthly_amount"],
  });

  const volumeSeries = dash.data?.volume_series ?? [];
  const operatorSplit = dash.data?.operator_split ?? [];
  const pending = dash.data?.pending_deposits ?? [];
  const pieColors = [COLORS.brand, COLORS.ocean, COLORS.success, COLORS.warning];

  return (
    <AdminShell title="Dashboard" description="Operational overview across wallets and ledgers">
      {dash.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading dashboard…</p>
      ) : dash.isError ? (
        <p className="text-sm text-danger">Failed to load dashboard.</p>
      ) : (
        <>
          <StatsCards items={kpis} />
          {amountCards.length > 0 ? (
            <div className="mt-4">
              <StatsCards items={amountCards} />
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
              <h2 className="text-base font-semibold">Weekly volume (NPR)</h2>
              <div className="mt-4 h-52 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeSeries} margin={{ left: -12, right: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip />
                    <Bar dataKey="deposits" fill={COLORS.brand} name="Deposits" />
                    <Bar dataKey="topups" fill={COLORS.ocean} name="Top-ups" />
                    <Bar dataKey="transfers" fill={COLORS.success} name="Transfers" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="text-base font-semibold">Operator split</h2>
              <div className="mt-4 h-52 sm:h-64">
                {operatorSplit.length === 0 ? (
                  <p className="pt-16 text-center text-sm text-muted-foreground">No top-up volume</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={operatorSplit}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={80}
                        label
                      >
                        {operatorSplit.map((_, i) => (
                          <Cell key={i} fill={pieColors[i % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Pending deposits</h2>
              <Button asChild size="sm" variant="secondary">
                <Link to="/admin/deposits">View all</Link>
              </Button>
            </div>

            <AdminDataList
              isEmpty={pending.length === 0}
              empty={<AdminEmptyState>No pending deposits.</AdminEmptyState>}
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>#{d.id}</TableCell>
                        <TableCell>{d.phone}</TableCell>
                        <TableCell className="tabular text-right font-semibold">
                          {formatNPR(d.amount)}
                        </TableCell>
                        <TableCell>{formatDateTime(d.created_at)}</TableCell>
                        <TableCell>
                          <StatusChip status={d.status} compact />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              mobile={
                <AdminMobileCardGrid>
                  {pending.map((d) => (
                    <AdminMobileCard key={d.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{d.phone}</p>
                          <p className="text-xs text-muted-foreground">#{d.id}</p>
                        </div>
                        <StatusChip status={d.status} compact />
                      </div>
                      <AdminMobileMeta
                        items={[
                          { label: "Amount", value: formatNPR(d.amount) },
                          { label: "Created", value: formatDateTime(d.created_at) },
                        ]}
                      />
                    </AdminMobileCard>
                  ))}
                </AdminMobileCardGrid>
              }
            />
          </div>
        </>
      )}
    </AdminShell>
  );
}
