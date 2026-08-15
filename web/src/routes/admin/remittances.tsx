import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { adminLiveQueryOptions } from "@/lib/refresh";
import { formatNPR, formatDateTime } from "@/lib/format";
import { serialNumber } from "@/lib/serial";
import type { TxnStatus } from "@/lib/types";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";

const LIST_PAGE = 1;
const LIST_PAGE_SIZE = 50;

export const Route = createFileRoute("/admin/remittances")({
  head: () => ({
    meta: [
      { title: "Remittance Ledger — MySewa Admin" },
      {
        name: "description",
        content:
          "Samsara remittance payout ledger with reference numbers, beneficiary details and wallet credits.",
      },
      { property: "og:title", content: "Remittance Ledger — MySewa Admin" },
      {
        property: "og:description",
        content: "Inbound remittance oversight for MySewa operations.",
      },
    ],
  }),
  component: RemittancesPage,
});

const STATUS_OPTIONS: { value: TxnStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

function RemittancesPage() {
  const queryClient = useQueryClient();
  const { filters, setFilters, debounced } = useListFilters();
  const [exporting, setExporting] = useState(false);

  const remittancesQuery = useQuery({
    queryKey: ["admin", "remittances", debounced],
    queryFn: () => apiClient.adminRemittances(debounced),
    ...adminLiveQueryOptions(),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TxnStatus }) =>
      apiClient.adminUpdateRemittanceStatus(id, status),
    onSuccess: (_res, vars) => {
      toast.success(`Remittance #${vars.id} marked ${vars.status}`);
      queryClient.invalidateQueries({ queryKey: ["admin", "remittances"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Status update failed");
    },
  });

  const remittances = remittancesQuery.data?.items ?? [];
  const remittanceStats = remittancesQuery.data?.stats;
  const filtered = remittances;
  const amountCards = amountSummaryCards(remittancesQuery.data?.summary, {
    keys: ["total_volume", "total_credit", "total_amount", "today_amount", "monthly_amount"],
    labels: {
      total_credit: "Total credit (success)",
      total_amount: "Successful amount",
    },
  });

  const statusSelect = (id: number, status: TxnStatus) => (
    <Select
      value={status}
      disabled={statusMutation.isPending}
      onValueChange={(value) => {
        if (value === status) return;
        statusMutation.mutate({ id, status: value as TxnStatus });
      }}
    >
      <SelectTrigger className="h-8 w-full min-w-[120px]" aria-label={`Status for remittance ${id}`}>
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
    <AdminShell title="Remittances" description="Samsara inbound remittance payouts">
      <div className="space-y-4">
        {remittancesQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Loading remittances…</p>
        )}
        {remittancesQuery.isError && (
          <p className="text-sm text-destructive">
            {remittancesQuery.error instanceof ApiError
              ? remittancesQuery.error.message
              : "Could not load remittances."}
          </p>
        )}

        <StatsCards items={amountCards} />
        <ListPageToolbar
          stats={remittanceStats}
          filters={filters}
          onFiltersChange={setFilters}
          onExport={async () => {
            setExporting(true);
            try {
              await downloadCsvExport("/api/admin/remittances/", debounced, "admin-remittances.csv");
            } finally {
              setExporting(false);
            }
          }}
          exporting={exporting}
          searchPlaceholder="Search phone, ref no, sender…"
          exportLabel="Download CSV"
          statsLabels={{
            total: "Total",
            success: "Success",
            pending: "Pending",
            failed: "Failed",
          }}
          statusOptions={[...TXN_STATUS_OPTIONS]}
        />

        <AdminDataList
          isEmpty={!remittancesQuery.isLoading && filtered.length === 0}
          empty={<AdminEmptyState>No remittances found.</AdminEmptyState>}
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">S.N.</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Credited</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r, index) => (
                  <TableRow key={r.id}>
                    <TableCell className="w-10 pr-0 tabular text-sm text-muted-foreground">
                      {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}
                    </TableCell>
                    <TableCell className="text-sm">#{r.id}</TableCell>
                    <TableCell className="text-sm">{r.phone}</TableCell>
                    <TableCell className="font-mono text-xs">{r.ref_no}</TableCell>
                    <TableCell className="text-sm">{r.sender_name || "—"}</TableCell>
                    <TableCell className="tabular text-right text-sm font-semibold">
                      {formatNPR(r.amount)}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {formatNPR(r.total_credited || r.amount)}
                    </TableCell>
                    <TableCell>{statusSelect(r.id, r.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(r.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
          mobile={
            <AdminMobileCardGrid>
              {filtered.map((r, index) => (
                <AdminMobileCard key={r.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="tabular shrink-0 pt-0.5 text-xs text-muted-foreground">
                        {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}.
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium">{r.ref_no}</p>
                        <p className="text-xs text-muted-foreground">
                          #{r.id} · {r.phone}
                        </p>
                      </div>
                    </div>
                    <p className="tabular shrink-0 text-base font-semibold">
                      {formatNPR(r.amount)}
                    </p>
                  </div>
                  <AdminMobileMeta
                    items={[
                      {
                        label: "Credited",
                        value: formatNPR(r.total_credited || r.amount),
                      },
                      { label: "Sender", value: r.sender_name || "—" },
                      { label: "Receiver", value: r.receiver_name || "—" },
                      { label: "When", value: formatDateTime(r.created_at) },
                    ]}
                  />
                  <div className="mt-3">{statusSelect(r.id, r.status)}</div>
                </AdminMobileCard>
              ))}
            </AdminMobileCardGrid>
          }
        />
      </div>
    </AdminShell>
  );
}
