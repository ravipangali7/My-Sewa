import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronRight, Download, Send, Smartphone, Wifi, Signal } from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { ListPageToolbar, ReceiptDownloadLink } from "@/components/list/ListPageToolbar";
import { apiClient } from "@/lib/api";
import { buildActivity } from "@/lib/activity";
import type { ActivityKind } from "@/lib/types";
import { formatNPR, formatDateTime } from "@/lib/format";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { useReceiptDownload } from "@/lib/receipt-download";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/app/history")({
  head: () => ({
    meta: [
      { title: "Transaction History — MySewa Wallet" },
      {
        name: "description",
        content:
          "Every MySewa wallet movement in one place: deposits, NTC/NCELL top-ups and bank transfers with status and amounts.",
      },
      { property: "og:title", content: "Transaction History — MySewa" },
      {
        property: "og:description",
        content: "Filter deposits, top-ups and transfers with full status detail.",
      },
    ],
  }),
  component: HistoryPage,
});

const FILTERS = [
  { key: "all", labelKey: "history.all" as const satisfies MessageKey },
  { key: "deposit", labelKey: "history.load" as const satisfies MessageKey },
  { key: "remittance", labelKey: "history.remittance" as const satisfies MessageKey },
  { key: "topup", labelKey: "history.topup" as const satisfies MessageKey },
  { key: "transfer", labelKey: "history.transfer" as const satisfies MessageKey },
  { key: "internet", labelKey: "history.internet" as const satisfies MessageKey },
  { key: "data_pack", labelKey: "history.dataPack" as const satisfies MessageKey },
] as const;

function kindIcon(kind: ActivityKind) {
  if (kind === "deposit") return Download;
  if (kind === "topup" || kind === "data_pack") return kind === "data_pack" ? Signal : Smartphone;
  if (kind === "internet") return Wifi;
  return Send;
}

function HistoryPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { logoUrl } = useSiteBranding();
  const { download: downloadReceipt, downloading: receiptDownloading } = useReceiptDownload(
    t,
    user?.phone,
    logoUrl,
  );
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const { filters, setFilters, debounced } = useListFilters();
  const [exporting, setExporting] = useState(false);

  const apiFilters = useMemo(
    () => ({
      ...debounced,
      kind: filter === "all" ? undefined : filter,
    }),
    [debounced, filter],
  );

  const txQuery = useQuery({
    queryKey: ["wallet", "transactions", apiFilters],
    queryFn: () => apiClient.walletTransactions(apiFilters),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const items = useMemo(
    () => (txQuery.data ? buildActivity(txQuery.data, t) : []),
    [txQuery.data, t, locale],
  );

  const filterMeta = FILTERS.find((f) => f.key === filter);

  return (
    <UserShell title={t("history.title")}>
      <div className="space-y-4">
        <ListPageToolbar
          stats={txQuery.data?.stats}
          filters={filters}
          onFiltersChange={setFilters}
          onExport={async () => {
            setExporting(true);
            try {
              await downloadCsvExport("/api/wallet/transactions/", apiFilters, "transactions.csv");
            } finally {
              setExporting(false);
            }
          }}
          exporting={exporting}
          searchPlaceholder={t("list.searchPlaceholder")}
          exportLabel={t("list.exportCsv")}
          statsLabels={{
            total: t("list.statsTotal"),
            success: t("list.statsSuccess"),
            pending: t("list.statsPending"),
            failed: t("list.statsFailed"),
          }}
          statusOptions={[...TXN_STATUS_OPTIONS]}
        />

        <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-7">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-lg py-2 text-[12px] font-medium transition-colors sm:text-[14px]",
                filter === f.key ? "bg-surface text-brand-dark shadow-card" : "text-muted-foreground",
              )}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>

        {txQuery.isLoading ? (
          <div className="inset-group px-6 py-14 text-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : items.length === 0 ? (
          <div className="inset-group px-6 py-14 text-center">
            <p className="text-[17px] font-medium">{t("history.emptyTitle")}</p>
            <p className="mt-1 text-[15px] text-muted-foreground">
              {t("history.emptyBody", {
                filter: filterMeta ? t(`${filterMeta.labelKey}` as MessageKey) : "",
              })}
            </p>
          </div>
        ) : (
          <ul className="inset-group divide-y divide-border">
            {items.map((item) => {
              const Icon = kindIcon(item.kind);
              const canDownload =
                item.status === "success" ||
                item.status === "failed" ||
                item.status === "approved" ||
                item.status === "rejected";
              return (
                <li key={item.id}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Link
                      to="/app/history/$activityId"
                      params={{ activityId: item.id }}
                      className="flex min-w-0 flex-1 items-center gap-3 transition-colors active:bg-muted/60"
                    >
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-full",
                          item.credit ? "bg-success/12 text-success" : "bg-ocean/10 text-ocean",
                        )}
                      >
                        <Icon className="size-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium">{item.title}</p>
                        <p className="truncate text-[13px] text-muted-foreground">
                          {item.subtitle} · {formatDateTime(item.created_at)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={cn(
                            "tabular text-[15px] font-semibold",
                            item.credit ? "text-success" : "text-label",
                          )}
                        >
                          {item.credit ? "+" : "−"} {formatNPR(item.amount)}
                        </p>
                        <StatusChip status={item.status} compact className="mt-1" />
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
                    </Link>
                    {canDownload ? (
                      <ReceiptDownloadLink
                        label={t("list.downloadReceipt")}
                        downloading={receiptDownloading}
                        onClick={() => void downloadReceipt(item.id)}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </UserShell>
  );
}
