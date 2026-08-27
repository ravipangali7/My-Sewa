import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/layout/PortalShell";
import { ListPageToolbar } from "@/components/list/ListPageToolbar";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
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
import { adminLiveQueryOptions } from "@/lib/refresh";
import { useListFilters } from "@/hooks/use-list-filters";

export const Route = createFileRoute("/dealer/transactions")({
  head: () => ({ meta: [{ title: "Transactions — Dealer Portal" }] }),
  component: DealerTransactionsPage,
});

function DealerTransactionsPage() {
  const { filters, setFilters, debounced } = useListFilters();
  const query = useQuery({
    queryKey: ["dealer", "transactions", debounced],
    queryFn: () =>
      apiClient.dealerCommissions({
        q: debounced.q,
        startDate: debounced.startDate,
        endDate: debounced.endDate,
        status: debounced.status,
      }),
    ...adminLiveQueryOptions(),
  });
  const items = query.data?.items ?? [];

  return (
    <PortalShell
      title="Transactions"
      description="Network transactions that generated commission"
      actions={
        <Link to="/app/history" className="text-sm text-brand">
          Open wallet history
        </Link>
      }
    >
      <ListPageToolbar filters={filters} onFiltersChange={setFilters} />
      <AdminDataList
        isEmpty={!query.isLoading && items.length === 0}
        empty={<AdminEmptyState>No transactions yet.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Sub-Agent</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDateTime(row.created_at)}</TableCell>
                  <TableCell>{row.source_phone || "—"}</TableCell>
                  <TableCell>{row.sub_agent_phone || "—"}</TableCell>
                  <TableCell>{row.txn_type_display || row.txn_type}</TableCell>
                  <TableCell className="tabular">{formatNPR(row.txn_amount)}</TableCell>
                  <TableCell>{row.status_display || row.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {items.map((row) => (
              <AdminMobileCard key={row.id}>
                <p className="text-sm font-semibold">{row.source_phone || row.reference}</p>
                <AdminMobileMeta
                  items={[
                    { label: "Amount", value: formatNPR(row.txn_amount) },
                    { label: "Service", value: row.txn_type_display || row.txn_type },
                    { label: "When", value: formatDateTime(row.created_at) },
                    { label: "Status", value: row.status_display || row.status },
                  ]}
                />
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />
    </PortalShell>
  );
}
