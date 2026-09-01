import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { ListPageToolbar } from "@/components/list/ListPageToolbar";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { StatsCards, amountSummaryCards } from "@/components/admin/StatsCards";
import { StatusChip } from "@/components/StatusChip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { formatDateTime, formatNPR, sortByLatestFirst } from "@/lib/format";
import { serialNumber } from "@/lib/serial";
import { downloadCsvWithQuery } from "@/lib/list-query";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import type { ActivityKind, AdminSystemTransaction } from "@/lib/types";
import { cn } from "@/lib/utils";

const LIST_PAGE = 1;
const LIST_PAGE_SIZE = 50;

export const Route = createFileRoute("/admin/transaction-history")({
  head: () => ({
    meta: [
      { title: "Transaction History — MySewa Admin" },
      {
        name: "description",
        content:
          "System-wide ledger of every MySewa wallet transaction with before and after balances, type, user, amount, status and reference.",
      },
      { property: "og:title", content: "Transaction History — MySewa Admin" },
    ],
  }),
  component: TransactionHistoryPage,
});

type TypeTab = "all" | ActivityKind;

const TYPE_TABS: { value: TypeTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "deposit", label: "Deposits" },
  { value: "remittance", label: "Remittances" },
  { value: "topup", label: "Top-ups" },
  { value: "transfer", label: "Transfers" },
  { value: "internet", label: "Internet" },
  { value: "data_pack", label: "Data packs" },
  { value: "water", label: "Water" },
  { value: "electricity", label: "Electricity" },
  { value: "community_electricity", label: "Community electricity" },
  { value: "wallet_adjustment", label: "Wallet adjustments" },
  { value: "wallet_transfer", label: "Wallet transfers" },
];

const TYPE_LABELS: Record<ActivityKind, string> = {
  deposit: "Deposit",
  remittance: "Remittance",
  topup: "Top-up",
  transfer: "Transfer",
  internet: "Internet",
  data_pack: "Data pack",
  water: "Water",
  electricity: "Electricity",
  community_electricity: "Community electricity",
  wallet_adjustment: "Wallet adjustment",
  wallet_transfer: "Wallet transfer",
};

function displayUser(row: AdminSystemTransaction) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return name || row.phone;
}

function rowTypeLabel(row: AdminSystemTransaction) {
  return row.type_label || TYPE_LABELS[row.kind] || row.kind;
}

function amountAppearance(row: AdminSystemTransaction) {
  if (row.flow === "income") {
    return { sign: "+", className: "text-success" as const };
  }
  if (row.flow === "payout") {
    return { sign: "−", className: "text-destructive" as const };
  }
  return {
    sign: row.credit ? "+" : "−",
    className: row.credit ? ("text-success" as const) : ("text-destructive" as const),
  };
}

function TransactionHistoryPage() {
  const { filters, setFilters, debounced } = useListFilters();
  const [typeTab, setTypeTab] = useState<TypeTab>("all");
  const [exporting, setExporting] = useState(false);

  const txQuery = useQuery({
    queryKey: ["admin", "transactions", debounced],
    queryFn: () => apiClient.adminTransactionHistory(debounced),
    ...adminLiveQueryOptions(),
  });

  const items = useMemo(() => {
    const all = txQuery.data?.items ?? [];
    const filtered = typeTab === "all" ? all : all.filter((item) => item.kind === typeTab);
    return sortByLatestFirst(filtered);
  }, [txQuery.data, typeTab]);

  const typeCounts = txQuery.data?.type_counts ?? {
    all: 0,
    deposit: 0,
    remittance: 0,
    topup: 0,
    transfer: 0,
    internet: 0,
    data_pack: 0,
    water: 0,
    electricity: 0,
    community_electricity: 0,
    wallet_adjustment: 0,
    wallet_transfer: 0,
  };

  return (
    <AdminShell
      title="Transaction History"
      description="Every wallet movement across the system. Green + is system income (System Charge). Red − is money paid out (dealer commission, cashback, customer commission, loads)."
    >
      {txQuery.isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">Loading transactions…</p>
      )}
      {txQuery.isError && (
        <p className="mb-4 text-sm text-destructive">
          {txQuery.error instanceof ApiError
            ? txQuery.error.message
            : "Could not load transaction history."}
        </p>
      )}

      <div className="space-y-4">
        <StatsCards
          items={amountSummaryCards(txQuery.data?.summary, {
            keys: [
              "total_volume",
              "system_income",
              "system_payout",
              "total_credit",
              "total_debit",
              "today_amount",
            ],
            labels: {
              total_volume: "All transactions",
              system_income: "System income",
              system_payout: "Paid out",
              total_credit: "Wallet credits",
              total_debit: "Wallet debits",
              today_amount: "Today",
            },
            hints: {
              total_volume: "Volume in the current filters",
              system_income: "System Charge and recovered payouts",
              system_payout: "Dealer commission, cashback, and loads",
              total_credit: "Approved deposits, remittances and loads",
              total_debit: "Successful payments and transfers",
              today_amount: "Successful movements today",
            },
          })}
        />

        <ListPageToolbar
          stats={{
            total: items.length,
            success: items.filter((i) => i.status === "success" || i.status === "approved").length,
            pending: items.filter((i) => i.status === "pending").length,
            failed: items.filter((i) => i.status === "failed" || i.status === "rejected").length,
          }}
          filters={filters}
          onFiltersChange={setFilters}
          onExport={async () => {
            setExporting(true);
            try {
              await downloadCsvWithQuery(
                "/api/admin/transactions/",
                {
                  q: debounced.q,
                  status: debounced.status !== "all" ? debounced.status : undefined,
                  start_date: debounced.startDate,
                  end_date: debounced.endDate,
                  type: typeTab !== "all" ? typeTab : undefined,
                },
                "admin-transaction-history.csv",
              );
            } finally {
              setExporting(false);
            }
          }}
          exporting={exporting}
          searchPlaceholder="Search phone, name, reference, detail…"
          exportLabel="Download CSV"
          statusOptions={[
            ...TXN_STATUS_OPTIONS,
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ]}
          statsLabels={{
            total: "Shown",
            success: "Success",
            pending: "Pending",
            failed: "Failed",
          }}
        />

        <Tabs value={typeTab} onValueChange={(v) => setTypeTab(v as TypeTab)}>
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
            {TYPE_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                {tab.label}
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    typeTab === tab.value
                      ? "bg-muted text-foreground"
                      : "bg-background/60 text-muted-foreground",
                  )}
                >
                  {typeCounts[tab.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <AdminDataList
          isEmpty={!txQuery.isLoading && items.length === 0}
          empty={
            <AdminEmptyState>
              No{" "}
              {typeTab !== "all" ? `${TYPE_LABELS[typeTab].toLowerCase()} ` : ""}
              transactions match the current filters.
            </AdminEmptyState>
          }
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">S.N.</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Before Wallet Balance</TableHead>
                  <TableHead className="text-right">After Wallet Balance</TableHead>
                  <TableHead>Status / Reference</TableHead>
                  <TableHead>Date and time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={item.id}>
                    <TableCell className="w-10 pr-0 tabular text-sm text-muted-foreground">
                      {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/admin/users/$userId"
                        params={{ userId: String(item.user_id) }}
                        className="font-medium text-foreground hover:underline"
                      >
                        {displayUser(item)}
                      </Link>
                      <div className="text-xs text-muted-foreground">{item.phone}</div>
                    </TableCell>
                    <TableCell className="text-sm">{rowTypeLabel(item)}</TableCell>
                    <TableCell className="max-w-80 text-sm text-muted-foreground">
                      {item.detail || "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular text-right text-sm font-semibold",
                        amountAppearance(item).className,
                      )}
                    >
                      {amountAppearance(item).sign}
                      {formatNPR(item.amount)}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm text-muted-foreground">
                      {item.balance_before != null && item.balance_before !== ""
                        ? formatNPR(item.balance_before)
                        : "—"}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm font-medium">
                      {item.balance_after != null && item.balance_after !== ""
                        ? formatNPR(item.balance_after)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={item.status} compact />
                      <div className="mt-0.5 max-w-40 truncate font-mono text-[11px] text-muted-foreground">
                        {item.reference || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{formatDateTime(item.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
          mobile={
            <AdminMobileCardGrid>
              {items.map((item, index) => (
                <AdminMobileCard key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        S.N. {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)} ·{" "}
                        {rowTypeLabel(item)}
                      </p>
                      <Link
                        to="/admin/users/$userId"
                        params={{ userId: String(item.user_id) }}
                        className="truncate text-sm font-semibold hover:underline"
                      >
                        {displayUser(item)}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{item.phone}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.detail || item.reference || "—"}
                      </p>
                    </div>
                    <p
                      className={cn(
                        "tabular shrink-0 text-base font-semibold",
                        amountAppearance(item).className,
                      )}
                    >
                      {amountAppearance(item).sign}
                      {formatNPR(item.amount)}
                    </p>
                  </div>
                  <AdminMobileMeta
                    items={[
                      { label: "Status", value: <StatusChip status={item.status} compact /> },
                      { label: "Reference", value: item.reference || "—" },
                      {
                        label: "Before Wallet Balance",
                        value:
                          item.balance_before != null && item.balance_before !== ""
                            ? formatNPR(item.balance_before)
                            : "—",
                      },
                      {
                        label: "After Wallet Balance",
                        value:
                          item.balance_after != null && item.balance_after !== ""
                            ? formatNPR(item.balance_after)
                            : "—",
                      },
                      { label: "Date and time", value: formatDateTime(item.created_at) },
                    ]}
                  />
                </AdminMobileCard>
              ))}
            </AdminMobileCardGrid>
          }
        />
      </div>
    </AdminShell>
  );
}
