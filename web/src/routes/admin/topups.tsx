import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/layout/AdminShell";
import { StatusChip } from "@/components/StatusChip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api";
import { OPERATORS } from "@/lib/constants";
import { formatNPR, formatDateTime } from "@/lib/format";

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

function TopupsPage() {
  const topupsQuery = useQuery({
    queryKey: ["admin", "topups"],
    queryFn: () => apiClient.adminTopups(),
  });

  const topups = topupsQuery.data ?? [];

  return (
    <AdminShell title="Top-ups" description="NTC & NCELL transaction ledger">
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
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
            {topups.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-sm">{t.id}</TableCell>
                <TableCell className="text-sm">{t.phone}</TableCell>
                <TableCell className="text-sm font-medium">{t.mobile_number}</TableCell>
                <TableCell className="text-sm">
                  {t.product_name || OPERATORS[t.product_id]}
                </TableCell>
                <TableCell className="tabular text-right text-sm">{formatNPR(t.amount)}</TableCell>
                <TableCell className="tabular text-right text-sm">{formatNPR(t.charge)}</TableCell>
                <TableCell className="tabular text-right text-sm">{formatNPR(t.cashback)}</TableCell>
                <TableCell className="tabular text-right text-sm">
                  {formatNPR(t.total_debited)}
                </TableCell>
                <TableCell className="text-sm">{t.merchant_txn_id}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {t.service_hub_txn_id ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusChip status={t.status} compact />
                </TableCell>
                <TableCell className="text-sm">{formatDateTime(t.created_at)}</TableCell>
              </TableRow>
            ))}
            {!topupsQuery.isLoading && topups.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                  No top-ups yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AdminShell>
  );
}
