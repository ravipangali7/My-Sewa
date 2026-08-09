import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { ListPageToolbar } from "@/components/list/ListPageToolbar";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
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
import { walletDisplayName } from "@/components/admin/WalletCard";
import { apiClient, ApiError } from "@/lib/api";
import { buildActivity } from "@/lib/activity";
import { formatDateTime, formatNPR } from "@/lib/format";
import { serialNumber } from "@/lib/serial";
import type { ActivityKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";

const LIST_PAGE = 1;
const LIST_PAGE_SIZE = 50;

export const Route = createFileRoute("/admin/wallets_/$walletId_/transactions")({
  head: () => ({
    meta: [
      { title: "Wallet Transaction History — MySewa Admin" },
      {
        name: "description",
        content:
          "View deposits, top-ups, transfers, bills and adjustments for a specific MySewa wallet.",
      },
      { property: "og:title", content: "Wallet Transaction History — MySewa Admin" },
    ],
  }),
  component: WalletTransactionsPage,
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
  { value: "community_electricity", label: "Community electricity" },
  { value: "wallet_adjustment", label: "Manual loads / adjustments" },
];

const TYPE_LABELS: Record<ActivityKind, string> = {
  deposit: "Deposit",
  remittance: "Remittance",
  topup: "Top-up",
  transfer: "Transfer",
  internet: "Internet",
  data_pack: "Data pack",
  water: "Water",
  community_electricity: "Community electricity",
  wallet_adjustment: "Manual load / adjust",
};

function WalletTransactionsPage() {
  const { walletId } = Route.useParams();
  const id = Number(walletId);
  const { filters, setFilters, debounced } = useListFilters();
  const [typeTab, setTypeTab] = useState<TypeTab>("all");

  const walletQuery = useQuery({
    queryKey: ["admin", "wallets", id],
    queryFn: () => apiClient.adminGetWallet(id),
    enabled: Number.isFinite(id),
  });

  const txQuery = useQuery({
    queryKey: ["admin", "wallets", id, "transactions", debounced.startDate, debounced.endDate],
    queryFn: () =>
      apiClient.adminWalletTransactions(id, {
        startDate: debounced.startDate,
        endDate: debounced.endDate,
      }),
    enabled: Number.isFinite(id),
    refetchOnMount: "always",
  });

  const items = useMemo(() => {
    const all = txQuery.data ? buildActivity(txQuery.data) : [];
    const q = debounced.q.trim().toLowerCase();
    return all.filter((item) => {
      if (typeTab !== "all" && item.kind !== typeTab) return false;
      if (debounced.status !== "all" && item.status !== debounced.status) return false;
      if (!q) return true;
      const haystack = [item.title, item.subtitle, item.kind, item.status, item.amount]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [txQuery.data, debounced.q, debounced.status, typeTab]);

  const typeCounts = useMemo(() => {
    const all = txQuery.data ? buildActivity(txQuery.data) : [];
    const counts: Record<TypeTab, number> = {
      all: all.length,
      deposit: 0,
      remittance: 0,
      topup: 0,
      transfer: 0,
      internet: 0,
      data_pack: 0,
      water: 0,
      community_electricity: 0,
      wallet_adjustment: 0,
    };
    for (const item of all) {
      counts[item.kind] += 1;
    }
    return counts;
  }, [txQuery.data]);

  const w = walletQuery.data;
  const name = w ? walletDisplayName(w) : "";

  return (
    <AdminShell
      title={w ? `${name} — History` : "Transaction History"}
      description={
        w
          ? `All transactions for wallet #${w.id} · ${w.phone}`
          : walletQuery.isLoading
            ? "Loading…"
            : "Wallet not found"
      }
    >
      <div className="mb-5">
        <BackButton to="/admin/wallets/$walletId" params={{ walletId }} label="Back to wallet" />
      </div>

      {(walletQuery.isError || txQuery.isError) && (
        <p className="mb-4 text-sm text-destructive">
          {(walletQuery.error instanceof ApiError
            ? walletQuery.error.message
            : null) ||
            (txQuery.error instanceof ApiError ? txQuery.error.message : null) ||
            "Could not load transaction history."}
        </p>
      )}

      {txQuery.isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">Loading transactions…</p>
      )}

      <div className="space-y-4">
        <ListPageToolbar
          stats={{
            total: items.length,
            success: items.filter((i) => i.status === "success" || i.status === "approved").length,
            pending: items.filter((i) => i.status === "pending").length,
            failed: items.filter((i) => i.status === "failed" || i.status === "rejected").length,
          }}
          filters={filters}
          onFiltersChange={setFilters}
          searchPlaceholder="Search type, amount, subtitle…"
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
              transactions for this wallet.
              {w ? (
                <>
                  {" "}
                  <Link
                    to="/admin/wallets/$walletId"
                    params={{ walletId }}
                    className="text-brand underline-offset-2 hover:underline"
                  >
                    Back to wallet
                  </Link>
                </>
              ) : null}
            </AdminEmptyState>
          }
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">S.N.</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Before Wallet Balance</TableHead>
                  <TableHead className="text-right">After Wallet Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={item.id}>
                    <TableCell className="w-10 pr-0 tabular text-sm text-muted-foreground">
                      {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}
                    </TableCell>
                    <TableCell className="text-sm">{TYPE_LABELS[item.kind]}</TableCell>
                    <TableCell className="text-sm font-medium">{item.title}</TableCell>
                    <TableCell className="max-w-56 truncate text-sm text-muted-foreground">
                      {item.subtitle || "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "tabular text-right text-sm font-semibold",
                        item.credit ? "text-success" : "text-foreground",
                      )}
                    >
                      {item.credit ? "+" : "−"}
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
                        {TYPE_LABELS[item.kind]}
                      </p>
                      <p className="truncate text-sm font-semibold">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.subtitle || "—"}
                      </p>
                    </div>
                    <p
                      className={cn(
                        "tabular shrink-0 text-base font-semibold",
                        item.credit && "text-success",
                      )}
                    >
                      {item.credit ? "+" : "−"}
                      {formatNPR(item.amount)}
                    </p>
                  </div>
                  <AdminMobileMeta
                    items={[
                      { label: "Status", value: <StatusChip status={item.status} compact /> },
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
                      { label: "Created", value: formatDateTime(item.created_at) },
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
