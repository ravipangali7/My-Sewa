import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownToLine,
  Banknote,
  Inbox,
  Smartphone,
  TrendingUp,
  Users,
  Wallet,
  Wifi,
  Package,
  RefreshCw,
} from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api";
import { formatDateTime, formatNPR } from "@/lib/format";
import { COLORS } from "@/constants/colors";
import { cn } from "@/lib/utils";
import type { AdminReportCategory } from "@/lib/types";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [
      { title: "Reports — MySewa Admin" },
      {
        name: "description",
        content:
          "MySewa analytics and operational reports across deposits, top-ups, transfers, remittances, and more.",
      },
      { property: "og:title", content: "Reports — MySewa Admin" },
      {
        property: "og:description",
        content: "Volume, success rates, and activity reports for the MySewa Super Admin portal.",
      },
    ],
  }),
  component: ReportsPage,
});

type RangePreset = "7d" | "30d" | "90d" | "custom";

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeForPreset(preset: Exclude<RangePreset, "custom">) {
  const end = new Date();
  const start = new Date();
  const days = preset === "7d" ? 6 : preset === "30d" ? 29 : 89;
  start.setDate(end.getDate() - days);
  return { startDate: toISODate(start), endDate: toISODate(end) };
}

const CATEGORY_META: Record<
  string,
  { icon: typeof Inbox; href: string; color: string }
> = {
  deposits: { icon: Inbox, href: "/admin/deposits", color: COLORS.brand },
  topups: { icon: Smartphone, href: "/admin/topups", color: COLORS.ocean },
  transfers: { icon: Banknote, href: "/admin/transfers", color: COLORS.success },
  remittances: { icon: ArrowDownToLine, href: "/admin/remittances", color: COLORS.info },
  internet_bills: { icon: Wifi, href: "/admin/reports", color: COLORS.warning },
  data_packs: { icon: Package, href: "/admin/reports", color: COLORS.brandAccent },
};

const PIE_COLORS = [
  COLORS.brand,
  COLORS.ocean,
  COLORS.success,
  COLORS.info,
  COLORS.warning,
  COLORS.brandAccent,
];

const STATUS_COLORS: Record<string, string> = {
  Success: COLORS.success,
  Pending: COLORS.warning,
  Failed: COLORS.danger,
};

function compactNPR(value: number) {
  if (value >= 1_000_000) return `Rs. ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `Rs. ${(value / 1_000).toFixed(1)}K`;
  return formatNPR(value);
}

function ReportsPage() {
  const initial = rangeForPreset("30d");
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);

  const reports = useQuery({
    queryKey: ["admin", "reports", startDate, endDate],
    queryFn: () => apiClient.adminReports({ startDate, endDate }),
  });

  const applyPreset = (next: Exclude<RangePreset, "custom">) => {
    const range = rangeForPreset(next);
    setPreset(next);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  };

  const data = reports.data;
  const categories = useMemo(() => {
    if (!data?.categories) return [];
    return Object.entries(data.categories).map(([key, value]) => ({ key, ...value }));
  }, [data?.categories]);

  const summaryCards = data
    ? [
        {
          label: "Successful volume",
          value: formatNPR(data.summary.success_volume),
          hint: `${data.summary.success_count} successful txns`,
          icon: TrendingUp,
        },
        {
          label: "Total transactions",
          value: String(data.summary.total_transactions),
          hint: `${data.summary.success_rate}% success rate`,
          icon: Smartphone,
        },
        {
          label: "Pending queue",
          value: String(data.summary.pending_count),
          hint: `${data.summary.failed_count} failed in range`,
          icon: Inbox,
        },
        {
          label: "Wallet float",
          value: formatNPR(data.summary.wallet_float),
          hint: `${data.summary.new_users} new users`,
          icon: Wallet,
        },
        {
          label: "Registered users",
          value: String(data.summary.total_users),
          hint: `Last ${data.range.days} days`,
          icon: Users,
        },
      ]
    : [];

  return (
    <AdminShell
      title="Reports"
      description="Analytics and operational reports across all MySewa services"
      actions={
        <Button
          size="sm"
          variant="secondary"
          disabled={reports.isFetching}
          onClick={() => reports.refetch()}
        >
          <RefreshCw className={cn("size-3.5", reports.isFetching && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-surface p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium">Date range</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Filter all charts and category reports by period
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    ["7d", "Last 7 days"],
                    ["30d", "Last 30 days"],
                    ["90d", "Last 90 days"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                      preset === key
                        ? "border-brand bg-brand-soft text-brand-dark"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground" htmlFor="report-start">
                  From
                </label>
                <Input
                  id="report-start"
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => {
                    setPreset("custom");
                    setStartDate(e.target.value);
                  }}
                  className="h-9 w-full sm:w-[150px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground" htmlFor="report-end">
                  To
                </label>
                <Input
                  id="report-end"
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={toISODate(new Date())}
                  onChange={(e) => {
                    setPreset("custom");
                    setEndDate(e.target.value);
                  }}
                  className="h-9 w-full sm:w-[150px]"
                />
              </div>
            </div>
          </div>
        </div>

        {reports.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading reports…</p>
        ) : reports.isError ? (
          <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
            Failed to load reports. Check your connection and try again.
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
              {summaryCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-border bg-surface p-3.5 sm:p-4 last:col-span-2 xl:last:col-span-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground sm:text-xs">{card.label}</p>
                    <card.icon className="size-4 shrink-0 text-brand/70" />
                  </div>
                  <p className="tabular mt-1 text-lg font-semibold tracking-tight sm:mt-1.5 sm:text-xl">
                    {card.value}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{card.hint}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Volume trend</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Successful transaction volume by day (NPR)
                    </p>
                  </div>
                  <p className="tabular text-sm font-semibold text-brand">
                    {compactNPR(data.summary.success_volume)}
                  </p>
                </div>
                <div className="mt-4 h-56 sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.volume_series} margin={{ left: -8, right: 4, top: 8 }}>
                      <defs>
                        <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.brand} stopOpacity={0.28} />
                          <stop offset="100%" stopColor={COLORS.brand} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                        minTickGap={28}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        width={52}
                        tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          formatNPR(value),
                          name === "total" ? "Total" : name,
                        ]}
                        labelFormatter={(label) => String(label)}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke={COLORS.brand}
                        strokeWidth={2}
                        fill="url(#volumeFill)"
                        name="total"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-base font-semibold">Service mix</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Share of successful volume by service
                </p>
                <div className="mt-4 h-56 sm:h-72">
                  {data.service_mix.length === 0 ? (
                    <p className="pt-20 text-center text-sm text-muted-foreground">
                      No successful volume in this range
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.service_mix}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={48}
                          outerRadius={80}
                          paddingAngle={2}
                        >
                          {data.service_mix.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number) => formatNPR(value)}
                        />
                        <Legend
                          verticalAlign="bottom"
                          height={36}
                          wrapperStyle={{ fontSize: 11 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
                <h2 className="text-base font-semibold">Volume by service</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Daily stacked successful volume across products
                </p>
                <div className="mt-4 h-56 sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.volume_series} margin={{ left: -8, right: 4, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                        minTickGap={28}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        width={52}
                        tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      />
                      <Tooltip formatter={(value: number) => formatNPR(value)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="deposits" stackId="a" fill={COLORS.brand} name="Deposits" />
                      <Bar dataKey="topups" stackId="a" fill={COLORS.ocean} name="Top-ups" />
                      <Bar
                        dataKey="transfers"
                        stackId="a"
                        fill={COLORS.success}
                        name="Transfers"
                      />
                      <Bar
                        dataKey="remittances"
                        stackId="a"
                        fill={COLORS.info}
                        name="Remittances"
                      />
                      <Bar
                        dataKey="internet_bills"
                        stackId="a"
                        fill={COLORS.warning}
                        name="Internet"
                      />
                      <Bar
                        dataKey="data_packs"
                        stackId="a"
                        fill={COLORS.brandAccent}
                        name="Data packs"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-base font-semibold">Status distribution</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Transaction outcomes in selected range
                </p>
                <div className="mt-4 h-40 sm:h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.status_mix.filter((s) => s.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={70}
                        label={({ name, percent }) =>
                          `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                        }
                      >
                        {data.status_mix
                          .filter((s) => s.value > 0)
                          .map((s) => (
                            <Cell key={s.name} fill={STATUS_COLORS[s.name] ?? COLORS.secondary} />
                          ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-2">
                  {data.status_mix.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: STATUS_COLORS[s.name] }}
                        />
                        {s.name}
                      </span>
                      <span className="tabular font-medium">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-base font-semibold">Top-up operators</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">NTC vs NCELL successful volume</p>
                <div className="mt-4 h-52">
                  {data.operator_split.length === 0 ? (
                    <p className="pt-16 text-center text-sm text-muted-foreground">
                      No top-up volume
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.operator_split} layout="vertical" margin={{ left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                        />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={56} />
                        <Tooltip
                          formatter={(value: number, _n, item) => [
                            formatNPR(value),
                            `${item.payload.count} txns`,
                          ]}
                        />
                        <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                          {data.operator_split.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-base font-semibold">New users</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Registrations over the selected period
                </p>
                <div className="mt-4 h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.user_series} margin={{ left: -12, right: 4, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                        minTickGap={28}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="users"
                        stroke={COLORS.ocean}
                        strokeWidth={2}
                        dot={false}
                        name="New users"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {data.isp_split.length > 0 ? (
              <div className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-base font-semibold">Internet bill providers</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Top ISPs by successful payment volume
                </p>
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.isp_split} margin={{ left: -4, right: 4, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={56} />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        width={48}
                        tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      />
                      <Tooltip formatter={(value: number) => formatNPR(value)} />
                      <Bar dataKey="value" fill={COLORS.warning} radius={[4, 4, 0, 0]} name="Volume" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Category reports</h2>
                  <p className="text-xs text-muted-foreground">
                    Counts, volumes, and success rates by product line
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {categories.map((cat) => (
                  <CategoryCard key={cat.key} categoryKey={cat.key} category={cat} />
                ))}
              </div>

              <div className="mt-5 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Success</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead className="text-right">Success volume</TableHead>
                      <TableHead className="text-right">Success rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories.map((cat) => (
                      <TableRow key={cat.key}>
                        <TableCell className="font-medium">{cat.label}</TableCell>
                        <TableCell className="tabular text-right">{cat.count}</TableCell>
                        <TableCell className="tabular text-right text-success">
                          {cat.success_count}
                        </TableCell>
                        <TableCell className="tabular text-right text-warning">
                          {cat.pending_count}
                        </TableCell>
                        <TableCell className="tabular text-right text-danger">
                          {cat.failed_count}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {formatNPR(cat.success_volume)}
                        </TableCell>
                        <TableCell className="tabular text-right">{cat.success_rate}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="text-base font-semibold">Recent activity</h2>
              <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
                Latest transactions in the selected date range
              </p>

              <Tabs defaultValue="deposits">
                <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1">
                  <TabsTrigger value="deposits">Deposits</TabsTrigger>
                  <TabsTrigger value="topups">Top-ups</TabsTrigger>
                  <TabsTrigger value="transfers">Transfers</TabsTrigger>
                  <TabsTrigger value="remittances">Remittances</TabsTrigger>
                </TabsList>

                <TabsContent value="deposits">
                  <RecentDeposits items={data.recent.deposits} />
                </TabsContent>
                <TabsContent value="topups">
                  <RecentTopups items={data.recent.topups} />
                </TabsContent>
                <TabsContent value="transfers">
                  <RecentTransfers items={data.recent.transfers} />
                </TabsContent>
                <TabsContent value="remittances">
                  <RecentRemittances items={data.recent.remittances} />
                </TabsContent>
              </Tabs>
            </div>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}

function CategoryCard({
  categoryKey,
  category,
}: {
  categoryKey: string;
  category: AdminReportCategory & { key?: string };
}) {
  const meta = CATEGORY_META[categoryKey] ?? {
    icon: TrendingUp,
    href: "/admin/reports",
    color: COLORS.brand,
  };
  const Icon = meta.icon;
  const hasAdminList = !["internet_bills", "data_packs"].includes(categoryKey);

  return (
    <div className="rounded-xl border border-border bg-background/60 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex size-9 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
          >
            <Icon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">{category.label}</p>
            <p className="text-[11px] text-muted-foreground">{category.count} transactions</p>
          </div>
        </div>
        {hasAdminList ? (
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link to={meta.href}>View</Link>
          </Button>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <p className="text-muted-foreground">Volume</p>
          <p className="tabular mt-0.5 font-semibold">{compactNPR(category.success_volume)}</p>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <p className="text-muted-foreground">Success rate</p>
          <p className="tabular mt-0.5 font-semibold">{category.success_rate}%</p>
        </div>
      </div>
    </div>
  );
}

function RecentDeposits({ items }: { items: import("@/lib/types").Deposit[] }) {
  return (
    <AdminDataList
      isEmpty={items.length === 0}
      empty={<AdminEmptyState>No deposits in this range.</AdminEmptyState>}
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
            {items.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <Link to="/admin/deposits/$depositId" params={{ depositId: String(d.id) }} className="text-brand hover:underline">
                    #{d.id}
                  </Link>
                </TableCell>
                <TableCell>{d.phone}</TableCell>
                <TableCell className="tabular text-right">{formatNPR(d.amount)}</TableCell>
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
          {items.map((d) => (
            <AdminMobileCard key={d.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
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
  );
}

function RecentTopups({ items }: { items: import("@/lib/types").TopupTransaction[] }) {
  return (
    <AdminDataList
      isEmpty={items.length === 0}
      empty={<AdminEmptyState>No top-ups in this range.</AdminEmptyState>}
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link to="/admin/topups/$topupId" params={{ topupId: String(t.id) }} className="text-brand hover:underline">
                    #{t.id}
                  </Link>
                </TableCell>
                <TableCell>{t.product_name}</TableCell>
                <TableCell>{t.mobile_number}</TableCell>
                <TableCell className="tabular text-right">{formatNPR(t.amount)}</TableCell>
                <TableCell>
                  <StatusChip status={t.status} compact />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      mobile={
        <AdminMobileCardGrid>
          {items.map((t) => (
            <AdminMobileCard key={t.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{t.mobile_number}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.product_name} · #{t.id}
                  </p>
                </div>
                <StatusChip status={t.status} compact />
              </div>
              <AdminMobileMeta
                items={[
                  { label: "Amount", value: formatNPR(t.amount) },
                  { label: "Created", value: formatDateTime(t.created_at) },
                ]}
              />
            </AdminMobileCard>
          ))}
        </AdminMobileCardGrid>
      }
    />
  );
}

function RecentTransfers({ items }: { items: import("@/lib/types").BankTransferTransaction[] }) {
  return (
    <AdminDataList
      isEmpty={items.length === 0}
      empty={<AdminEmptyState>No transfers in this range.</AdminEmptyState>}
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Bank</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((t) => (
              <TableRow key={t.id}>
                <TableCell>#{t.id}</TableCell>
                <TableCell>{t.destination_bank_name || t.destination_bank}</TableCell>
                <TableCell>{t.destination_acc_no}</TableCell>
                <TableCell className="tabular text-right">{formatNPR(t.amount)}</TableCell>
                <TableCell>
                  <StatusChip status={t.status} compact />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      mobile={
        <AdminMobileCardGrid>
          {items.map((t) => (
            <AdminMobileCard key={t.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {t.destination_bank_name || t.destination_bank}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.destination_acc_no}</p>
                </div>
                <StatusChip status={t.status} compact />
              </div>
              <AdminMobileMeta
                items={[
                  { label: "Amount", value: formatNPR(t.amount) },
                  { label: "Created", value: formatDateTime(t.created_at) },
                ]}
              />
            </AdminMobileCard>
          ))}
        </AdminMobileCardGrid>
      }
    />
  );
}

function RecentRemittances({ items }: { items: import("@/lib/types").RemittanceTransaction[] }) {
  return (
    <AdminDataList
      isEmpty={items.length === 0}
      empty={<AdminEmptyState>No remittances in this range.</AdminEmptyState>}
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead>Receiver</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    to="/admin/remittances"
                    className="text-brand hover:underline"
                  >
                    #{r.id}
                  </Link>
                </TableCell>
                <TableCell>{r.ref_no}</TableCell>
                <TableCell>{r.receiver_name || r.phone}</TableCell>
                <TableCell className="tabular text-right">{formatNPR(r.amount)}</TableCell>
                <TableCell>
                  <StatusChip status={r.status} compact />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
      mobile={
        <AdminMobileCardGrid>
          {items.map((r) => (
            <AdminMobileCard key={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{r.receiver_name || r.phone}</p>
                  <p className="text-xs text-muted-foreground">{r.ref_no}</p>
                </div>
                <StatusChip status={r.status} compact />
              </div>
              <AdminMobileMeta
                items={[
                  { label: "Amount", value: formatNPR(r.amount) },
                  { label: "Created", value: formatDateTime(r.created_at) },
                ]}
              />
            </AdminMobileCard>
          ))}
        </AdminMobileCardGrid>
      }
    />
  );
}
