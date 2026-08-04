import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Check,
  Clock,
  ExternalLink,
  FileDown,
  Hash,
  ImageIcon,
  Landmark,
  Loader2,
  Phone,
  ReceiptText,
  ShieldCheck,
  Tag,
  UserRound,
  Wallet,
  X,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { buildActivityStatement } from "@/lib/activity";
import { downloadStatementPdf } from "@/lib/statement-pdf";
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

function canViewStatement(status: string) {
  const normalized = status.toLowerCase();
  return normalized === "success" || normalized === "approved";
}

function StatementRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-4 last:border-0">
      <dt className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium tracking-wide text-muted-foreground/90">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </dt>
      <dd className="min-w-0 text-right text-[14px] font-semibold break-words text-foreground">
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
  const [downloading, setDownloading] = useState(false);
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
      ? "bg-brand text-white shadow-[0_10px_30px_-12px_rgba(17,143,85,0.85)]"
      : tone === "danger"
        ? "bg-danger text-white shadow-[0_10px_30px_-12px_rgba(220,38,38,0.75)]"
        : "bg-warning text-white shadow-[0_10px_30px_-12px_rgba(217,119,6,0.75)]";

  const toneBadgeClass =
    tone === "success"
      ? "border-brand/25 bg-brand-soft text-brand"
      : tone === "danger"
        ? "border-danger/20 bg-danger/10 text-danger"
        : "border-warning/25 bg-warning/15 text-warning";

  const pageTitle = statement
    ? t(statusHeadlineKey(statement.item.status))
    : t("history.detailTitle");
  const viewAllowed = statement ? canViewStatement(statement.item.status) : false;

  const summaryMeta = statement
    ? {
        dateTime: statement.details.find((r) => r.label === t("history.dateTime"))?.value ?? "—",
        channel: statement.details.find((r) => r.label === t("history.channel"))?.value ?? "—",
        service: statement.details.find((r) => r.label === t("history.serviceName"))?.value ?? "—",
      }
    : undefined;

  function detailIcon(label: string) {
    const byLabel: Record<string, ReactNode> = {
      [t("history.referenceCode")]: <Hash className="size-4" />,
      [t("history.dateTime")]: <CalendarDays className="size-4" />,
      [t("history.channel")]: <ShieldCheck className="size-4" />,
      [t("history.serviceName")]: <ReceiptText className="size-4" />,
      [t("history.paymentAttribute")]: <Phone className="size-4" />,
      [t("common.status")]: <BadgeCheck className="size-4" />,
      [t("common.amountNpr")]: <Wallet className="size-4" />,
      [t("common.charge")]: <CircleDollarSign className="size-4" />,
      [t("common.cashback")]: <Tag className="size-4" />,
      [t("common.totalDebited")]: <Landmark className="size-4" />,
      [t("history.totalCredited")]: <Landmark className="size-4" />,
      [t("history.merchantTxn")]: <Hash className="size-4" />,
      [t("history.providerTxn")]: <Hash className="size-4" />,
      [t("history.reference")]: <Hash className="size-4" />,
      [t("history.initiator")]: <UserRound className="size-4" />,
    };
    return byLabel[label] ?? <ReceiptText className="size-4" />;
  }

  async function handleDownloadPdf() {
    if (!statement || downloading) return;
    setDownloading(true);
    try {
      await downloadStatementPdf({
        statement,
        title: pageTitle,
        detailsHeading: t("history.transactionDetails"),
        logoUrl,
        brandName: t("history.statementBrand"),
      });
    } catch {
      toast.error(t("history.downloadPdfFailed"));
    } finally {
      setDownloading(false);
    }
  }

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
        <article className="relative mx-auto min-h-[calc(100dvh-7rem)] max-w-xl bg-gradient-to-b from-background to-muted/25 px-4 pb-8 pt-[max(16px,var(--safe-area-top,env(safe-area-inset-top,0px)))] sm:px-6 print:min-h-0 print:max-w-none">
          {/* Faint circular brand watermark over transaction details */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-24 left-1/2 size-[260px] -translate-x-1/2 overflow-hidden rounded-full select-none print:hidden"
          >
            <img
              src={logoUrl}
              alt=""
              className="size-full object-cover opacity-[0.06]"
            />
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-card p-5 shadow-[0_18px_45px_-28px_rgba(2,8,23,0.35)] sm:p-7">
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-brand/10 via-brand/5 to-transparent"
            />
            <div className="relative flex flex-col items-center text-center">
              <span
                className={cn(
                  "flex size-[82px] items-center justify-center rounded-full ring-4 ring-white/70",
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
              <h1 className="mt-4 text-balance text-[24px] font-semibold tracking-tight text-foreground sm:text-[28px]">
                {pageTitle}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">{statement.amountCaption}</p>
              <p className="mt-1 text-[32px] font-semibold tracking-tight text-foreground sm:text-[36px]">
                {statement.headlineAmount}
              </p>
              <div
                className={cn(
                  "mt-4 inline-flex rounded-full border px-3 py-1 text-[12px] font-semibold tracking-wide",
                  toneBadgeClass,
                )}
              >
                {statement.item.status}
              </div>
            </div>

            <div className="relative mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-background p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  {t("history.dateTime")}
                </div>
                <p className="text-sm font-semibold text-foreground">{summaryMeta?.dateTime}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  {t("history.channel")}
                </div>
                <p className="text-sm font-semibold text-foreground">{summaryMeta?.channel}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background p-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ReceiptText className="size-3.5" />
                  {t("history.serviceName")}
                </div>
                <p className="text-sm font-semibold text-foreground">{summaryMeta?.service}</p>
              </div>
            </div>

            {!viewAllowed ? (
              <div className="relative mt-7 rounded-2xl border border-warning/30 bg-warning/10 p-4">
                <div className="flex items-start gap-3">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/20 text-warning">
                    <ShieldAlert className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t("history.viewLockedTitle")}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">{t("history.viewLockedBody")}</p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="relative mt-8 mb-2 flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold tracking-[0.04em] text-brand/95 uppercase">
                {t("history.transactionDetails")}
              </h2>
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                disabled={downloading || !viewAllowed}
                aria-label={t("history.downloadPdf")}
                title={t("history.downloadPdf")}
                className="inline-flex size-10 items-center justify-center rounded-xl border border-border/70 bg-background/90 text-brand transition-colors hover:bg-brand-soft disabled:opacity-60 print:hidden"
              >
                {downloading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <FileDown className="size-5" />
                )}
              </button>
            </div>

            {viewAllowed ? (
              <dl className="relative rounded-2xl border border-border/70 bg-background px-4 sm:px-5">
                {statement.details.map((row, index) => (
                  <StatementRow
                    key={`${row.label}-${index}`}
                    label={row.label}
                    icon={detailIcon(row.label)}
                  >
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
            ) : (
              <div className="relative rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">{t("history.viewLockedTitle")}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{t("history.viewLockedBody")}</p>
              </div>
            )}
          </div>

          {viewAllowed && statement.item.kind === "deposit" && (
            <section className="relative mt-5 rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.04em] text-brand/95 uppercase">
                  <ImageIcon className="size-4" />
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
                  className="block overflow-hidden rounded-xl border border-border bg-muted/40 shadow-sm"
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

          <div className="relative mt-6">
            <Link
              to="/app/history"
              className="flex h-12 w-full items-center justify-center rounded-xl bg-brand text-[16px] font-semibold text-white shadow-[0_10px_25px_-10px_rgba(17,143,85,0.9)] transition-colors hover:bg-brand-dark print:hidden"
            >
              {t("history.done")}
            </Link>
          </div>
        </article>
      )}
    </UserShell>
  );
}
