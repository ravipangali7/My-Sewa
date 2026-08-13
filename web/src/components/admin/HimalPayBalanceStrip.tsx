import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Gift, RefreshCw, Wallet } from "lucide-react";
import { StatsCards, type StatCardItem } from "@/components/admin/StatsCards";
import { Button } from "@/components/ui/button";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime, formatNPR } from "@/lib/format";
import {
  himalPayBalanceSourceLabel,
  resolveHimalPayBalance,
} from "@/lib/himalpay-balance";

export function HimalPayBalanceStrip({
  linkHistory = false,
}: {
  /** When true, the HimalPay balance card opens HimalPay History. */
  linkHistory?: boolean;
}) {
  const queryClient = useQueryClient();
  const balanceQuery = useQuery({
    queryKey: ["admin", "statement", "balance"],
    queryFn: () => apiClient.adminStatementBalance(),
    retry: 1,
    refetchOnMount: "always",
    refetchInterval: 60_000,
    staleTime: 0,
  });

  const balance = balanceQuery.data?.data;
  const balanceUnavailable = Boolean(
    balanceQuery.data?.unavailable ||
      (balanceQuery.isError && !balance) ||
      (balanceQuery.data?.error && !balance),
  );
  const { main: mainRupees, bonus: bonusRupees, total: totalRupees } =
    resolveHimalPayBalance(balance);
  const balanceUpdatedAt =
    typeof balance?.updated_at === "string" ? balance.updated_at : null;

  const amountOrDash = (value: number | null) => {
    if (balanceQuery.isLoading) return "…";
    if (value == null) return "—";
    return formatNPR(value);
  };

  const balanceHint = (() => {
    if (balanceQuery.isLoading || balanceQuery.isFetching) {
      return "Fetching live HimalPay balance…";
    }
    if (totalRupees == null) return "Unavailable";
    const source =
      (typeof balanceQuery.data?.source === "string" && balanceQuery.data.source) ||
      (typeof balance?.source === "string" ? balance.source : "") ||
      "";
    const sourceLabel = himalPayBalanceSourceLabel(source);
    if (linkHistory) {
      const stamp = balanceUpdatedAt
        ? ` · Updated ${formatDateTime(balanceUpdatedAt)}`
        : "";
      return `Open HimalPay history · ${sourceLabel}${stamp}`;
    }
    if (balanceUpdatedAt) {
      return `${sourceLabel} · Updated ${formatDateTime(balanceUpdatedAt)}`;
    }
    return sourceLabel;
  })();

  const balanceCards: StatCardItem[] = [
    {
      key: "hp-total",
      label: "HimalPay balance",
      value: amountOrDash(totalRupees),
      hint: balanceHint,
      icon: Wallet,
      tone: "brand",
      to: linkHistory ? "/admin/himalpay-history" : undefined,
    },
    {
      key: "hp-main",
      label: "Main wallet",
      value: amountOrDash(mainRupees),
      hint: "Primary HimalPay float",
      icon: Coins,
      tone: "credit",
    },
    {
      key: "hp-bonus",
      label: "Bonus wallet",
      value: amountOrDash(bonusRupees),
      hint: "Bonus HimalPay float",
      icon: Gift,
      tone: "info",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Live HimalPay float
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["admin", "statement", "balance"] })
          }
          disabled={balanceQuery.isFetching}
        >
          <RefreshCw
            className={`mr-1.5 size-3.5 ${balanceQuery.isFetching ? "animate-spin" : ""}`}
          />
          {balanceQuery.isFetching ? "Refreshing…" : "Refresh balance"}
        </Button>
      </div>
      <StatsCards items={balanceCards} />

      {balanceUnavailable ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-foreground">
          <p className="font-medium">HimalPay balance could not be loaded with your API key</p>
          <p className="mt-1 text-muted-foreground">
            {balanceQuery.data?.hint ||
              (balanceQuery.data?.api_key_configured !== false
                ? "LIVE HimalPay does not expose GET /wallet/reseller-balance yet (documented in himalpay.md for UAT). MySewa already uses your Super Admin API key for this call."
                : "Configure the HimalPay API key under Admin → Settings → HimalPay.")}
          </p>
          <p className="mt-2 text-muted-foreground">
            Next steps: ask HimalPay to enable{" "}
            <span className="font-medium">/wallet/reseller-balance</span> on LIVE, or add portal
            login under <span className="font-medium">Admin → Settings → HimalPay</span> so MySewa
            can read <span className="font-medium">/users/me/wallet</span>.
          </p>
          {balanceQuery.data?.error ||
          (balanceQuery.error instanceof ApiError ? balanceQuery.error.message : null) ? (
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {balanceQuery.data?.error ||
                (balanceQuery.error instanceof ApiError ? balanceQuery.error.message : null)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
