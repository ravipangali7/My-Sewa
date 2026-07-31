import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { apiClient } from "@/lib/api";
import { findNotification, markNotificationRead } from "@/lib/notifications";
import { formatNPR } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/notifications_/$notificationId")({
  head: () => ({
    meta: [
      { title: "Notification — MySewa" },
      { name: "description", content: "Notification details for your MySewa wallet activity." },
    ],
  }),
  component: NotificationDetailPage,
});

function NotificationDetailPage() {
  const { notificationId } = Route.useParams();
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
  });

  const notification = txQuery.data
    ? findNotification(txQuery.data, notificationId)
    : undefined;

  useEffect(() => {
    if (notificationId) markNotificationRead(notificationId);
  }, [notificationId]);

  return (
    <UserShell title="Notification" back="/app/notifications">
      {txQuery.isLoading ? (
        <div className="inset-group px-4 py-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !notification ? (
        <div className="inset-group px-4 py-10 text-center">
          <p className="text-[16px] font-medium">Notification not found</p>
          <Link to="/app/notifications" className="mt-2 inline-block text-[14px] text-brand">
            Back to notifications
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="inset-group p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-semibold">{notification.title}</h2>
                <p className="mt-1 text-[14px] text-muted-foreground">{notification.body}</p>
              </div>
              <StatusChip status={notification.status} />
            </div>
            <p
              className={cn(
                "tabular mt-4 text-[28px] font-bold tracking-tight",
                notification.credit ? "text-success" : "text-foreground",
              )}
            >
              {notification.credit ? "+" : "−"} {formatNPR(notification.amount)}
            </p>
          </section>

          <section className="inset-group overflow-hidden">
            <dl>
              {notification.details.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[130px_1fr] gap-3 border-b border-border/70 px-4 py-3 last:border-0"
                >
                  <dt className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
                    {row.label}
                  </dt>
                  <dd className="text-[14px] font-medium break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </UserShell>
  );
}
