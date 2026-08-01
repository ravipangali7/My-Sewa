import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Send, Smartphone } from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { apiClient } from "@/lib/api";
import { buildActivity } from "@/lib/activity";
import type { ActivityKind } from "@/lib/types";
import { formatNPR, formatDateTime } from "@/lib/format";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { cn } from "@/lib/utils";

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
  { key: "all", label: "All" },
  { key: "deposit", label: "Load" },
  { key: "topup", label: "Top-up" },
  { key: "transfer", label: "Transfer" },
] as const;

function HistoryPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const items = (txQuery.data ? buildActivity(txQuery.data) : []).filter(
    (i) => filter === "all" || i.kind === (filter as ActivityKind),
  );

  return (
    <UserShell title="History">
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-lg py-2 text-[14px] font-medium transition-colors",
                filter === f.key ? "bg-surface text-brand-dark shadow-card" : "text-muted-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {txQuery.isLoading ? (
          <div className="inset-group px-6 py-14 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="inset-group px-6 py-14 text-center">
            <p className="text-[17px] font-medium">Nothing here yet</p>
            <p className="mt-1 text-[15px] text-muted-foreground">
              Your {FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} transactions will
              appear here.
            </p>
          </div>
        ) : (
          <ul className="inset-group divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </UserShell>
  );
}
