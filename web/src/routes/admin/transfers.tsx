import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/layout/AdminShell";
import { StatusChip } from "@/components/StatusChip";
import { Badge } from "@/components/ui/badge";
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

function TransfersPage() {
  const transfersQuery = useQuery({
    queryKey: ["admin", "transfers"],
    queryFn: () => apiClient.adminTransfers(),
  });

  const bankTransfers = transfersQuery.data ?? [];

  return (
    <AdminShell title="Bank transfers" description="Outbound transfer ledger">
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
                  <StatusChip status={b.status} compact />
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
