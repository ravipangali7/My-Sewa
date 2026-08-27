import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { AdminMetricStrip } from "@/components/admin/AdminMetricStrip";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api";
import { formatNPR } from "@/lib/format";
import { adminLiveQueryOptions } from "@/lib/refresh";

export const Route = createFileRoute("/admin/dealer-profit")({
  head: () => ({
    meta: [
      { title: "Dealer Profit — MySewa Admin" },
      {
        name: "description",
        content: "Dealer-wise sales, commission, TDS and Super Admin profit.",
      },
    ],
  }),
  component: DealerProfitPage,
});

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
  { id: "", label: "All time" },
];

const SERVICES = [
  { id: "", label: "All services" },
  { id: "topup", label: "Top-up" },
  { id: "data_pack", label: "Data pack" },
  { id: "internet", label: "Internet" },
  { id: "water", label: "Water" },
  { id: "electricity", label: "Electricity" },
  { id: "community_electricity", label: "Community electricity" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "remittance", label: "Remittance" },
];

function DealerProfitPage() {
  const [period, setPeriod] = useState("month");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dealerId, setDealerId] = useState("");
  const [subAgentId, setSubAgentId] = useState("");
  const [txnType, setTxnType] = useState("");
  const [status, setStatus] = useState("posted");
  const dealersQuery = useQuery({
    queryKey: ["admin", "users", "dealers"],
    queryFn: () => apiClient.adminUsers({ role: "dealer" }),
  });
  const subAgentsQuery = useQuery({
    queryKey: ["admin", "users", "sub-agents", dealerId],
    queryFn: () =>
      apiClient.adminUsers({
        role: "sub_agent",
        ...(dealerId ? { dealer_id: dealerId } : {}),
      }),
  });
  const query = useQuery({
    queryKey: [
      "admin",
      "dealer-profit",
      period,
      startDate,
      endDate,
      dealerId,
      subAgentId,
      txnType,
      status,
    ],
    queryFn: () => {
      const filters: {
        period?: string;
        startDate?: string;
        endDate?: string;
        dealer_id?: string;
        sub_agent_id?: string;
        txn_type?: string;
        status: string;
      } = { status };
      if (period !== "custom") filters.period = period;
      if (period === "custom" && startDate) filters.startDate = startDate;
      if (period === "custom" && endDate) filters.endDate = endDate;
      if (dealerId) filters.dealer_id = dealerId;
      if (subAgentId) filters.sub_agent_id = subAgentId;
      if (txnType) filters.txn_type = txnType;
      return apiClient.adminDealerProfit(filters);
    },
    ...adminLiveQueryOptions(),
  });
  const items = query.data?.items ?? [];
  const totals = query.data?.totals;
  const dealers = dealersQuery.data?.items ?? [];
  const subAgents = subAgentsQuery.data?.items ?? [];

  return (
    <AdminShell
      title="Dealer profit"
      description="Sales, commission, TDS and Super Admin profit by Dealer"
      dense
    >
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-2">
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
        {period === "custom" ? (
          <div className="flex flex-wrap gap-2">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-auto"
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-auto"
            />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={dealerId}
            onChange={(e) => {
              setDealerId(e.target.value);
              setSubAgentId("");
            }}
          >
            <option value="">All dealers</option>
            {dealers.map((d) => (
              <option key={d.id} value={String(d.id)}>
                {d.phone}
                {d.first_name || d.last_name
                  ? ` — ${[d.first_name, d.last_name].filter(Boolean).join(" ")}`
                  : ""}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={subAgentId}
            onChange={(e) => setSubAgentId(e.target.value)}
          >
            <option value="">All sub-agents</option>
            {subAgents.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.phone}
                {s.first_name || s.last_name
                  ? ` — ${[s.first_name, s.last_name].filter(Boolean).join(" ")}`
                  : ""}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={txnType}
            onChange={(e) => setTxnType(e.target.value)}
          >
            {SERVICES.map((s) => (
              <option key={s.id || "all"} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="posted">Successful / posted</option>
            <option value="reversed">Reversed</option>
            <option value="all">All statuses</option>
          </select>
        </div>
      </div>
      {totals ? (
        <div className="mb-4">
          <AdminMetricStrip
            items={[
              { key: "sales", label: "Sales", value: formatNPR(totals["sales"] ?? "0") },
              {
                key: "gross",
                label: "Commission",
                value: formatNPR(totals["gross_commission"] ?? "0"),
              },
              { key: "tds", label: "TDS", value: formatNPR(totals["tds_amount"] ?? "0") },
              { key: "net", label: "Net", value: formatNPR(totals["net_commission"] ?? "0") },
              {
                key: "profit",
                label: "Super Admin profit",
                value: formatNPR(totals["super_admin_profit"] ?? "0"),
              },
            ]}
          />
        </div>
      ) : null}
      <AdminDataList
        isEmpty={!query.isLoading && items.length === 0}
        empty={<AdminEmptyState>No dealer profit data for this period.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dealer</TableHead>
                <TableHead>Sales</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>TDS</TableHead>
                <TableHead>Net</TableHead>
                <TableHead>Super Admin profit</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{row.name || row.phone}</div>
                    <div className="text-xs text-muted-foreground">{row.phone}</div>
                  </TableCell>
                  <TableCell className="tabular">{formatNPR(row.sales)}</TableCell>
                  <TableCell className="tabular">{formatNPR(row.gross_commission)}</TableCell>
                  <TableCell className="tabular">{formatNPR(row.tds_amount)}</TableCell>
                  <TableCell className="tabular">{formatNPR(row.net_commission)}</TableCell>
                  <TableCell className="tabular">{formatNPR(row.super_admin_profit)}</TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/admin/users/$userId/report" params={{ userId: String(row.id) }}>
                        Report
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {items.map((row) => (
              <AdminMobileCard key={row.id}>
                <p className="text-sm font-semibold">{row.name || row.phone}</p>
                <AdminMobileMeta
                  items={[
                    { label: "Sales", value: formatNPR(row.sales) },
                    { label: "Profit", value: formatNPR(row.super_admin_profit) },
                  ]}
                />
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />
    </AdminShell>
  );
}
