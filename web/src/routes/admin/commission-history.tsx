import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Banknote, CalendarDays, Coins, Handshake } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { ListPageToolbar } from "@/components/list/ListPageToolbar";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { StatsCards } from "@/components/admin/StatsCards";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
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
import { formatDateTime, formatNPR } from "@/lib/format";
import { serialNumber } from "@/lib/serial";
import { downloadCsvExport } from "@/lib/list-query";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import type { CommissionHistoryItem, DealerCommissionItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const LIST_PAGE = 1;
const LIST_PAGE_SIZE = 50;

export const Route = createFileRoute("/admin/commission-history")({
  head: () => ({
    meta: [
      { title: "Commission History — MySewa Admin" },
      {
        name: "description",
        content:
          "History of charges collected on bank transfers and MySewa commission earned from each transaction.",
      },
      { property: "og:title", content: "Commission History — MySewa Admin" },
    ],
  }),
  component: CommissionHistoryPage,
});

function displayUser(row: CommissionHistoryItem) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return name || row.phone;
}

function destinationLabel(row: CommissionHistoryItem) {
  const bank = row.destination_bank_name || row.destination_bank || "Bank";
  return `${bank} · ${row.destination_acc_no}`;
}

function CommissionHistoryPage() {
  const { filters, setFilters, debounced } = useListFilters();
  const [exporting, setExporting] = useState(false);

  const historyQuery = useQuery({
    queryKey: ["admin", "commission-history", debounced],
    queryFn: () => apiClient.adminCommissionHistory(debounced),
    ...adminLiveQueryOptions(),
  });
  const dealerQuery = useQuery({
    queryKey: ["admin", "dealer-commissions", debounced],
    queryFn: () => apiClient.adminDealerCommissions(debounced),
    ...adminLiveQueryOptions(),
  });

  const items = historyQuery.data?.items ?? [];
  const stats = historyQuery.data?.stats;
  const earnings = historyQuery.data?.earnings;
  const rangeHint =
    filters.startDate || filters.endDate
      ? "in selected range"
      : "all successful transfers";

  return (
    <AdminShell
      title="Commission History"
      description="Charges collected when funds move from a MySewa wallet to a bank account, and commission earned on each transfer."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/transfers">
            <Banknote className="mr-1.5 size-3.5" />
            Bank transfers
          </Link>
        </Button>
      }
    >
      {historyQuery.isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">Loading commission history…</p>
      )}
      {historyQuery.isError && (
        <p className="mb-4 text-sm text-destructive">
          {historyQuery.error instanceof ApiError
            ? historyQuery.error.message
            : "Could not load commission history."}
        </p>
      )}

      <div className="mb-4 space-y-4">
        <StatsCards
          items={[
            {
              key: "total",
              label: "Total earnings",
              value: formatNPR(earnings?.total_earnings ?? 0),
              hint: `${earnings?.earning_count ?? 0} commission-paying transfer${
                (earnings?.earning_count ?? 0) === 1 ? "" : "s"
              } · ${rangeHint}`,
              icon: Coins,
              tone: "credit",
            },
            {
              key: "today",
              label: "Today's earnings",
              value: formatNPR(earnings?.today_earnings ?? 0),
              hint: "Successful transfers today",
              icon: CalendarDays,
              tone: "info",
            },
            {
              key: "month",
              label: "This month",
              value: formatNPR(earnings?.monthly_earnings ?? 0),
              hint: "Successful transfers this calendar month",
              icon: CalendarDays,
              tone: "brand",
            },
            {
              key: "charges",
              label: "Charges collected",
              value: formatNPR(earnings?.total_charges ?? 0),
              hint: `Platform ${formatNPR(earnings?.total_earnings ?? 0)} · Provider ${formatNPR(
                earnings?.total_provider_charges ?? 0,
              )}`,
              icon: Handshake,
              tone: "debit",
            },
          ]}
        />

        <ListPageToolbar
          stats={stats}
          filters={filters}
          onFiltersChange={setFilters}
          onExport={async () => {
            setExporting(true);
            try {
              await downloadCsvExport(
                "/api/admin/commission-history/",
                debounced,
                "admin-commission-history.csv",
              );
            } finally {
              setExporting(false);
            }
          }}
          exporting={exporting}
          searchPlaceholder="Search phone, name, account, txn ID…"
          exportLabel="Download CSV"
          statsLabels={{
            total: "Transfers",
            success: "Success",
            pending: "Pending",
            failed: "Failed",
          }}
          statusOptions={[...TXN_STATUS_OPTIONS]}
        />
      </div>

      <AdminDataList
        isEmpty={!historyQuery.isLoading && items.length === 0}
        empty={
          <AdminEmptyState>
            No transfer charges in this range. Commission appears when a bank transfer
            collects a platform fee.
          </AdminEmptyState>
        }
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pr-0">S.N.</TableHead>
                <TableHead>When</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Provider charge</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Earned</TableHead>
                <TableHead className="text-right">Total charge</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row, index) => {
                const earned = Number(row.earned) > 0;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="w-10 pr-0 tabular text-sm text-muted-foreground">
                      {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}
                    </TableCell>
                    <TableCell className="text-sm">{formatDateTime(row.created_at)}</TableCell>
                    <TableCell>
                      <Link
                        to="/admin/users/$userId"
                        params={{ userId: String(row.user_id) }}
                        className="font-medium text-foreground hover:underline"
                      >
                        {displayUser(row)}
                      </Link>
                      <div className="text-xs text-muted-foreground">{row.phone}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{row.destination_acc_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{destinationLabel(row)}</div>
                    </TableCell>
                    <TableCell className="tabular text-right text-sm font-semibold">
                      {formatNPR(row.amount)}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {formatNPR(row.provider_charge)}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm font-semibold text-brand-dark">
                      {formatNPR(row.commission)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular text-right text-sm font-semibold",
                        earned ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {earned ? formatNPR(row.earned) : "—"}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {formatNPR(row.charge)}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={row.status} compact />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {items.map((row, index) => {
              const earned = Number(row.earned) > 0;
              return (
                <AdminMobileCard key={row.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="tabular shrink-0 pt-0.5 text-xs text-muted-foreground">
                        {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}.
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{displayUser(row)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          → {row.destination_acc_name || destinationLabel(row)}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-base font-semibold text-brand-dark">
                        {formatNPR(row.commission)}
                      </p>
                      <StatusChip status={row.status} compact className="mt-1" />
                    </div>
                  </div>
                  <AdminMobileMeta
                    items={[
                      { label: "Amount", value: formatNPR(row.amount) },
                      { label: "To", value: destinationLabel(row) },
                      { label: "Provider charge", value: formatNPR(row.provider_charge) },
                      {
                        label: "Earned",
                        value: earned ? formatNPR(row.earned) : "Not earned",
                      },
                      { label: "Total charge", value: formatNPR(row.charge) },
                      { label: "When", value: formatDateTime(row.created_at) },
                    ]}
                  />
                </AdminMobileCard>
              );
            })}
          </AdminMobileCardGrid>
        }
      />
      <div className="mt-8 space-y-4">
        <h2 className="text-base font-semibold">Dealer commission & TDS</h2>
        <p className="text-sm text-muted-foreground">
          Gross commission, TDS, and net payable for each customer transaction mapped to a Dealer.
        </p>
        <StatsCards
          items={[
            {
              key: "gross",
              label: "Gross commission",
              value: formatNPR(dealerQuery.data?.earnings?.gross_commission ?? 0),
              icon: Coins,
              tone: "brand",
            },
            {
              key: "tds",
              label: "TDS deducted",
              value: formatNPR(dealerQuery.data?.earnings?.tds_amount ?? 0),
              icon: Handshake,
              tone: "debit",
            },
            {
              key: "net",
              label: "Net payable",
              value: formatNPR(dealerQuery.data?.earnings?.net_commission ?? 0),
              icon: Coins,
              tone: "credit",
            },
          ]}
        />
        <AdminDataList
          isEmpty={!dealerQuery.isLoading && (dealerQuery.data?.items ?? []).length === 0}
          empty={<AdminEmptyState>No dealer commissions yet.</AdminEmptyState>}
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">S.N.</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Dealer</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">TDS</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(dealerQuery.data?.items ?? []).map((row: DealerCommissionItem, index) => (
                  <TableRow key={row.id}>
                    <TableCell className="w-10 pr-0 tabular text-sm text-muted-foreground">
                      {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}
                    </TableCell>
                    <TableCell className="text-sm">{formatDateTime(row.created_at)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{row.dealer_name || row.dealer_phone}</div>
                      <div className="text-xs text-muted-foreground">{row.dealer_phone}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{row.source_name || row.source_phone || "—"}</div>
                      <div className="text-xs text-muted-foreground">{row.source_phone || "—"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{row.txn_type_display}</div>
                      <div className="text-xs text-muted-foreground">
                        #{row.txn_id} {row.reference}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">{formatNPR(row.txn_amount)}</TableCell>
                    <TableCell className="tabular text-right">{row.commission_rate}%</TableCell>
                    <TableCell className="tabular text-right">{formatNPR(row.gross_commission)}</TableCell>
                    <TableCell className="tabular text-right">
                      {formatNPR(row.tds_amount)} ({row.tds_rate}%)
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      {formatNPR(row.net_commission)}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={row.status === "posted" ? "success" : "failed"} compact />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        />
      </div>
    </AdminShell>
  );
}
