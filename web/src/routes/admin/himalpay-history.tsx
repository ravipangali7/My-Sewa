import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpRight,
  FileSearch,
  RefreshCw,
} from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { HimalPayBalanceStrip } from "@/components/admin/HimalPayBalanceStrip";
import { StatsCards } from "@/components/admin/StatsCards";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { StatusChip } from "@/components/StatusChip";
import { TxnBeforeAfter } from "@/components/TxnBeforeAfter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime, formatNPR, sortByLatestFirst } from "@/lib/format";
import { downloadCsvWithQuery } from "@/lib/list-query";
import { serialNumber } from "@/lib/serial";
import { cn } from "@/lib/utils";
import type { HimalPayHistoryItem } from "@/lib/types";

export const Route = createFileRoute("/admin/himalpay-history")({
  head: () => ({
    meta: [
      { title: "HimalPay History — MySewa Admin" },
      {
        name: "description",
        content:
          "Live HimalPay reseller wallet history: credits, debits, charges and before/after float.",
      },
      { property: "og:title", content: "HimalPay History — MySewa Admin" },
    ],
  }),
  component: HimalPayHistoryPage,
});

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthStartISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

type HistoryTab = "all" | "credit" | "debit";

function statusForChip(status: string): "success" | "pending" | "failed" {
  const s = status.toLowerCase();
  if (s === "success") return "success";
  if (s === "failed") return "failed";
  return "pending";
}

function HistoryTable({
  items,
  emptyLabel,
  loading,
}: {
  items: HimalPayHistoryItem[];
  emptyLabel: string;
  loading: boolean;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading HimalPay history…</p>;
  }

  return (
    <AdminDataList
      isEmpty={items.length === 0}
      empty={<AdminEmptyState>{emptyLabel}</AdminEmptyState>}
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>HimalPay</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Float</TableHead>
              <TableHead className="text-right">Statement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row, index) => {
              const credit = row.direction === "credit";
              return (
                <TableRow key={row.key}>
                  <TableCell className="tabular text-muted-foreground">
                    {serialNumber(1, items.length || 1, index)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {row.service || "—"}{" "}
                      <span className="capitalize text-muted-foreground">
                        · {row.kind !== "transaction" ? row.kind : row.direction}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground break-all">
                      {row.transaction_uuid}
                    </div>
                    {row.created_at ? (
                      <div className="text-[11px] text-muted-foreground">
                        {formatDateTime(row.created_at)}
                      </div>
                    ) : null}
                    {row.reference_id ? (
                      <div className="text-[11px] text-muted-foreground">
                        Ref {row.reference_id}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusChip status={statusForChip(row.status)} compact />
                  </TableCell>
                  <TableCell className="text-right">
                    <div
                      className={cn(
                        "tabular font-semibold",
                        credit ? "text-success" : "text-foreground",
                      )}
                    >
                      {credit ? "+" : "−"} {formatNPR(row.net_amount)}
                    </div>
                    {Number(row.charge) > 0 || Number(row.cashback) > 0 ? (
                      <div className="text-[11px] text-muted-foreground">
                        {Number(row.charge) > 0 ? `chg ${formatNPR(row.charge)}` : null}
                        {Number(row.charge) > 0 && Number(row.cashback) > 0 ? " · " : null}
                        {Number(row.cashback) > 0 ? `cb ${formatNPR(row.cashback)}` : null}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="min-w-[220px]">
                    <TxnBeforeAfter before={row.balance_before} after={row.balance_after} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/statement" search={{ q: row.transaction_uuid, tab: "ledger" }}>
                        Match
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      }
      mobile={
        <AdminMobileCardGrid>
          {items.map((row, index) => {
            const credit = row.direction === "credit";
            return (
              <AdminMobileCard key={row.key}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">
                      {serialNumber(1, items.length || 1, index)}
                    </p>
                    <p className="font-medium">
                      {row.service || "—"}{" "}
                      <span className="capitalize text-muted-foreground">· {row.direction}</span>
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground break-all">
                      {row.transaction_uuid}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        "tabular font-semibold",
                        credit ? "text-success" : "text-foreground",
                      )}
                    >
                      {credit ? "+" : "−"} {formatNPR(row.net_amount)}
                    </p>
                    <StatusChip status={statusForChip(row.status)} compact className="mt-1" />
                  </div>
                </div>
                {row.created_at ? (
                  <AdminMobileMeta
                    items={[{ label: "When", value: formatDateTime(row.created_at) }]}
                  />
                ) : null}
                <TxnBeforeAfter
                  before={row.balance_before}
                  after={row.balance_after}
                  className="mt-3"
                />
                <div className="mt-3">
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <Link to="/admin/statement" search={{ q: row.transaction_uuid, tab: "ledger" }}>
                      Open on statement
                    </Link>
                  </Button>
                </div>
              </AdminMobileCard>
            );
          })}
        </AdminMobileCardGrid>
      }
    />
  );
}

function HimalPayHistoryPage() {
  const [fromDate, setFromDate] = useState(monthStartISO);
  const [toDate, setToDate] = useState(todayISO);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<HistoryTab>("all");
  const [exporting, setExporting] = useState(false);

  const filters = useMemo(
    () => ({
      from_date: fromDate,
      to_date: toDate,
      q: search.trim() || undefined,
    }),
    [fromDate, toDate, search],
  );

  const historyQuery = useQuery({
    queryKey: ["admin", "statement", "history", filters],
    queryFn: () => apiClient.adminStatementHistory(filters),
    refetchOnMount: "always",
  });

  const items = useMemo(
    () => sortByLatestFirst(historyQuery.data?.items ?? []),
    [historyQuery.data?.items],
  );
  const credits = items.filter((row) => row.direction === "credit");
  const debits = items.filter((row) => row.direction !== "credit");
  const visible = tab === "all" ? items : tab === "credit" ? credits : debits;
  const counts = historyQuery.data?.counts;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsvWithQuery(
        "/api/admin/statement/history/",
        {
          from_date: fromDate,
          to_date: toDate,
          q: search.trim() || undefined,
          direction: tab === "all" ? undefined : tab,
        },
        "himalpay-history.csv",
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminShell
      title="HimalPay History"
      description="Reseller wallet movements from HimalPay — click a row to match it on Statement"
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/statement">
            <FileSearch className="mr-1.5 size-3.5" />
            Statement
          </Link>
        </Button>
      }
    >
      <div className="space-y-4">
        <HimalPayBalanceStrip />

        <StatsCards
          items={[
            {
              key: "credit",
              label: "Credits",
              value: formatNPR(counts?.credit_amount ?? 0),
              hint: `${counts?.credit ?? credits.length} credit movement${(counts?.credit ?? credits.length) === 1 ? "" : "s"}`,
              icon: ArrowDownToLine,
              tone: "credit",
            },
            {
              key: "debit",
              label: "Debits",
              value: formatNPR(counts?.debit_amount ?? 0),
              hint: `${counts?.debit ?? debits.length} debit movement${(counts?.debit ?? debits.length) === 1 ? "" : "s"}`,
              icon: ArrowUpRight,
              tone: "debit",
            },
          ]}
        />

        {historyQuery.data?.warning ? (
          <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-foreground">
            <p className="font-medium">Showing stored HimalPay statement rows</p>
            <p className="mt-1 text-muted-foreground">{historyQuery.data.warning}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="hp-from">From</Label>
              <Input
                id="hp-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hp-to">To</Label>
              <Input
                id="hp-to"
                type="date"
                value={toDate}
                max={todayISO()}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="hp-q">Search</Label>
              <Input
                id="hp-q"
                placeholder="UUID, service, reference…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => historyQuery.refetch()}
              disabled={historyQuery.isFetching}
            >
              <RefreshCw className={`mr-2 size-4 ${historyQuery.isFetching ? "animate-spin" : ""}`} />
              {historyQuery.isFetching ? "Refreshing…" : "Refresh history"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void exportCsv()} disabled={exporting}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {historyQuery.data?.source === "live"
                ? `Live HimalPay statement · ${historyQuery.data.from_date} → ${historyQuery.data.to_date}`
                : `Stored statement rows · ${fromDate} → ${toDate}`}
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as HistoryTab)}>
          <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl sm:w-auto sm:min-w-[22rem]">
            <TabsTrigger value="all">All ({items.length})</TabsTrigger>
            <TabsTrigger value="credit">Credit ({credits.length})</TabsTrigger>
            <TabsTrigger value="debit">Debit ({debits.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-4">
            <HistoryTable
              items={visible}
              emptyLabel="No HimalPay movements in this range."
              loading={historyQuery.isLoading}
            />
          </TabsContent>
          <TabsContent value="credit" className="mt-4">
            <HistoryTable
              items={visible}
              emptyLabel="No HimalPay credits in this range."
              loading={historyQuery.isLoading}
            />
          </TabsContent>
          <TabsContent value="debit" className="mt-4">
            <HistoryTable
              items={visible}
              emptyLabel="No HimalPay debits in this range."
              loading={historyQuery.isLoading}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}
