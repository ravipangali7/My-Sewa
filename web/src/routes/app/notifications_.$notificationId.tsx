import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { apiClient } from "@/lib/api";
import {
  findNotification,
  markNotificationRead,
  type NotificationDetailRow,
} from "@/lib/notifications";
import { formatNPR } from "@/lib/format";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/app/notifications_/$notificationId")({
  head: () => ({
    meta: [
      { title: "Notification — MySewa" },
      { name: "description", content: "Notification details for your MySewa wallet activity." },
    ],
  }),
  component: NotificationDetailPage,
});

function DetailRow({ row }: { row: NotificationDetailRow }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const canCopy = Boolean(row.mono && row.value && row.value !== "—");

  async function handleCopy() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(row.value);
      setCopied(true);
      toast.success(t("common.copied"));
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }

  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border/70 px-4 py-3 last:border-0 min-[380px]:grid-cols-[minmax(7.5rem,8.5rem)_minmax(0,1fr)] min-[380px]:items-start min-[380px]:gap-3">
      <dt className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
        {row.label}
      </dt>
      <dd className="min-w-0">
        {canCopy ? (
          <div className="flex min-w-0 items-start gap-2">
            <span
              className="min-w-0 flex-1 break-all font-mono text-[13px] leading-snug font-medium"
              title={row.value}
            >
              {row.value}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label={copied ? t("common.copied") : t("common.copy")}
              title={copied ? t("common.copied") : t("common.copy")}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </div>
        ) : (
          <span
            className={cn(
              "block min-w-0 text-[14px] font-medium break-words",
              row.mono && "break-all font-mono text-[13px] leading-snug",
            )}
          >
            {row.value}
          </span>
        )}
      </dd>
    </div>
  );
}

function NotificationDetailPage() {
  const { notificationId } = Route.useParams();
  const { t, locale } = useI18n();
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const notification = useMemo(
    () =>
      txQuery.data ? findNotification(txQuery.data, notificationId, t) : undefined,
    [txQuery.data, notificationId, t, locale],
  );

  useEffect(() => {
    if (notificationId) markNotificationRead(notificationId);
  }, [notificationId]);

  return (
    <UserShell title={t("notif.detailTitle")} back="/app/notifications">
      {txQuery.isLoading ? (
        <div className="inset-group px-4 py-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : !notification ? (
        <div className="inset-group px-4 py-10 text-center">
          <p className="text-[16px] font-medium">{t("notif.notFound")}</p>
          <Link to="/app/notifications" className="mt-2 inline-block text-[14px] text-brand">
            {t("notif.back")}
          </Link>
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          <section className="inset-group min-w-0 overflow-hidden p-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-[18px] font-semibold">{notification.title}</h2>
                <p className="mt-1 break-words text-[14px] text-muted-foreground">
                  {notification.body}
                </p>
              </div>
              <StatusChip status={notification.status} className="shrink-0" />
            </div>
            <p
              className={cn(
                "tabular mt-4 break-all text-[28px] font-bold tracking-tight",
                notification.credit ? "text-success" : "text-foreground",
              )}
            >
              {notification.credit ? "+" : "−"} {formatNPR(notification.amount)}
            </p>
          </section>

          <section className="inset-group min-w-0 overflow-hidden">
            <dl>
              {notification.details.map((row) => (
                <DetailRow key={row.label} row={row} />
              ))}
            </dl>
          </section>
        </div>
      )}
    </UserShell>
  );
}
