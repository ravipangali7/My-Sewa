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
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownToLine,
  ArrowDownUp,
  Banknote,
  FileBarChart2,
  RefreshCw,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api";
import { formatNPR } from "@/lib/format";
import { COLORS } from "@/constants/colors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/users_/$userId_/report")({
  head: () => ({
    meta: [
      { title: "User Report — MySewa Admin" },
      {
        name: "description",
        content:
          "Per-user transaction report with deposits, transfers, top-ups, wallet activity, and charges.",
      },
      { property: "og:title", content: "User Report — MySewa Admin" },
    ],
  }),
  component: UserReportPage,
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

const PIE_COLORS = [
  COLORS.brand,
  COLORS.ocean,
  COLORS.success,
  COLORS.info,
  COLORS.warning,
  COLORS.brandAccent,
];

function compactNPR(value: number) {
  if (value >= 1_000_000) return `Rs. ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `Rs. ${(value / 1_000).toFixed(1)}K`;
  return formatNPR(value);
}

function UserReportPage() {
  const { userId } = Route.useParams();
  const id = Number(userId);
  const initial = rangeForPreset("30d");
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);

  const report = useQuery({
    queryKey: ["admin", "users", id, "report", startDate, endDate],
    queryFn: () => apiClient.adminUserReport(id, { startDate, endDate }),
    enabled: Number.isFinite(id),
  });

  const applyPreset = (next: Exclude<RangePreset, "custom">) => {
    const range = rangeForPreset(next);
    setPreset(next);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  };

  const data = report.data;
  const displayName = data
    ? [data.user.first_name, data.user.last_name].filter(Boolean).join(" ") || data.user.phone
    : `User #${userId}`;

  const categories = useMemo(() => {
    if (!data?.categories) return [];
    return Object.entries(data.categories).map(([key, value]) => ({ key, ...value }));
  }, [data?.categories]);

  const chargesChart = useMemo(() => {
    if (!data?.charges_breakdown) return [];
    return [
      { name: "Top-ups", value: data.charges_breakdown.topups },
      { name: "Transfers", value: data.charges_breakdown.transfers },
      { name: "Remittances", value: data.charges_breakdown.remittances },
      { name: "Internet", value: data.charges_breakdown.internet_bills },
      { name: "Data packs", value: data.charges_breakdown.data_packs },
    ].filter((row) => row.value > 0);
  }, [data?.charges_breakdown]);

  const summaryCards = data
    ? [
        {
          label: "Total deposits",
          value: formatNPR(data.summary.total_deposits),
          hint: `${data.categories["deposits"]?.success_count ?? 0} approved`,
          icon: ArrowDownToLine,
        },
        {
          label: "Total transfers",
          value: formatNPR(data.summary.total_transfers),
          hint: `${data.categories["transfers"]?.success_count ?? 0} successful`,
          icon: Banknote,
        },
        {
          label: "Total top-ups",
          value: formatNPR(data.summary.total_topups),
          hint: `${data.categories["topups"]?.success_count ?? 0} successful`,
          icon: Smartphone,
        },
        {
          label: "Wallet credits",
          value: formatNPR(data.summary.total_wallet_credits),
          hint: "Deposits + remittances",
          icon: TrendingUp,
        },
        {
          label: "Wallet debits",
          value: formatNPR(data.summary.total_wallet_debits),
          hint: "Outbound services",
          icon: TrendingDown,
        },
        {
          label: "Transaction volume",
          value: formatNPR(data.summary.transaction_volume),
          hint: `${data.summary.total_transactions} transactions`,
          icon: ArrowDownUp,
        },
        {
          label: "Charges",
          value: formatNPR(data.summary.charges),
          hint: "Fees in selected range",
          icon: FileBarChart2,
        },
        {
          label: "Current balance",
          value: formatNPR(data.wallet_balance),
          hint: `Net ${formatNPR(data.balance_summary.net)} in range`,
          icon: Wallet,
        },
      ]
    : [];

  return (
    <AdminShell
      title={`${displayName} — Report`}
      description={
        data
          ? `Activity report for ${data.user.phone}`
          : report.isLoading
            ? "Loading…"
            : "User report"
      }
      actions={
        <Button
          size="sm"
          variant="secondary"
          disabled={report.isFetching}
          onClick={() => report.refetch()}
        >
          <RefreshCw className={cn("size-3.5", report.isFetching && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <BackButton to="/admin/users/$userId" params={{ userId }} label="Back to user" />
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/users/$userId" params={{ userId }}>
            User details
          </Link>
        </Button>
      </div>

      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-surface p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium">Date range</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Filter deposits, transfers, top-ups, and wallet activity
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
                <label className="text-[11px] text-muted-foreground" htmlFor="user-report-start">
                  From
                </label>
                <Input
                  id="user-report-start"
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
                <label className="text-[11px] text-muted-foreground" htmlFor="user-report-end">
                  To
                </label>
                <Input
                  id="user-report-end"
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

        {report.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading user report…</p>
        ) : report.isError ? (
          <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
            Failed to load user report. Check your connection and try again.
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-border bg-surface p-3.5 sm:p-4"
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
                    {compactNPR(data.summary.transaction_volume)}
                  </p>
                </div>
                <div className="mt-4 h-56 sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.volume_series} margin={{ left: -8, right: 4, top: 8 }}>
                      <defs>
                        <linearGradient id="userVolumeFill" x1="0" y1="0" x2="0" y2="1">
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
                        formatter={(value: number) => [formatNPR(value), "Total"]}
                        labelFormatter={(label) => String(label)}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke={COLORS.brand}
                        strokeWidth={2}
                        fill="url(#userVolumeFill)"
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
                        <Tooltip formatter={(value: number) => formatNPR(value)} />
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

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-base font-semibold">Balance summary</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Wallet movement within the selected period
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/40 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">Credits</p>
                    <p className="tabular mt-0.5 text-sm font-semibold text-success">
                      {formatNPR(data.balance_summary.credits)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">Debits</p>
                    <p className="tabular mt-0.5 text-sm font-semibold text-danger">
                      {formatNPR(data.balance_summary.debits)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">Net</p>
                    <p className="tabular mt-0.5 text-sm font-semibold">
                      {formatNPR(data.balance_summary.net)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">Current balance</p>
                    <p className="tabular mt-0.5 text-sm font-semibold">
                      {formatNPR(data.balance_summary.current_balance)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(
                        [
                          ["Deposit credits", data.balance_summary.breakdown.deposit_credits],
                          ["Remittance credits", data.balance_summary.breakdown.remittance_credits],
                          ["Adjustment credits", data.balance_summary.breakdown.adjustment_credits],
                          ["Top-up debits", data.balance_summary.breakdown.topup_debits],
                          ["Transfer debits", data.balance_summary.breakdown.transfer_debits],
                          ["Internet debits", data.balance_summary.breakdown.internet_debits],
                          ["Data pack debits", data.balance_summary.breakdown.datapack_debits],
                          ["Adjustment debits", data.balance_summary.breakdown.adjustment_debits],
                        ] as const
                      ).map(([label, amount]) => (
                        <TableRow key={label}>
                          <TableCell>{label}</TableCell>
                          <TableCell className="tabular text-right">{formatNPR(amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-base font-semibold">Charges</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Fees collected across successful services
                </p>
                <p className="tabular mt-3 text-2xl font-semibold">
                  {formatNPR(data.summary.charges)}
                </p>
                <div className="mt-4 h-52">
                  {chargesChart.length === 0 ? (
                    <p className="pt-16 text-center text-sm text-muted-foreground">
                      No charges in this range
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chargesChart} margin={{ left: -4, right: 4, top: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          width={48}
                          tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                        />
                        <Tooltip formatter={(value: number) => formatNPR(value)} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {chargesChart.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="text-base font-semibold">Category breakdown</h2>
              <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
                Counts, volumes, and success rates by service
              </p>
              <div className="overflow-x-auto">
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
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
