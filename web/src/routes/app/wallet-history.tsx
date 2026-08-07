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
import { WalletIllustration } from "@/components/home/WalletIllustration";

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
        const rowClass =
          "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-muted/60";
        return (
          <li key={item.id}>
            <Link
              to="/app/history/$activityId"
              params={{ activityId: item.id }}
              className={rowClass}
              aria-label={t("history.openStatement")}
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

  const { credits, debits } = useMemo(() => {
    const all = txQuery.data ? buildActivity(txQuery.data, t) : [];
    return {
      credits: filterWalletCredits(all),
      debits: filterWalletDebits(all),
    };
  }, [txQuery.data, t, locale]);

  const activeCount = tab === "credit" ? credits.length : debits.length;

  return (
    <UserShell title={t("walletHistory.title")} back="/app">
      <div className="min-w-0 space-y-4">
        <section className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(145deg,#062A5C_0%,#0B3B7A_38%,#0B5588_68%,#0A6E78_100%)] px-5 py-4 shadow-[0_10px_28px_-10px_rgba(6,42,92,0.45)]">
          <div className="relative z-10 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-white/75">{t("home.wallet")}</p>
              <p className="mt-1 tabular text-[28px] leading-none font-bold tracking-tight text-white">
                {wallet ? formatRu(wallet.balance) : "रु. —"}
              </p>
              <p className="mt-2 text-[11px] font-medium text-white/70">
                {t("walletHistory.count", { count: activeCount })}
              </p>
            </div>
            <WalletIllustration className="mb-[-2px] h-[72px] w-[90px] shrink-0 opacity-95" />
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
