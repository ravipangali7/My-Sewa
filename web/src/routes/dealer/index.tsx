import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coins, Users, Wallet, History, Banknote } from "lucide-react";
import { PortalShell } from "@/components/layout/PortalShell";
import { AdminMetricStrip, AdminMetricStripSkeleton } from "@/components/admin/AdminMetricStrip";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { Button } from "@/components/ui/button";
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
import { adminLiveQueryOptions } from "@/lib/refresh";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dealer/")({
  head: () => ({
    meta: [
      { title: "Dealer Dashboard — MySewa" },
      {
        name: "description",
        content: "Dealer portal overview for wallet, sales, commission, customers and sub-agents.",
      },
    ],
  }),
  component: DealerDashboard,
});

function DealerDashboard() {
  const { user } = useAuth();
  const dash = useQuery({
    queryKey: ["dealer", "dashboard"],
    queryFn: () => apiClient.dealerDashboard(),
    ...adminLiveQueryOptions(),
  });
  const data = dash.data;

  const kpis = data
    ? [
        {
          key: "wallet",
          label: "Wallet",
          value: formatNPR(data.wallet_balance),
          icon: Wallet,
          to: "/app",
        },
        {
          key: "sales",
          label: "Today's sales",
          value: formatNPR(data.today_sales),
          icon: Banknote,
        },
        {
          key: "todayComm",
          label: "Today's commission",
          value: formatNPR(data.today_commission),
          icon: Coins,
          to: "/dealer/commission",
        },
        {
          key: "txns",
          label: "Today's transactions",
          value: String(data.today_txn_count),
          icon: History,
          to: "/dealer/transactions",
        },
        {
          key: "customers",
          label: "Customers",
          value: String(data.total_customers),
          icon: Users,
          to: "/dealer/customers",
        },
      ]
    : [];

  return (
    <PortalShell title="Dashboard" description="Your network performance">
      {dash.isLoading ? (
        <AdminMetricStripSkeleton cells={6} />
      ) : dash.isError ? (
        <p className="text-sm text-danger">Failed to load dashboard.</p>
      ) : (
        <div className="space-y-4">
          <AdminMetricStrip items={kpis} />
          <div className="flex flex-wrap gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Button asChild size="sm">
              <Link to="/dealer/customers">Customers</Link>
            </Button>
            {user?.role === "dealer" ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/dealer/push-balance">Push Balance</Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link to="/app/services">Services</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/app/transfer">Fund transfer</Link>
            </Button>
          </div>
          <AdminDataList
            isEmpty={!dash.isLoading && (data?.recent_commissions ?? []).length === 0}
            empty={<AdminEmptyState>No commission recorded yet.</AdminEmptyState>}
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Net / share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.recent_commissions ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatDateTime(row.created_at)}</TableCell>
                      <TableCell>{row.txn_type_display || row.txn_type}</TableCell>
                      <TableCell className="tabular">{formatNPR(row.txn_amount)}</TableCell>
                      <TableCell className="tabular">
                        {formatNPR(row.net_commission)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
            mobile={
              <AdminMobileCardGrid>
                {(data?.recent_commissions ?? []).map((row) => (
                  <AdminMobileCard key={row.id}>
                    <p className="text-sm font-semibold">{row.txn_type_display || row.txn_type}</p>
                    <AdminMobileMeta
                      items={[
                        { label: "Amount", value: formatNPR(row.txn_amount) },
                        { label: "When", value: formatDateTime(row.created_at) },
                      ]}
                    />
                  </AdminMobileCard>
                ))}
              </AdminMobileCardGrid>
            }
          />
        </div>
      )}
    </PortalShell>
  );
}
