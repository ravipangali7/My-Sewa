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
import { Badge } from "@/components/ui/badge";
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
import type { TxnStatus } from "@/lib/types";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";

export const Route = createFileRoute("/admin/transfers")({
  head: () => ({
    meta: [
      { title: "Bank Transfer Ledger — MySewa Admin" },
      {
        name: "description",
        content:
          "Outbound bank transfer ledger: destination bank, account verification, charges, total debited and provider transaction IDs.",
      },
      { property: "og:title", content: "Bank Transfer Ledger — MySewa Admin" },
      {
        property: "og:description",
        content: "Oversight of every outbound transfer from MySewa wallets.",
      },
    ],
  }),
  component: TransfersPage,
});

const STATUS_OPTIONS: { value: TxnStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
];

function TransfersPage() {
  const queryClient = useQueryClient();
  const { filters, setFilters, debounced } = useListFilters();
  const [exporting, setExporting] = useState(false);

  const transfersQuery = useQuery({
    queryKey: ["admin", "transfers", debounced],
    queryFn: () => apiClient.adminTransfers(debounced),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TxnStatus }) =>
      apiClient.adminUpdateTransferStatus(id, status),
    onSuccess: (_res, vars) => {
      toast.success(`Transfer #${vars.id} marked ${vars.status}`);
      queryClient.invalidateQueries({ queryKey: ["admin", "transfers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Status update failed");
    },
  });

  const bankTransfers = transfersQuery.data?.items ?? [];
  const transferStats = transfersQuery.data?.stats;

  const statusSelect = (id: number, status: TxnStatus) => (
    <Select
      value={status}
      disabled={statusMutation.isPending}
      onValueChange={(value) => {
        if (value === status) return;
        statusMutation.mutate({ id, status: value as TxnStatus });
      }}
    >
      <SelectTrigger className="h-8 w-full min-w-[120px]" aria-label={`Status for transfer ${id}`}>
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
    <AdminShell title="Bank transfers" description="Outbound transfer ledger">
      {transfersQuery.isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">Loading transfers…</p>
      )}
      {transfersQuery.isError && (
        <p className="mb-4 text-sm text-destructive">
          {transfersQuery.error instanceof ApiError
            ? transfersQuery.error.message
            : "Could not load transfers."}
        </p>
      )}

      <div className="mb-4 space-y-4">
        <ListPageToolbar
          stats={transferStats}
          filters={filters}
          onFiltersChange={setFilters}
          onExport={async () => {
            setExporting(true);
            try {
              await downloadCsvExport("/api/admin/transfers/", debounced, "admin-transfers.csv");
            } finally {
              setExporting(false);
            }
          }}
          exporting={exporting}
          searchPlaceholder="Search phone, account, txn ID…"
          exportLabel="Download CSV"
          statsLabels={{
            total: "Total",
            success: "Success",
            pending: "Pending",
            failed: "Failed",
          }}
          statusOptions={[...TXN_STATUS_OPTIONS]}
        />
      </div>

      <AdminDataList
        isEmpty={!transfersQuery.isLoading && bankTransfers.length === 0}
        empty={<AdminEmptyState>No transfers yet.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>User phone</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Destination bank</TableHead>
                <TableHead>Account no.</TableHead>
                <TableHead>Account name</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead className="text-right">Charge</TableHead>
                <TableHead className="text-right">Total debited</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Merchant txn ID</TableHead>
                <TableHead>Provider txn ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created at</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankTransfers.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-sm">{b.id}</TableCell>
                  <TableCell className="text-sm">{b.phone}</TableCell>
                  <TableCell className="tabular text-right text-sm">{formatNPR(b.amount)}</TableCell>
                  <TableCell className="text-sm">
                    {b.destination_bank_name}
                    <span className="block text-xs text-muted-foreground">{b.destination_bank}</span>
                  </TableCell>
                  <TableCell className="text-sm">{b.destination_acc_no}</TableCell>
                  <TableCell className="text-sm font-medium">{b.destination_acc_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {b.transaction_remarks}
                    {b.transaction_remarks_2 ? ` · ${b.transaction_remarks_2}` : ""}
                  </TableCell>
                  <TableCell className="tabular text-right text-sm">{formatNPR(b.charge)}</TableCell>
                  <TableCell className="tabular text-right text-sm">
                    {formatNPR(b.total_debited)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={b.verified ? "default" : "secondary"}>
                      {b.verified ? "Verified" : "Unverified"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{b.merchant_txn_id}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {b.provider_txn_id ?? "—"}
                  </TableCell>
                  <TableCell>{statusSelect(b.id, b.status)}</TableCell>
                  <TableCell className="text-sm">{formatDateTime(b.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {bankTransfers.map((b) => (
              <AdminMobileCard key={b.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{b.destination_acc_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.destination_bank_name} · #{b.id}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-base font-semibold">{formatNPR(b.amount)}</p>
                    <Badge variant={b.verified ? "default" : "secondary"} className="mt-1">
                      {b.verified ? "Verified" : "Unverified"}
                    </Badge>
                  </div>
                </div>
                <AdminMobileMeta
                  items={[
                    { label: "User", value: b.phone },
                    { label: "Account", value: b.destination_acc_no },
                    { label: "Debited", value: formatNPR(b.total_debited) },
                    { label: "Charge", value: formatNPR(b.charge) },
                    { label: "Created", value: formatDateTime(b.created_at) },
                    {
                      label: "Remarks",
                      value:
                        [b.transaction_remarks, b.transaction_remarks_2].filter(Boolean).join(" · ") ||
                        "—",
                    },
                  ]}
                />
                <div className="mt-3 border-t border-border pt-3">{statusSelect(b.id, b.status)}</div>
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />
    </AdminShell>
  );
}
