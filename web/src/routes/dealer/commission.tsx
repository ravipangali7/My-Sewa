import { createFileRoute } from "@tanstack/react-router";
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
import { StatsCards } from "@/components/admin/StatsCards";
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
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dealer/commission")({
  head: () => ({ meta: [{ title: "Commission — Dealer Portal" }] }),
  component: DealerCommissionPage,
});

function DealerCommissionPage() {
  const { user } = useAuth();
  const isSub = user?.role === "sub_agent";
  const { filters, setFilters, debounced } = useListFilters();
  const query = useQuery({
    queryKey: ["dealer", "commissions", debounced],
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
  const earnings = query.data?.earnings;

  return (
    <PortalShell title="Commission" description="Gross, TDS and net commission for your network">
      {earnings ? (
        <div className="mb-4">
          <StatsCards
            items={
              isSub
                ? [
                    {
                      key: "share",
                      label: "Your commission",
                      value: formatNPR(earnings.sub_agent_commission ?? 0),
                    },
                    { key: "sales", label: "Sales", value: formatNPR(earnings.sales ?? 0) },
                  ]
                : [
                    {
                      key: "gross",
                      label: "Gross",
                      value: formatNPR(earnings.gross_commission ?? 0),
                    },
                    { key: "tds", label: "TDS", value: formatNPR(earnings.tds_amount ?? 0) },
                    { key: "net", label: "Net", value: formatNPR(earnings.net_commission ?? 0) },
                    {
                      key: "sub",
                      label: "Sub-Agent share",
                      value: formatNPR(earnings.sub_agent_commission ?? 0),
                    },
                  ]
            }
          />
        </div>
      ) : null}
      <ListPageToolbar
        filters={filters}
        onFiltersChange={setFilters}
        searchPlaceholder="Search phone or reference"
      />
      <AdminDataList
        isEmpty={!query.isLoading && items.length === 0}
        empty={<AdminEmptyState>No commission rows yet.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Gross</TableHead>
                <TableHead>TDS</TableHead>
                <TableHead>Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDateTime(row.created_at)}</TableCell>
                  <TableCell>{row.source_phone || "—"}</TableCell>
                  <TableCell>{row.txn_type_display || row.txn_type}</TableCell>
                  <TableCell className="tabular">{formatNPR(row.txn_amount)}</TableCell>
                  <TableCell className="tabular">{formatNPR(row.gross_commission)}</TableCell>
                  <TableCell className="tabular">{formatNPR(row.tds_amount)}</TableCell>
                  <TableCell className="tabular">{formatNPR(row.net_commission)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {items.map((row) => (
              <AdminMobileCard key={row.id}>
                <p className="text-sm font-semibold">{row.txn_type_display || row.txn_type}</p>
                <AdminMobileMeta
                  items={[
                    { label: "Net", value: formatNPR(row.net_commission) },
                    { label: "When", value: formatDateTime(row.created_at) },
                    { label: "Customer", value: row.source_phone || "—" },
                    { label: "Amount", value: formatNPR(row.txn_amount) },
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
