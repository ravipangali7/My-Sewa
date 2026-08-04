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
import { OPERATORS } from "@/lib/constants";
import { formatNPR, formatDateTime } from "@/lib/format";
import type { TxnStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";

export const Route = createFileRoute("/admin/topups")({
  head: () => ({
    meta: [
      { title: "Top-up Ledger — MySewa Admin" },
      {
        name: "description",
        content:
          "Full NTC and NCELL top-up ledger with merchant transaction IDs, charges, cashback and provider responses.",
      },
      { property: "og:title", content: "Top-up Ledger — MySewa Admin" },
      { property: "og:description", content: "NTC / NCELL transaction oversight for support teams." },
    ],
  }),
  component: TopupsPage,
});

type StatusTab = "all" | TxnStatus;
type OperatorTab = "all" | "1" | "2";

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

const OPERATOR_TABS: { value: OperatorTab; label: string }[] = [
  { value: "all", label: "All operators" },
  { value: "1", label: "NTC" },
  { value: "2", label: "NCELL" },
];

function TopupsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { filters, setFilters, debounced } = useListFilters();
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [operatorTab, setOperatorTab] = useState<OperatorTab>("all");
  const [exporting, setExporting] = useState(false);

  const topupsQuery = useQuery({
    queryKey: ["admin", "topups", debounced, statusTab, operatorTab],
    queryFn: () =>
      apiClient.adminTopups({
        ...debounced,
        status: statusTab,
        productId: operatorTab,
      }),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TxnStatus }) =>
      apiClient.adminUpdateTopupStatus(id, status),
    onSuccess: (_res, vars) => {
      toast.success(`Top-up #${vars.id} marked ${vars.status}`);
      queryClient.invalidateQueries({ queryKey: ["admin", "topups"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Status update failed");
    },
  });

  const topups = topupsQuery.data?.items ?? [];
  const topupStats = topupsQuery.data?.stats;

  const operatorCounts = useMemo(() => {
    const counts: Record<OperatorTab, number> = {
      all: topups.length,
      "1": 0,
      "2": 0,
    };
    for (const t of topups) {
      if (t.product_id === 1 || t.product_id === 2) {
        counts[String(t.product_id) as "1" | "2"] += 1;
      }
    }
    return counts;
  }, [topups]);

  const visible = useMemo(() => topups, [topups]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusTab, number> = {
      all: topupStats?.total ?? 0,
      pending: 0,
      success: 0,
      failed: 0,
    };
    counts.pending = topupStats?.pending ?? 0;
    counts.success = topupStats?.success ?? 0;
    counts.failed = topupStats?.failed ?? 0;
    return counts;
  }, [topupStats]);

  const openTopup = (id: number) => {
    navigate({ to: "/admin/topups/$topupId", params: { topupId: String(id) } });
  };

  const emptyParts: string[] = [];
  if (statusTab !== "all") emptyParts.push(statusTab);
  if (operatorTab !== "all") emptyParts.push(OPERATORS[Number(operatorTab) as 1 | 2]);
  const emptyLabel = emptyParts.join(" ");

  const statusSelect = (id: number, status: TxnStatus) => (
    <Select
      value={status}
      disabled={statusMutation.isPending}
      onValueChange={(value) => {
        if (value === status) return;
        statusMutation.mutate({ id, status: value as TxnStatus });
      }}
    >
      <SelectTrigger className="h-8 w-full min-w-[120px]" aria-label={`Status for top-up ${id}`}>
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
    <AdminShell title="Top-ups" description="NTC & NCELL transaction ledger">
      {topupsQuery.isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">Loading top-ups…</p>
      )}
      {topupsQuery.isError && (
        <p className="mb-4 text-sm text-destructive">
          {topupsQuery.error instanceof ApiError
            ? topupsQuery.error.message
            : "Could not load top-ups."}
        </p>
      )}

      <div className="space-y-4">
        <ListPageToolbar
          stats={topupStats}
          filters={{ ...filters, status: statusTab }}
          onFiltersChange={(next) => {
            if (next.status) setStatusTab(next.status as StatusTab);
            setFilters(next);
          }}
          onExport={async () => {
            setExporting(true);
            try {
              await downloadCsvExport(
                "/api/admin/topups/",
                { ...debounced, status: statusTab },
                "admin-topups.csv",
              );
            } finally {
              setExporting(false);
            }
          }}
          exporting={exporting}
          searchPlaceholder="Search phone, mobile, txn ID…"
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

        <Tabs value={operatorTab} onValueChange={(v) => setOperatorTab(v as OperatorTab)}>
          <TabsList className="h-auto w-full flex-wrap justify-start bg-transparent p-0 sm:w-auto">
            {OPERATOR_TABS.map((op) => (
              <TabsTrigger
                key={op.value}
                value={op.value}
                className="rounded-full border border-transparent px-3 data-[state=active]:border-border data-[state=active]:bg-surface data-[state=active]:shadow-sm"
              >
                {op.label}
                <span className="ml-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {operatorCounts[op.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <AdminDataList
          isEmpty={!topupsQuery.isLoading && visible.length === 0}
          empty={
            <AdminEmptyState>
              No {emptyLabel ? `${emptyLabel} ` : ""}top-ups.
            </AdminEmptyState>
          }
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>User phone</TableHead>
                  <TableHead>Mobile number</TableHead>
                  <TableHead>Operator</TableHead>
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
                {visible.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => openTopup(t.id)}
                  >
                    <TableCell className="text-sm">#{t.id}</TableCell>
                    <TableCell className="text-sm">{t.phone}</TableCell>
                    <TableCell className="text-sm font-medium">{t.mobile_number}</TableCell>
                    <TableCell className="text-sm">
                      {t.product_name || OPERATORS[t.product_id]}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
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
              {visible.map((t) => (
                <AdminMobileCard key={t.id} onClick={() => openTopup(t.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{t.mobile_number}</p>
                      <p className="text-xs text-muted-foreground">
                        #{t.id} · {t.product_name || OPERATORS[t.product_id]}
                      </p>
                    </div>
                    <p className="tabular shrink-0 text-base font-semibold">{formatNPR(t.amount)}</p>
                  </div>
                  <AdminMobileMeta
                    items={[
                      { label: "User", value: t.phone },
                      { label: "Total", value: formatNPR(t.total_debited) },
                      { label: "Charge", value: formatNPR(t.charge) },
                      { label: "Cashback", value: formatNPR(t.cashback) },
                      { label: "Created", value: formatDateTime(t.created_at) },
                      {
                        label: "Txn ID",
                        value: t.merchant_txn_id || "—",
                      },
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
