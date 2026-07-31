import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShell } from "@/components/layout/AdminShell";
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
  const transfersQuery = useQuery({
    queryKey: ["admin", "transfers"],
    queryFn: () => apiClient.adminTransfers(),
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

  const bankTransfers = transfersQuery.data ?? [];

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

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
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
                <TableCell>
                  <Select
                    value={b.status}
                    disabled={statusMutation.isPending}
                    onValueChange={(value) => {
                      if (value === b.status) return;
                      statusMutation.mutate({ id: b.id, status: value as TxnStatus });
                    }}
                  >
                    <SelectTrigger className="h-8 w-[120px]" aria-label={`Status for transfer ${b.id}`}>
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
                </TableCell>
                <TableCell className="text-sm">{formatDateTime(b.created_at)}</TableCell>
              </TableRow>
            ))}
            {!transfersQuery.isLoading && bankTransfers.length === 0 && (
              <TableRow>
                <TableCell colSpan={14} className="py-10 text-center text-sm text-muted-foreground">
                  No transfers yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AdminShell>
  );
}
