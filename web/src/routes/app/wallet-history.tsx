import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ChevronRight,
  Download,
  Redo2,
  Send,
  Signal,
  Smartphone,
  SlidersHorizontal,
  Wifi,
  Droplets,
  Zap,
} from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiClient } from "@/lib/api";
import {
  buildActivity,
  filterWalletCredits,
  filterWalletDebits,
} from "@/lib/activity";
import type { ActivityItem } from "@/lib/types";
import { formatNPR, formatDateTime } from "@/lib/format";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { serialNumber } from "@/lib/serial";

export const Route = createFileRoute("/app/wallet-history")({
  head: () => ({
    meta: [
      { title: "Wallet History — MySewa" },
      {
        name: "description",
        content:
          "Credit and debit history for your MySewa wallet: deposits, remittances, top-ups, transfers and adjustments.",
      },
      { property: "og:title", content: "Wallet History — MySewa" },
      {
        property: "og:description",
        content: "View wallet credit and debit movements separately.",
      },
    ],
  }),
  component: WalletHistoryPage,
});

type HistoryTab = "credit" | "debit";

function formatRu(value: string | number) {
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "रु. —";
  return `रु. ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function hasBalance(value: string | null | undefined): value is string {
  return value != null && String(value).trim() !== "";
}

function KindIcon({ item }: { item: ActivityItem }) {
  if (item.kind === "deposit") return <Download className="size-[18px]" strokeWidth={2.25} />;
  if (item.kind === "remittance") return <ArrowDownToLine className="size-[18px]" strokeWidth={2.25} />;
  if (item.kind === "topup") return <Smartphone className="size-[18px]" strokeWidth={2.25} />;
  if (item.kind === "transfer") return <Send className="size-[18px]" strokeWidth={2.25} />;
  if (item.kind === "internet") return <Wifi className="size-[18px]" strokeWidth={2.25} />;
  if (item.kind === "data_pack") return <Signal className="size-[18px]" strokeWidth={2.25} />;
  if (item.kind === "water") return <Droplets className="size-[18px]" strokeWidth={2.25} />;
  if (item.kind === "community_electricity") return <Zap className="size-[18px]" strokeWidth={2.25} />;
  if (item.kind === "wallet_adjustment") {
    return item.credit ? (
      <ArrowDownToLine className="size-[18px]" strokeWidth={2.25} />
    ) : (
      <SlidersHorizontal className="size-[18px]" strokeWidth={2.25} />
    );
  }
  return <Redo2 className="size-[18px]" strokeWidth={2.25} />;
}

function HistoryList({
  items,
  emptyLabel,
  loading,
}: {
  items: ActivityItem[];
  emptyLabel: string;
  loading: boolean;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="px-4 py-14 text-center text-sm text-muted-foreground">
        {t("walletHistory.loading")}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-4 py-14 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((item, index) => {
        const sn = serialNumber(1, items.length || 1, index);
        return (
          <li key={item.id}>
            <Link
              to="/app/history/$activityId"
              params={{ activityId: item.id }}
              className="flex w-full flex-col gap-2 px-4 py-3.5 text-left transition-colors active:bg-muted/60"
              aria-label={t("history.openStatement")}
            >
              <span className="flex w-full items-center gap-3">
                <span className="tabular w-5 shrink-0 text-center text-[12px] text-muted-foreground">
                  {sn}
                </span>
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    item.credit ? "bg-success/12 text-success" : "bg-ocean/10 text-ocean",
                  )}
                >
                  <KindIcon item={item} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-[#0B2B4A]">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                    {item.subtitle} · {formatDateTime(item.created_at)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={cn(
                      "tabular block text-[15px] font-semibold",
                      item.credit ? "text-success" : "text-[#0B2B4A]",
                    )}
                  >
                    {item.credit ? "+" : "−"} {formatNPR(item.amount)}
                  </span>
                  <StatusChip status={item.status} compact className="mt-1" />
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
              </span>
              <span className="ml-8 mr-1 grid grid-cols-2 gap-2 sm:ml-[4.5rem] sm:mr-7">
                <span className="min-w-0 rounded-xl bg-[#F3F6FA] px-2.5 py-2">
                  <span className="block text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("walletHistory.beforeBalance")}
                  </span>
                  <span className="mt-0.5 block truncate tabular text-[12px] font-bold text-[#0B2B4A]">
                    {hasBalance(item.balance_before)
                      ? formatRu(item.balance_before)
                      : "रु. —"}
                  </span>
                </span>
                <span className="min-w-0 rounded-xl bg-emerald-50 px-2.5 py-2">
                  <span className="block text-[10px] font-semibold tracking-wide text-emerald-700/80 uppercase">
                    {t("walletHistory.afterBalance")}
                  </span>
                  <span className="mt-0.5 block truncate tabular text-[12px] font-bold text-[#0B2B4A]">
                    {hasBalance(item.balance_after)
                      ? formatRu(item.balance_after)
                      : "रु. —"}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function WalletHistoryPage() {
  const { t, locale } = useI18n();
  const { wallet } = useAuth();
  const [tab, setTab] = useState<HistoryTab>("credit");

  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const { credits, debits, latestWithBalances } = useMemo(() => {
    const all = txQuery.data ? buildActivity(txQuery.data, t) : [];
    const withBalances = all.find(
      (item) => hasBalance(item.balance_before) && hasBalance(item.balance_after),
    );
    return {
      credits: filterWalletCredits(all),
      debits: filterWalletDebits(all),
      latestWithBalances: withBalances ?? null,
    };
  }, [txQuery.data, t, locale]);

  const activeCount = tab === "credit" ? credits.length : debits.length;
  const afterBalance =
    wallet?.balance ?? latestWithBalances?.balance_after ?? null;
  const beforeBalance = latestWithBalances?.balance_before ?? null;

  return (
    <UserShell title={t("walletHistory.title")} back="/app">
      <div className="min-w-0 space-y-4">
        <section className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(145deg,#062A5C_0%,#0B3B7A_38%,#0B5588_68%,#0A6E78_100%)] px-5 py-4 shadow-[0_10px_28px_-10px_rgba(6,42,92,0.45)]">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(circle at 18% 78%, rgba(125,211,252,0.45) 0 1.2px, transparent 1.8px), radial-gradient(circle at 72% 72%, rgba(165,243,252,0.35) 0 1px, transparent 1.6px)",
              backgroundSize: "26px 26px, 34px 34px",
            }}
          />
          <div className="relative z-10">
            <p className="text-[12px] font-medium text-white/75">{t("home.wallet")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="min-w-0 rounded-2xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15">
                <p className="text-[10px] font-semibold tracking-wide text-white/70 uppercase">
                  {t("walletHistory.beforeBalance")}
                </p>
                <p className="mt-1 break-all tabular text-[17px] leading-tight font-bold tracking-tight text-white">
                  {hasBalance(beforeBalance) ? formatRu(beforeBalance) : "रु. —"}
                </p>
              </div>
              <div className="min-w-0 rounded-2xl bg-emerald-400/15 px-3 py-2.5 ring-1 ring-emerald-300/35">
                <p className="text-[10px] font-semibold tracking-wide text-emerald-200 uppercase">
                  {t("walletHistory.afterBalance")}
                </p>
                <p className="mt-1 break-all tabular text-[17px] leading-tight font-bold tracking-tight text-white">
                  {hasBalance(afterBalance) ? formatRu(afterBalance) : "रु. —"}
                </p>
              </div>
            </div>
            <p className="mt-2.5 text-[11px] font-medium text-white/70">
              {t("walletHistory.count", { count: activeCount })}
            </p>
          </div>
        </section>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as HistoryTab)}
          className="min-w-0"
        >
          <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl">
            <TabsTrigger value="credit" className="rounded-lg">
              {t("walletHistory.creditTab")}
            </TabsTrigger>
            <TabsTrigger value="debit" className="rounded-lg">
              {t("walletHistory.debitTab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="credit" className="mt-3">
            <div className="inset-group min-w-0 overflow-hidden">
              <HistoryList
                items={credits}
                emptyLabel={t("walletHistory.emptyCredit")}
                loading={txQuery.isLoading}
              />
            </div>
          </TabsContent>

          <TabsContent value="debit" className="mt-3">
            <div className="inset-group min-w-0 overflow-hidden">
              <HistoryList
                items={debits}
                emptyLabel={t("walletHistory.emptyDebit")}
                loading={txQuery.isLoading}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </UserShell>
  );
}
