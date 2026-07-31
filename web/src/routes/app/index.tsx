import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Send, Smartphone, ChevronRight } from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { apiClient } from "@/lib/api";
import { buildActivity } from "@/lib/activity";
import { useAuth } from "@/lib/auth";
import { formatNPR, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Wallet Home — MySewa" },
      {
        name: "description",
        content:
          "Your MySewa wallet balance in NPR with quick access to load, top-up and bank transfer.",
      },
      { property: "og:title", content: "Wallet Home — MySewa" },
      { property: "og:description", content: "Balance, quick actions and recent wallet activity." },
    ],
  }),
  component: WalletHome,
});

const ACTIONS = [
  { to: "/app/load", label: "Load", icon: Download },
  { to: "/app/topup", label: "Top Up", icon: Smartphone },
  { to: "/app/transfer", label: "Transfer", icon: Send },
];

function WalletHome() {
  const { user, wallet } = useAuth();
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
  });

  const activity = txQuery.data ? buildActivity(txQuery.data).slice(0, 5) : [];
  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(" ") || user.phone
    : "";

  return (
    <UserShell title="MySewa">
      <div className="-mt-3 space-y-5 lg:mt-0">
        <section className="rounded-2xl bg-hero-gradient p-5 shadow-card lg:p-7">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[13px] text-primary-foreground/70">Available balance</p>
              <p className="tabular mt-1 text-[38px] leading-none font-bold text-primary-foreground lg:text-[44px]">
                {wallet ? formatNPR(wallet.balance) : "—"}
              </p>
              <p className="mt-2 text-[13px] text-primary-foreground/70">
                {displayName}
                {user ? ` · ${user.phone}` : ""}
              </p>
            </div>
            <span className="rounded-full bg-brand-accent/90 px-3 py-1 text-xs font-medium text-primary-foreground">
              NPR
            </span>
          </div>
        </section>

        <section className="grid grid-cols-3 gap-3">
          {ACTIONS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="inset-group flex flex-col items-center gap-2 px-2 py-4 transition-transform active:scale-[0.98]"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <a.icon className="size-5" />
              </span>
              <span className="text-[13px] font-medium">{a.label}</span>
            </Link>
          ))}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[17px] font-semibold">Recent activity</h2>
            <Link to="/app/history" className="text-[15px] font-medium text-brand">
              See all
            </Link>
          </div>
          {txQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              Loading activity…
            </div>
          ) : activity.length === 0 ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              No recent activity yet.
            </div>
          ) : (
            <ul className="inset-group divide-y divide-border">
              {activity.map((item) => (
                <li key={item.id}>
                  <Link
                    to="/app/history"
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                  >
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full",
                        item.credit ? "bg-success/12 text-success" : "bg-ocean/10 text-ocean",
                      )}
                    >
                      {item.credit ? (
                        <Download className="size-[18px]" />
                      ) : item.kind === "topup" ? (
                        <Smartphone className="size-[18px]" />
                      ) : (
                        <Send className="size-[18px]" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{item.title}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {formatDateTime(item.created_at)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span
                        className={cn(
                          "tabular block text-[15px] font-semibold",
                          item.credit ? "text-success" : "text-label",
                        )}
                      >
                        {item.credit ? "+" : "−"} {formatNPR(item.amount)}
                      </span>
                      <StatusChip status={item.status} compact className="mt-1" />
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </UserShell>
  );
}
