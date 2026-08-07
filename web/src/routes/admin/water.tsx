import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/layout/AdminShell";
import { ListPageToolbar } from "@/components/list/ListPageToolbar";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { StatsCards, amountSummaryCards } from "@/components/admin/StatsCards";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { serialNumber } from "@/lib/serial";
import type { TxnStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";

const LIST_PAGE = 1;
const LIST_PAGE_SIZE = 50;

export const Route = createFileRoute("/admin/water")({
  head: () => ({
    meta: [
      { title: "Khanepani Ledger — MySewa Admin" },
      {
        name: "description",
        content:
          "KUKL drinking water bill ledger with connection numbers, counters, charges, cashback and provider responses.",
      },
      { property: "og:title", content: "Khanepani Ledger — MySewa Admin" },
      {
        property: "og:description",
        content: "Water bill transaction oversight for support teams.",
      },
    ],
  }),
  component: WaterPage,
});

type StatusTab = "all" | TxnStatus;

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

const STATUS_OPTIONS: { value: TxnStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

function WaterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { filters, setFilters, debounced } = useListFilters();
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [exporting, setExporting] = useState(false);

  const billsQuery = useQuery({
    queryKey: ["admin", "water-bills", debounced, statusTab],
    queryFn: () =>
      apiClient.adminWaterBills({
        ...debounced,
        status: statusTab,
      }),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TxnStatus }) =>
      apiClient.adminUpdateWaterBillStatus(id, status),
    onSuccess: (_res, vars) => {
      toast.success(`Water bill #${vars.id} marked ${vars.status}`);
      queryClient.invalidateQueries({ queryKey: ["admin", "water-bills"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Status update failed");
    },
  });

  const items = billsQuery.data?.items ?? [];
  const stats = billsQuery.data?.stats;
  const amountCards = amountSummaryCards(billsQuery.data?.summary, {
    keys: ["total_volume", "total_debit", "total_amount", "today_amount", "monthly_amount"],
    labels: {
      total_debit: "Total debit (success)",
      total_amount: "Successful amount",
    },
  });

  const statusCounts = useMemo(() => {
    const counts: Record<StatusTab, number> = {
      all: stats?.total ?? 0,
      pending: stats?.pending ?? 0,
      success: stats?.success ?? 0,
      failed: stats?.failed ?? 0,
    };
    return counts;
  }, [stats]);

  const openDetail = (id: number) => {
    navigate({ to: "/admin/water/$waterId", params: { waterId: String(id) } });
  };

  const emptyLabel = statusTab !== "all" ? statusTab : "";

  const statusSelect = (id: number, status: TxnStatus) => (
    <Select
      value={status}
      disabled={statusMutation.isPending}
      onValueChange={(value) => {
        if (value === status) return;
        statusMutation.mutate({ id, status: value as TxnStatus });
      }}
    >
      <SelectTrigger
        className="h-8 w-full min-w-[120px]"
        aria-label={`Status for water bill ${id}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <AdminShell title="Khanepani" description="KUKL drinking water bill ledger">
      {billsQuery.isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">Loading water bills…</p>
      )}
      {billsQuery.isError && (
        <p className="mb-4 text-sm text-destructive">
          {billsQuery.error instanceof ApiError
            ? billsQuery.error.message
            : "Could not load water bills."}
        </p>
      )}

      <div className="space-y-4">
        <StatsCards items={amountCards} />
        <ListPageToolbar
          stats={stats}
          filters={{ ...filters, status: statusTab }}
          onFiltersChange={(next) => {
            if (next.status) setStatusTab(next.status as StatusTab);
            setFilters(next);
          }}
          onExport={async () => {
            setExporting(true);
            try {
              await downloadCsvExport(
                "/api/admin/water-bills/",
                { ...debounced, status: statusTab },
                "admin-water-bills.csv",
              );
            } finally {
              setExporting(false);
            }
          }}
          exporting={exporting}
          searchPlaceholder="Search phone, connection, customer code, txn ID…"
          exportLabel="Bulk download"
          statsLabels={{ total: "Total", success: "Success", pending: "Pending", failed: "Failed" }}
          statusOptions={[...TXN_STATUS_OPTIONS]}
        />

        <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)}>
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                {tab.label}
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    statusTab === tab.value
                      ? "bg-muted text-foreground"
                      : "bg-background/60 text-muted-foreground",
                  )}
                >
                  {statusCounts[tab.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <AdminDataList
          isEmpty={!billsQuery.isLoading && items.length === 0}
          empty={
            <AdminEmptyState>
              No {emptyLabel ? `${emptyLabel} ` : ""}water bills.
            </AdminEmptyState>
          }
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">S.N.</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>User phone</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Customer code</TableHead>
                  <TableHead>Counter</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Charge</TableHead>
                  <TableHead className="text-right">Cashback</TableHead>
                  <TableHead className="text-right">Total debited</TableHead>
                  <TableHead>Merchant txn ID</TableHead>
                  <TableHead>Service hub txn ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t, index) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => openDetail(t.id)}
                  >
                    <TableCell className="w-10 pr-0 tabular text-sm text-muted-foreground">
                      {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}
                    </TableCell>
                    <TableCell className="text-sm">#{t.id}</TableCell>
                    <TableCell className="text-sm">{t.phone}</TableCell>
                    <TableCell className="text-sm font-medium">{t.connection_no}</TableCell>
                    <TableCell className="text-sm">{t.customer_code}</TableCell>
                    <TableCell className="max-w-40 truncate text-sm" title={t.counter}>
                      {t.counter || "—"}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-sm" title={t.customer_name}>
                      {t.customer_name || "—"}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm font-semibold">
                      {formatNPR(t.amount)}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {formatNPR(t.charge)}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {formatNPR(t.cashback)}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {formatNPR(t.total_debited)}
                    </TableCell>
                    <TableCell
                      className="max-w-40 truncate text-sm"
                      title={t.merchant_txn_id}
                    >
                      {t.merchant_txn_id}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-sm text-muted-foreground">
                      {t.service_hub_txn_id ?? "—"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {statusSelect(t.id, t.status)}
                    </TableCell>
                    <TableCell className="text-sm">{formatDateTime(t.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
          mobile={
            <AdminMobileCardGrid>
              {items.map((t, index) => (
                <AdminMobileCard key={t.id} onClick={() => openDetail(t.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="tabular shrink-0 pt-0.5 text-xs text-muted-foreground">
                        {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}.
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{t.connection_no}</p>
                        <p className="text-xs text-muted-foreground">
                          #{t.id} · {t.customer_code}
                        </p>
                      </div>
                    </div>
                    <p className="tabular shrink-0 text-base font-semibold">{formatNPR(t.amount)}</p>
                  </div>
                  <AdminMobileMeta
                    items={[
                      { label: "User", value: t.phone },
                      { label: "Counter", value: t.counter || "—" },
                      { label: "Customer", value: t.customer_name || "—" },
                      { label: "Total", value: formatNPR(t.total_debited) },
                      { label: "Charge", value: formatNPR(t.charge) },
                      { label: "Cashback", value: formatNPR(t.cashback) },
                      { label: "Created", value: formatDateTime(t.created_at) },
                      { label: "Txn ID", value: t.merchant_txn_id || "—" },
                    ]}
                  />
                  <div
                    className="mt-3 border-t border-border pt-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {statusSelect(t.id, t.status)}
                  </div>
                </AdminMobileCard>
              ))}
            </AdminMobileCardGrid>
          }
        />
      </div>
    </AdminShell>
  );
}
