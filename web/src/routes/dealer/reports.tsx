import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PortalShell } from "@/components/layout/PortalShell";
import { AdminMetricStrip } from "@/components/admin/AdminMetricStrip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { formatNPR } from "@/lib/format";
import { adminLiveQueryOptions } from "@/lib/refresh";
import { useState } from "react";

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "", label: "All time" },
] as const;

export const Route = createFileRoute("/dealer/reports")({
  head: () => ({ meta: [{ title: "Reports — Dealer Portal" }] }),
  component: DealerReportsPage,
});

function DealerReportsPage() {
  const [period, setPeriod] = useState("month");
  const query = useQuery({
    queryKey: ["dealer", "report", period],
    queryFn: () => apiClient.dealerReport({ period }),
    ...adminLiveQueryOptions(),
  });
  const data = query.data;

  return (
    <PortalShell title="Reports" description="Sales, commission, TDS and downline performance">
      <div className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.id || "all"}
            size="sm"
            variant={period === p.id ? "default" : "outline"}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      {query.isError ? (
        <p className="text-sm text-danger">Failed to load report.</p>
      ) : data ? (
        <div className="space-y-4">
          <AdminMetricStrip
            items={[
              { key: "sales", label: "Sales", value: formatNPR(data.sales) },
              { key: "ok", label: "Successful", value: String(data.success_count) },
              { key: "fail", label: "Failed", value: String(data.failed_count) },
              { key: "gross", label: "Gross commission", value: formatNPR(data.gross_commission) },
              { key: "tds", label: "TDS", value: formatNPR(data.tds_amount) },
              { key: "net", label: "Net commission", value: formatNPR(data.net_commission) },
              { key: "wallet", label: "Wallet", value: formatNPR(data.wallet_balance) },
            ]}
          />
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold">Service-wise</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Gross</TableHead>
                  <TableHead>TDS</TableHead>
                  <TableHead>Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.by_service?.map((row) => (
                  <TableRow key={row.txn_type}>
                    <TableCell>{row.txn_type}</TableCell>
                    <TableCell className="tabular">{formatNPR(row.sales ?? "0")}</TableCell>
                    <TableCell className="tabular">
                      {formatNPR(row.gross_commission ?? "0")}
                    </TableCell>
                    <TableCell className="tabular">{formatNPR(row.tds_amount ?? "0")}</TableCell>
                    <TableCell className="tabular">
                      {formatNPR(row.net_commission ?? "0")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.sub_agent_performance?.length ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-semibold">Sub-Agent performance</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sub-Agent</TableHead>
                    <TableHead>Customers</TableHead>
                    <TableHead>Sales</TableHead>
                    <TableHead>Commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sub_agent_performance.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        {row.name || row.phone}
                        <div className="text-xs text-muted-foreground">{row.phone}</div>
                      </TableCell>
                      <TableCell>{row.customer_count}</TableCell>
                      <TableCell className="tabular">{formatNPR(row.sales)}</TableCell>
                      <TableCell className="tabular">{formatNPR(row.commission)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </PortalShell>
  );
}
