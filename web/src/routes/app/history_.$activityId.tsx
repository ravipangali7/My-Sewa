import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import {
  Check,
  Clock,
  ExternalLink,
  FileDown,
  ImageIcon,
  X,
} from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { buildActivityStatement } from "@/lib/activity";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { STATUS_TONE, type StatusKey } from "@/constants/colors";

export const Route = createFileRoute("/app/history_/$activityId")({
  head: () => ({
    meta: [
      { title: "Transaction Statement — MySewa" },
      {
        name: "description",
        content: "Detailed banking-style statement for a MySewa wallet transaction.",
      },
    ],
  }),
  component: HistoryStatementPage,
});

function statusHeadlineKey(status: string): MessageKey {
  const key = status.toLowerCase();
  if (key === "success" || key === "approved") return "history.successTitle";
  if (key === "failed") return "history.failedTitle";
  if (key === "rejected") return "history.rejectedTitle";
  return "history.pendingTitle";
}

function StatementRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#E5E5EA] py-3.5 last:border-0">
      <dt className="shrink-0 text-[14px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-[14px] font-medium break-words text-foreground">
        {children}
      </dd>
    </div>
  );
}

function HistoryStatementPage() {
  const { activityId } = Route.useParams();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { logoUrl } = useSiteBranding();
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const statement = useMemo(
    () =>
      txQuery.data
        ? buildActivityStatement(txQuery.data, activityId, t, user?.phone)
        : undefined,
    [txQuery.data, activityId, t, locale, user?.phone],
  );

  const tone = statement
    ? (STATUS_TONE[statement.item.status.toLowerCase() as StatusKey] ?? "warning")
    : "warning";

  const toneIconClass =
    tone === "success"
      ? "bg-brand text-white"
      : tone === "danger"
        ? "bg-danger text-white"
        : "bg-warning text-white";

  const pageTitle = statement
    ? t(statusHeadlineKey(statement.item.status))
    : t("history.detailTitle");

  return (
    <UserShell title={pageTitle} back="/app/history" hideHeader>
      {txQuery.isLoading ? (
        <div className="inset-group mx-4 mt-4 px-4 py-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : !statement ? (
        <div className="inset-group mx-4 mt-4 px-4 py-10 text-center">
          <p className="text-[16px] font-medium">{t("history.notFound")}</p>
          <Link to="/app/history" className="mt-2 inline-block text-[14px] text-brand">
            {t("history.back")}
          </Link>
        </div>
      ) : (
        <article className="relative mx-auto min-h-[calc(100dvh-7rem)] max-w-lg bg-surface px-5 pb-8 pt-[max(20px,var(--safe-area-top,env(safe-area-inset-top,0px)))] sm:px-8 print:min-h-0 print:max-w-none">
          {/* Faint brand watermark */}
          <img
            src={logoUrl}
            alt=""
            aria-hidden
            className="pointer-events-none absolute bottom-24 left-1/2 size-[260px] -translate-x-1/2 object-contain opacity-[0.07] select-none print:hidden"
          />

          <div className="relative flex flex-col items-center">
            <h1 className="text-center text-[20px] font-semibold tracking-tight text-foreground">
              {pageTitle}
            </h1>
            <span
              className={cn(
                "mt-6 flex size-[80px] items-center justify-center rounded-full shadow-sm",
                toneIconClass,
              )}
              aria-hidden
            >
              {tone === "success" ? (
                <Check className="size-10 stroke-[2.75]" />
              ) : tone === "danger" ? (
                <X className="size-10 stroke-[2.75]" />
              ) : (
                <Clock className="size-10 stroke-[2.75]" />
              )}
            </span>
          </div>

          <div className="relative mt-8 mb-1 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-semibold text-brand">
              {t("history.transactionDetails")}
            </h2>
            <button
              type="button"
              onClick={() => window.print()}
              aria-label={t("history.downloadStatement")}
              className="inline-flex size-9 items-center justify-center rounded-lg text-brand transition-colors hover:bg-brand-soft print:hidden"
            >
              <FileDown className="size-5" />
            </button>
          </div>

          <dl className="relative">
            {statement.details.map((row, index) => (
              <StatementRow key={`${row.label}-${index}`} label={row.label}>
                <span
                  className={cn(
                    row.mono && "font-mono text-[13px]",
                    row.danger && "text-danger",
                  )}
                >
                  {row.value}
                </span>
              </StatementRow>
            ))}
          </dl>

          {statement.item.kind === "deposit" && (
            <section className="relative mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-semibold text-brand">
                  {t("history.sectionProof")}
                </h3>
                {statement.proofUrl ? (
                  <a
                    href={statement.proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brand hover:underline"
                  >
                    {t("history.openFullSize")}
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </div>
              {statement.proofUrl ? (
                <a
                  href={statement.proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-xl border border-border bg-muted/40"
                >
                  <img
                    src={statement.proofUrl}
                    alt=""
                    className="mx-auto max-h-[280px] w-full object-contain"
                  />
                </a>
              ) : (
                <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 text-muted-foreground">
                  <ImageIcon className="size-6 opacity-50" />
                  <p className="text-sm">{t("history.noProof")}</p>
                </div>
              )}
            </section>
          )}

          <div className="relative mt-8">
            <Link
              to="/app/history"
              className="flex h-12 w-full items-center justify-center rounded-xl bg-brand text-[16px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark print:hidden"
            >
              {t("history.done")}
            </Link>
          </div>
        </article>
      )}
    </UserShell>
  );
}
