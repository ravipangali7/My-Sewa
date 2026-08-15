import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import {
  buildNotifications,
  markAllNotificationsRead,
} from "@/lib/notifications";
import { formatDateTime, formatNPR } from "@/lib/format";
import { serialNumber } from "@/lib/serial";
import { liveQueryOptions } from "@/lib/refresh";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/app/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — MySewa" },
      {
        name: "description",
        content: "Wallet alerts for remittances, transfers and top-ups.",
      },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { t, locale } = useI18n();
  const [readTick, setReadTick] = useState(0);
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
    ...liveQueryOptions(),
  });

  const notifications = useMemo(
    () => (txQuery.data ? buildNotifications(txQuery.data, t) : []),
    // readTick forces recompute after mark-all-read updates localStorage
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txQuery.data, readTick, t, locale],
  );
  const unreadCount = notifications.filter((n) => n.unread).length;

  return (
    <UserShell title={t("notif.title")} back="/app">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <p className="text-[13px] text-muted-foreground">
            {unreadCount > 0
              ? t("notif.unread", { count: unreadCount })
              : t("notif.allCaughtUp")}
          </p>
          {notifications.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-[13px]"
              onClick={() => {
                markAllNotificationsRead(notifications.map((n) => n.id));
                setReadTick((tick) => tick + 1);
              }}
            >
              {t("notif.markAllRead")}
            </Button>
          ) : null}
        </div>

        {txQuery.isLoading ? (
          <div className="inset-group px-4 py-10 text-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : notifications.length === 0 ? (
          <div className="inset-group flex flex-col items-center px-4 py-12 text-center">
            <Bell className="mb-3 size-10 text-muted-foreground/50" />
            <p className="text-[16px] font-medium">{t("notif.emptyTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("notif.emptyBody")}
            </p>
          </div>
        ) : (
          <ul className="inset-group divide-y divide-border overflow-hidden">
            {notifications.map((n, index) => (
              <li key={n.id}>
                <Link
                  to="/app/notifications/$notificationId"
                  params={{ notificationId: n.id }}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3.5 transition-colors active:bg-muted/50",
                    n.unread && "bg-brand-soft/40",
                  )}
                >
                  <span className="tabular mt-0.5 w-5 shrink-0 text-center text-[12px] text-muted-foreground">
                    {serialNumber(1, notifications.length || 1, index)}
                  </span>
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      n.unread ? "bg-brand" : "bg-transparent",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-[15px] font-semibold text-foreground">{n.title}</span>
                      <StatusChip status={n.status} compact />
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground line-clamp-2">
                      {n.body}
                    </span>
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-muted-foreground">
                        {formatDateTime(n.created_at)}
                      </span>
                      <span
                        className={cn(
                          "tabular text-[13px] font-semibold",
                          n.credit ? "text-success" : "text-foreground",
                        )}
                      >
                        {n.credit ? "+" : "−"} {formatNPR(n.amount)}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground/60" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </UserShell>
  );
}
