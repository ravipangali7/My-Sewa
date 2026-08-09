import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronRight, Download, FileDown, Loader2, Search, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiClient } from "@/lib/api";
import { buildActivity, buildActivityStatement } from "@/lib/activity";
import type { ActivityKind } from "@/lib/types";
import { formatNPR, formatDateTime, sortByLatestFirst } from "@/lib/format";
import { serialNumber } from "@/lib/serial";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { downloadStatementPdf } from "@/lib/statement-pdf";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { TXN_STATUS_OPTIONS, type ListStatus } from "@/hooks/use-list-filters";

export const Route = createFileRoute("/app/history")({
  head: () => ({
    meta: [
      { title: "Transaction History — MySewa Business Wallet" },
      {
        name: "description",
        content:
          "Every MySewa business wallet movement in one place: deposits, NTC/NCELL top-ups and bank transfers with status and amounts.",
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
  { key: "all", labelKey: "history.all" as const satisfies MessageKey, filterKey: "history.filterAll" as const satisfies MessageKey },
  { key: "deposit", labelKey: "history.load" as const satisfies MessageKey, filterKey: "history.filterLoad" as const satisfies MessageKey },
  { key: "topup", labelKey: "history.topup" as const satisfies MessageKey, filterKey: "history.filterTopup" as const satisfies MessageKey },
  { key: "transfer", labelKey: "history.transfer" as const satisfies MessageKey, filterKey: "history.filterTransfer" as const satisfies MessageKey },
] as const;

type HistoryKindFilter = (typeof FILTERS)[number]["key"];

type HistorySearchFilters = {
  q: string;
  kind: HistoryKindFilter;
  status: ListStatus;
  startDate: string;
  endDate: string;
};

const DEFAULT_FILTERS: HistorySearchFilters = {
  q: "",
  kind: "all",
  status: "all",
  startDate: "",
  endDate: "",
};

function statusHeadlineKey(status: string): MessageKey {
  const key = status.toLowerCase();
  if (key === "success" || key === "approved") return "history.successTitle";
  if (key === "failed") return "history.failedTitle";
  if (key === "rejected") return "history.rejectedTitle";
  return "history.pendingTitle";
}

function toDayStart(value: string) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDayEnd(value: string) {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function HistoryPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { logoUrl } = useSiteBranding();
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState<HistorySearchFilters>(DEFAULT_FILTERS);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const items = useMemo(() => {
    const all = txQuery.data ? buildActivity(txQuery.data, t) : [];
    const q = filters.q.trim().toLowerCase();
    const start = toDayStart(filters.startDate);
    const end = toDayEnd(filters.endDate);

    const filtered = all.filter((item) => {
      if (filters.kind !== "all" && item.kind !== (filters.kind as ActivityKind)) {
        return false;
      }
      if (filters.status !== "all" && item.status !== filters.status) {
        return false;
      }
      if (start || end) {
        const created = new Date(item.created_at);
        if (Number.isNaN(created.getTime())) return false;
        if (start && created < start) return false;
        if (end && created > end) return false;
      }
      if (!q) return true;
      const haystack = [
        item.title,
        item.subtitle,
        item.amount,
        item.status,
        item.kind,
        formatNPR(item.amount),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    // Re-assert latest-first after filters (most recent statement at the top).
    return sortByLatestFirst(filtered);
  }, [txQuery.data, t, locale, filters]);

  const filterMeta = FILTERS.find((f) => f.key === filters.kind);
  const hasActiveFilters =
    filters.q.trim() !== "" ||
    filters.kind !== "all" ||
    filters.status !== "all" ||
    filters.startDate !== "" ||
    filters.endDate !== "";

  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  async function handleDownloadPdf(activityId: string, status: string) {
    if (!txQuery.data || downloadingId) return;
    setDownloadingId(activityId);
    try {
      const statement = buildActivityStatement(
        txQuery.data,
        activityId,
        t,
        user?.phone,
      );
      if (!statement) {
        toast.error(t("history.downloadPdfFailed"));
        return;
      }
      await downloadStatementPdf({
        statement,
        title: t(statusHeadlineKey(status)),
        detailsHeading: t("history.transactionDetails"),
        logoUrl,
        brandName: t("history.statementBrand"),
      });
    } catch {
      toast.error(t("history.downloadPdfFailed"));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <UserShell
      title={t("history.title")}
      headerTrailing={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "relative size-10 shrink-0 rounded-xl border border-white/25 bg-white/15 text-primary-foreground shadow-sm backdrop-blur",
            "hover:bg-white/25",
            "lg:border-border lg:bg-surface lg:text-foreground lg:hover:border-brand/35 lg:hover:bg-brand-soft lg:hover:text-brand-dark",
          )}
          onClick={() => setSearchOpen(true)}
          aria-label={t("history.searchTitle")}
        >
          <Search className="size-4" />
          {hasActiveFilters ? (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-primary-foreground lg:ring-surface"
            />
          ) : null}
        </Button>
      }
    >
      <div className="min-w-0 max-w-full space-y-4 overflow-x-clip">
        {hasActiveFilters ? (
          <div className="flex flex-wrap items-center gap-2 px-0.5">
            <span className="rounded-md bg-muted px-2 py-1 text-[12px] font-medium text-muted-foreground">
              {t(filterMeta?.labelKey ?? "history.all")}
              {filters.status !== "all" ? ` · ${filters.status}` : ""}
              {filters.q.trim() ? ` · “${filters.q.trim()}”` : ""}
            </span>
            <button
              type="button"
              onClick={clearFilters}
              className="text-[12px] font-medium text-brand underline-offset-2 hover:underline"
            >
              {t("history.clearFilters")}
            </button>
          </div>
        ) : null}

        {txQuery.isLoading ? (
          <div className="inset-group px-6 py-14 text-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : items.length === 0 ? (
          <div className="inset-group px-6 py-14 text-center">
            <p className="text-[17px] font-medium">{t("history.emptyTitle")}</p>
            <p className="mt-1 text-[15px] text-muted-foreground">
              {t("history.emptyBody", {
                filter: filterMeta ? t(filterMeta.filterKey) : "",
              })}
            </p>
          </div>
        ) : (
          <ul className="inset-group min-w-0 divide-y divide-border overflow-hidden">
            {items.map((item, index) => {
              const isDownloading = downloadingId === item.id;
              const sn = serialNumber(1, items.length || 1, index);
              return (
                <li key={item.id} className="flex items-stretch">
                  <Link
                    to="/app/history/$activityId"
                    params={{ activityId: item.id }}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 transition-colors active:bg-muted/60"
                  >
                    <span className="tabular w-5 shrink-0 text-center text-[12px] text-muted-foreground">
                      {sn}
                    </span>
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full",
                        item.credit ? "bg-success/12 text-success" : "bg-ocean/10 text-ocean",
                      )}
                    >
                      {item.kind === "deposit" ? (
                        <Download className="size-[18px]" />
                      ) : item.kind === "topup" ? (
                        <Smartphone className="size-[18px]" />
                      ) : (
                        <Send className="size-[18px]" />
                      )}
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleDownloadPdf(item.id, item.status);
                    }}
                    disabled={Boolean(downloadingId)}
                    aria-label={t("history.downloadPdf")}
                    title={t("history.downloadPdf")}
                    className="inline-flex w-12 shrink-0 items-center justify-center border-l border-border text-brand transition-colors hover:bg-brand-soft disabled:opacity-60"
                  >
                    {isDownloading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FileDown className="size-4" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto overscroll-y-contain rounded-t-2xl px-4 pb-[max(2rem,calc(1rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] pt-5">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>{t("history.searchTitle")}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="history-search-q">{t("common.search")}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="history-search-q"
                  autoFocus
                  value={filters.q}
                  onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
                  placeholder={t("history.searchPlaceholder")}
                  className="h-12 rounded-xl pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("common.type")}</Label>
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilters((prev) => ({ ...prev, kind: f.key }))}
                    className={cn(
                      "rounded-lg py-2 text-[13px] font-medium transition-colors",
                      filters.kind === f.key
                        ? "bg-surface text-brand-dark shadow-card"
                        : "text-muted-foreground",
                    )}
                  >
                    {t(f.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="history-search-status">{t("list.status")}</Label>
              <select
                id="history-search-status"
                value={filters.status}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    status: e.target.value as ListStatus,
                  }))
                }
                className={cn(
                  "h-12 w-full rounded-xl border border-input bg-background px-3 text-sm",
                  filters.status === "all" && "text-muted-foreground",
                )}
                aria-label={t("list.status")}
              >
                {TXN_STATUS_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    className="text-foreground"
                  >
                    {option.value === "all" ? t("list.allStatuses") : option.label}
                  </option>
                ))}
                <option value="approved" className="text-foreground">
                  {t("status.approved")}
                </option>
                <option value="rejected" className="text-foreground">
                  {t("status.rejected")}
                </option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="history-start-date">{t("list.startDate")}</Label>
                <Input
                  id="history-start-date"
                  type="date"
                  value={filters.startDate}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, startDate: e.target.value }))
                  }
                  placeholder={t("list.startDate")}
                  title={t("list.startDate")}
                  className="h-12 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="history-end-date">{t("list.endDate")}</Label>
                <Input
                  id="history-end-date"
                  type="date"
                  value={filters.endDate}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, endDate: e.target.value }))
                  }
                  placeholder={t("list.endDate")}
                  title={t("list.endDate")}
                  className="h-12 rounded-xl"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1 rounded-xl"
                  onClick={clearFilters}
                >
                  {t("history.clearFilters")}
                </Button>
              ) : null}
              <Button
                type="button"
                className="h-11 flex-1 rounded-xl"
                onClick={() => setSearchOpen(false)}
              >
                {t("history.applyFilters")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </UserShell>
  );
}
