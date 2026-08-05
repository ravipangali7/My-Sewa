import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Hash,
  Landmark,
  LockKeyhole,
  Phone,
  ReceiptText,
  ShieldCheck,
  Share2,
  UserRound,
  Check,
  ExternalLink,
  FileDown,
  ImageIcon,
  Loader2,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { buildActivityStatement } from "@/lib/activity";
import { downloadReceiptFromElement, shareReceiptFromElement } from "@/lib/statement-pdf";
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

/** Stacked on mobile; side-by-side from md. Labels wrap; values break-all. */
function DetailKv({
  label,
  value,
  icon,
  success,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  success?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border/60 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:items-start md:gap-3">
      <dt className="flex min-w-0 items-start gap-2 text-[13px] text-foreground/85">
        {icon ? (
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft/50 text-brand-dark">
            {icon}
          </span>
        ) : null}
        <span className={cn("min-w-0 break-words", icon && "pt-1")}>{label}</span>
      </dt>
      <dd
        className={cn(
          "min-w-0 break-all text-[14px] font-semibold",
          icon ? "pl-9 md:pl-0 md:text-right" : "md:text-right",
          success && "text-brand",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function SettlementRow({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 rounded-xl border border-border/70 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3">
      <span className="min-w-0 break-words text-muted-foreground">{label}</span>
      <span
        className={cn(
          "break-all font-semibold tabular-nums md:text-right",
          emphasize && "text-brand-dark",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function HistoryStatementPage() {
  const { activityId } = Route.useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const { logoUrl } = useSiteBranding();
  const receiptRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const statement = useMemo(
    () =>
      txQuery.data ? buildActivityStatement(txQuery.data, activityId, t, user?.phone) : undefined,
    [txQuery.data, activityId, t, user?.phone],
  );

  const tone = statement
    ? (STATUS_TONE[statement.item.status.toLowerCase() as StatusKey] ?? "warning")
    : "warning";

  const pageTitle = statement
    ? t(statusHeadlineKey(statement.item.status))
    : t("history.detailTitle");
  const summaryMeta = statement
    ? {
        dateTime: statement.details.find((r) => r.label === t("history.dateTime"))?.value ?? "—",
        channel: statement.details.find((r) => r.label === t("history.channel"))?.value ?? "—",
        service: statement.details.find((r) => r.label === t("history.serviceName"))?.value ?? "—",
        reference:
          statement.details.find((r) => r.label === t("history.referenceCode"))?.value ??
          statement.reference,
      }
    : undefined;

  const detailMap = useMemo(() => {
    if (!statement) return new Map<string, string>();
    return new Map(statement.details.map((row) => [row.label, row.value]));
  }, [statement]);

  const receiptNo = useMemo(() => {
    if (!statement) return "—";
    const dateChunk = statement.item.created_at.slice(0, 10).replaceAll("-", "");
    const refChunk = (summaryMeta?.reference ?? statement.reference).replace(/\W/g, "").slice(-4);
    return `MS-${dateChunk}-${refChunk || "0000"}`;
  }, [statement, summaryMeta?.reference]);

  const amountNpr = detailMap.get(t("common.amountNpr")) ?? statement?.headlineAmount ?? "—";
  const chargeNpr = detailMap.get(t("common.charge")) ?? "Rs. 0.00";
  const cashbackNpr = detailMap.get(t("common.cashback")) ?? "Rs. 0.00";
  const balanceBeforeNpr = detailMap.get(t("history.balanceBefore"));
  const balanceAfterNpr = detailMap.get(t("history.balanceAfter"));
  const totalNpr =
    detailMap.get(t("history.totalCredited")) ??
    detailMap.get(t("common.totalDebited")) ??
    statement?.headlineAmount ??
    "—";

  const summaryLabels = useMemo(
    () =>
      new Set([
        t("history.referenceCode"),
        t("history.dateTime"),
        t("history.channel"),
        t("common.amountNpr"),
        t("common.charge"),
        t("common.cashback"),
        t("history.totalCredited"),
        t("common.totalDebited"),
        t("history.balanceBefore"),
        t("history.balanceAfter"),
      ]),
    [t],
  );

  const iconForLabel = (label: string) => {
    if (label === t("common.status")) return <CheckCircle2 className="size-4" />;
    if (
      label === t("remittance.sender") ||
      label === t("remittance.receiver") ||
      label === t("history.initiator") ||
      label === t("common.recipient") ||
      label === t("internet.customerName")
    ) {
      return <UserRound className="size-4" />;
    }
    if (
      label === t("remittance.receiverPhone") ||
      label === t("history.destPhone") ||
      label === t("history.paymentAttribute") ||
      label === t("common.mobile")
    ) {
      return <Phone className="size-4" />;
    }
    if (label === t("remittance.purpose") || label === t("internet.currentPackage")) {
      return <Tag className="size-4" />;
    }
    if (label === t("history.merchantTxn") || label === t("common.bank")) {
      return <Landmark className="size-4" />;
    }
    if (label === t("history.providerTxn") || label === t("history.verified")) {
      return <ShieldCheck className="size-4" />;
    }
    if (label === t("history.reference") || label === t("internet.customerId")) {
      return <Hash className="size-4" />;
    }
    return <ReceiptText className="size-4" />;
  };

  const transactionRows = statement
    ? statement.details
        .filter((row) => !summaryLabels.has(row.label) && row.value && row.value !== "—")
        .map((row) => ({
          label: row.label,
          value: row.value,
          icon: iconForLabel(row.label),
          success:
            row.label === t("common.status") &&
            (statement.item.status.toLowerCase() === "success" ||
              statement.item.status.toLowerCase() === "approved"),
        }))
    : [];

  async function handleDownloadPdf() {
    if (!statement || !receiptRef.current || downloading || sharing) return;
    setDownloading(true);
    try {
      await downloadReceiptFromElement({
        element: receiptRef.current,
        reference: statement.reference,
      });
    } catch {
      toast.error(t("history.downloadPdfFailed"));
    } finally {
      setDownloading(false);
    }
  }

  async function handleShare() {
    if (!statement || !receiptRef.current || downloading || sharing) return;
    setSharing(true);
    try {
      await shareReceiptFromElement({
        element: receiptRef.current,
        reference: statement.reference,
      });
    } catch {
      toast.error(t("history.shareFailed"));
    } finally {
      setSharing(false);
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
        <article className="relative mx-auto w-full min-w-0 max-w-4xl overflow-x-clip bg-gradient-to-b from-background to-muted/20 px-3 pb-8 pt-[max(16px,var(--safe-area-top,env(safe-area-inset-top,0px)))] sm:px-6 print:max-w-none">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2 print:hidden sm:gap-3">
            <Link
              to="/app/history"
              className="shrink-0 text-[14px] font-semibold text-brand"
            >
              {t("history.back")}
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void handleShare()}
                disabled={sharing || downloading}
                aria-label={t("history.share")}
                title={t("history.share")}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-brand/25 bg-brand-soft/60 px-2.5 text-[13px] font-semibold text-brand-dark transition-colors hover:bg-brand-soft disabled:opacity-60 sm:px-3"
              >
                {sharing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Share2 className="size-4" />
                )}
                <span className="hidden sm:inline">{t("history.share")}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                disabled={downloading || sharing}
                aria-label={t("history.downloadPdf")}
                title={t("history.downloadPdf")}
                className="inline-flex size-9 items-center justify-center rounded-xl border border-border/70 bg-background text-brand transition-colors hover:bg-brand-soft disabled:opacity-60"
              >
                {downloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileDown className="size-4" />
                )}
              </button>
            </div>
          </div>

          <div
            ref={receiptRef}
            className="min-w-0 overflow-x-clip rounded-[22px] border border-brand/15 bg-card shadow-[0_18px_45px_-26px_rgba(2,8,23,0.45)] sm:rounded-[28px]"
          >
            <div className="grid min-w-0 border-b border-border/70 md:grid-cols-2">
              <div className="flex min-w-0 items-center gap-2.5 bg-white px-3 py-3.5 sm:gap-3 sm:px-4 sm:py-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-brand/20 bg-brand-soft/70 p-1.5 sm:size-12">
                  <img src={logoUrl} alt="MySewa" className="size-full object-contain" />
                </div>
                <div className="min-w-0">
                  <p className="text-[28px] leading-none font-black tracking-tight text-brand-dark sm:text-[36px]">
                    My<span className="text-primary">Sewa</span>
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-muted-foreground sm:text-[12px]">
                    Your Trusted Digital Wallet
                  </p>
                </div>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2 bg-gradient-to-r from-brand-dark to-brand px-3 py-3.5 text-white sm:gap-3 sm:px-4 sm:py-4">
                <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/10 sm:size-11">
                    {tone === "success" ? (
                      <Check className="size-5 stroke-[2.8] sm:size-7" />
                    ) : tone === "danger" ? (
                      <X className="size-5 stroke-[2.8] sm:size-7" />
                    ) : (
                      <Clock3 className="size-5 stroke-[2.8] sm:size-7" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold tracking-[0.08em] uppercase sm:text-xs">
                      Transaction
                    </p>
                    <p className="break-words text-[20px] leading-tight font-black uppercase sm:text-[28px] sm:leading-none">
                      {statement.item.status}
                    </p>
                    <p className="text-[11px] text-white/85 sm:text-xs">Thank you for using MySewa</p>
                  </div>
                </div>
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/40 bg-white/10 sm:size-12">
                  <LockKeyhole className="size-5 sm:size-6" />
                </span>
              </div>
            </div>

            {/* Task 8: prominent amount — full-width hero; scales down on narrow viewports */}
            <div className="min-w-0 border-b border-border/70 bg-gradient-to-br from-brand-soft/80 via-white to-white px-3 py-5 text-center sm:px-6">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-brand-dark/70 uppercase sm:text-[12px]">
                {t("common.amountNpr")}
              </p>
              <p
                className={cn(
                  "mt-2 break-all tabular-nums text-[32px] leading-none font-black tracking-tight sm:text-[44px]",
                  statement.item.credit ? "text-success" : "text-brand-dark",
                )}
              >
                {statement.item.credit ? "+" : "−"} {amountNpr}
              </p>
              <p className="mt-2 break-words text-[13px] font-medium text-muted-foreground">
                {statement.item.credit
                  ? t("history.totalCredited")
                  : t("common.totalDebited")}
                :{" "}
                <span className="break-all font-semibold text-foreground tabular-nums">
                  {totalNpr}
                </span>
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 border-b border-border/70 bg-background p-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0 rounded-xl border border-border/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                  {t("history.dateTime")}
                </p>
                <p className="mt-1 break-words text-[13px] font-semibold">{summaryMeta?.dateTime}</p>
              </div>
              <div className="min-w-0 rounded-xl border border-border/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                  {t("history.referenceCode")}
                </p>
                <p className="mt-1 break-all text-[13px] font-semibold">{summaryMeta?.reference}</p>
              </div>
              <div className="min-w-0 rounded-xl border border-border/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                  {t("history.channel")}
                </p>
                <p className="mt-1 break-words text-[13px] font-semibold">{summaryMeta?.channel}</p>
              </div>
              <div className="min-w-0 rounded-xl border border-border/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                  Receipt No.
                </p>
                <p className="mt-1 break-all text-[13px] font-semibold">{receiptNo}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
              <section className="min-w-0 overflow-x-clip rounded-2xl border border-brand/20 bg-white">
                <div className="border-b border-brand/15 bg-brand-soft/40 px-3 py-3 sm:px-4">
                  <p className="text-[12px] font-semibold tracking-wide text-brand-dark uppercase">
                    Settlement
                  </p>
                </div>
                <div className="space-y-2 px-3 py-3 text-[14px]">
                  <SettlementRow label={t("common.amountNpr")} value={amountNpr} emphasize />
                  <SettlementRow label={t("common.charge")} value={chargeNpr} />
                  <SettlementRow label={t("common.cashback")} value={cashbackNpr} />
                  {balanceBeforeNpr ? (
                    <SettlementRow label={t("history.balanceBefore")} value={balanceBeforeNpr} />
                  ) : null}
                  {balanceAfterNpr ? (
                    <SettlementRow label={t("history.balanceAfter")} value={balanceAfterNpr} />
                  ) : null}
                  <div className="rounded-xl border border-brand/25 bg-brand-soft/50 px-3 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                      {statement.item.credit
                        ? t("history.totalCredited")
                        : t("common.totalDebited")}
                    </p>
                    <p className="mt-1 break-all text-[24px] leading-none font-black text-brand-dark tabular-nums sm:text-[30px]">
                      {totalNpr}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 rounded-xl border border-brand/20 bg-brand-soft/45 px-3 py-2 text-[12px] font-medium text-brand-dark sm:items-center sm:text-[13px]">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 sm:mt-0" />
                    <span className="min-w-0 break-words">
                      Your transaction is 100% secure and encrypted
                    </span>
                  </div>
                </div>
              </section>

              <section className="min-w-0 overflow-x-clip rounded-2xl border border-border/70 bg-white">
                <div className="border-b border-border/70 bg-muted/35 px-3 py-2.5">
                  <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold tracking-wide text-brand-dark uppercase">
                    <ReceiptText className="size-4 shrink-0" />
                    <span className="min-w-0 break-words">{t("history.transactionDetails")}</span>
                  </h2>
                </div>
                <dl className="px-3 py-1">
                  {transactionRows.map((row) => (
                    <DetailKv
                      key={row.label}
                      label={row.label}
                      value={row.value}
                      icon={row.icon}
                      success={row.success}
                    />
                  ))}
                </dl>
              </section>
            </div>

            <div className="grid grid-cols-1 gap-2 border-t border-border/70 bg-background px-3 py-3 text-[12px] md:grid-cols-2 lg:grid-cols-5">
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <ShieldCheck className="size-4 shrink-0 text-brand" />
                <span className="min-w-0 break-words">Secure transactions</span>
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <Clock3 className="size-4 shrink-0 text-brand" />
                <span className="min-w-0 break-words">Fast transfer</span>
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <Hash className="size-4 shrink-0 text-brand" />
                <span className="min-w-0 break-words">Scan MySewa App</span>
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <Phone className="size-4 shrink-0 text-brand" />
                <span className="min-w-0 break-words">24/7 support</span>
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <BadgeCheck className="size-4 shrink-0 text-brand" />
                <span className="min-w-0 break-words">Reliable service</span>
              </div>
            </div>
          </div>

          {statement.item.kind === "deposit" && (
            <section className="relative mt-5 min-w-0 overflow-x-clip rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
              <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2 sm:gap-3">
                <h3 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold tracking-[0.04em] text-brand/95 uppercase">
                  <ImageIcon className="size-4 shrink-0" />
                  <span className="min-w-0 break-words">{t("history.sectionProof")}</span>
                </h3>
                {statement.proofUrl ? (
                  <a
                    href={statement.proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-brand hover:underline"
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
                  className="block overflow-x-clip rounded-xl border border-border bg-muted/40 shadow-sm"
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
