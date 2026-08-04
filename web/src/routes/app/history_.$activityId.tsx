import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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

function HistoryStatementPage() {
  const { activityId } = Route.useParams();
  const { t } = useI18n();
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
  const totalNpr =
    detailMap.get(t("history.totalCredited")) ??
    detailMap.get(t("common.totalDebited")) ??
    statement?.headlineAmount ??
    "—";

  const transactionRows = statement
    ? [
        {
          label: t("history.serviceName"),
          value: detailMap.get(t("history.serviceName")) ?? "—",
          icon: <ReceiptText className="size-4" />,
        },
        {
          label: t("common.status"),
          value: statement.item.status,
          icon: <CheckCircle2 className="size-4" />,
          success:
            statement.item.status.toLowerCase() === "success" ||
            statement.item.status.toLowerCase() === "approved",
        },
        {
          label: t("remittance.sender"),
          value: detailMap.get(t("remittance.sender")) ?? "—",
          icon: <UserRound className="size-4" />,
        },
        {
          label: t("remittance.receiver"),
          value: detailMap.get(t("remittance.receiver")) ?? "—",
          icon: <UserRound className="size-4" />,
        },
        {
          label: t("remittance.receiverPhone"),
          value: detailMap.get(t("remittance.receiverPhone")) ?? "—",
          icon: <Phone className="size-4" />,
        },
        {
          label: t("remittance.purpose"),
          value: detailMap.get(t("remittance.purpose")) ?? "—",
          icon: <Tag className="size-4" />,
        },
        {
          label: t("history.merchantTxn"),
          value: detailMap.get(t("history.merchantTxn")) ?? "—",
          icon: <Landmark className="size-4" />,
        },
        {
          label: t("history.providerTxn"),
          value: detailMap.get(t("history.providerTxn")) ?? "—",
          icon: <ShieldCheck className="size-4" />,
        },
        {
          label: t("history.reference"),
          value: detailMap.get(t("history.reference")) ?? summaryMeta?.reference ?? "—",
          icon: <Hash className="size-4" />,
        },
        {
          label: t("history.initiator"),
          value: detailMap.get(t("history.initiator")) ?? "—",
          icon: <UserRound className="size-4" />,
        },
      ]
    : [];

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
        <article className="relative mx-auto min-h-[calc(100dvh-7rem)] max-w-4xl bg-gradient-to-b from-background to-muted/20 px-3 pb-8 pt-[max(16px,var(--safe-area-top,env(safe-area-inset-top,0px)))] sm:px-6 print:min-h-0 print:max-w-none">
          <div className="overflow-hidden rounded-[28px] border border-brand/15 bg-card shadow-[0_18px_45px_-26px_rgba(2,8,23,0.45)]">
            <div className="grid border-b border-border/70 md:grid-cols-[1.05fr_1.3fr]">
              <div className="flex items-center gap-3 bg-white px-4 py-4">
                <div className="flex size-12 items-center justify-center rounded-full border border-brand/20 bg-brand-soft/70 p-1.5">
                  <img src={logoUrl} alt="MySewa" className="size-full object-contain" />
                </div>
                <div>
                  <p className="text-[36px] leading-none font-black tracking-tight text-brand-dark">
                    My<span className="text-primary">Sewa</span>
                  </p>
                  <p className="text-[12px] font-medium text-muted-foreground">
                    Your Trusted Digital Wallet
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-brand-dark to-brand px-4 py-4 text-white">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-11 items-center justify-center rounded-full border border-white/40 bg-white/10">
                    {tone === "success" ? (
                      <Check className="size-7 stroke-[2.8]" />
                    ) : tone === "danger" ? (
                      <X className="size-7 stroke-[2.8]" />
                    ) : (
                      <Clock3 className="size-7 stroke-[2.8]" />
                    )}
                  </span>
                  <div>
                    <p className="text-xs font-semibold tracking-[0.08em] uppercase">Transaction</p>
                    <p className="text-[28px] leading-none font-black uppercase">
                      {statement.item.status}
                    </p>
                    <p className="text-xs text-white/85">Thank you for using MySewa</p>
                  </div>
                </div>
                <span className="inline-flex size-12 items-center justify-center rounded-xl border border-white/40 bg-white/10">
                  <LockKeyhole className="size-6" />
                </span>
              </div>
            </div>

            <div className="grid gap-2 border-b border-border/70 bg-background p-3 sm:grid-cols-2 md:grid-cols-4">
              <div className="rounded-xl border border-border/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                  {t("history.dateTime")}
                </p>
                <p className="mt-1 text-[13px] font-semibold">{summaryMeta?.dateTime}</p>
              </div>
              <div className="rounded-xl border border-border/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                  {t("history.referenceCode")}
                </p>
                <p className="mt-1 break-all text-[13px] font-semibold">{summaryMeta?.reference}</p>
              </div>
              <div className="rounded-xl border border-border/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                  {t("history.channel")}
                </p>
                <p className="mt-1 text-[13px] font-semibold">{summaryMeta?.channel}</p>
              </div>
              <div className="rounded-xl border border-border/70 px-3 py-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                  Receipt No.
                </p>
                <p className="mt-1 text-[13px] font-semibold">{receiptNo}</p>
              </div>
            </div>

            <div className="grid gap-3 p-3 md:grid-cols-[0.8fr_1.4fr]">
              <section className="overflow-hidden rounded-2xl border border-brand/20 bg-white">
                <div className="bg-gradient-to-r from-brand-dark to-brand px-4 py-3 text-white">
                  <p className="text-[12px] font-semibold uppercase">{t("common.amountNpr")}</p>
                  <p className="mt-1 text-[38px] leading-none font-black">{amountNpr}</p>
                </div>
                <div className="space-y-2 px-3 py-3 text-[14px]">
                  <div className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2">
                    <span className="text-muted-foreground">{t("common.amountNpr")}</span>
                    <span className="font-semibold text-brand-dark">{amountNpr}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2">
                    <span className="text-muted-foreground">{t("common.charge")}</span>
                    <span className="font-semibold">{chargeNpr}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2">
                    <span className="text-muted-foreground">{t("common.cashback")}</span>
                    <span className="font-semibold">{cashbackNpr}</span>
                  </div>
                  <div className="rounded-xl border border-brand/25 bg-brand-soft/50 px-3 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                      {statement.item.credit
                        ? t("history.totalCredited")
                        : t("common.totalDebited")}
                    </p>
                    <p className="mt-1 text-[30px] leading-none font-black text-brand-dark">
                      {totalNpr}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-brand/20 bg-brand-soft/45 px-3 py-2 text-[13px] font-medium text-brand-dark">
                    <ShieldCheck className="size-4" />
                    Your transaction is 100% secure and encrypted
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-border/70 bg-white">
                <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/35 px-3 py-2.5">
                  <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-brand-dark uppercase">
                    <ReceiptText className="size-4" />
                    {t("history.transactionDetails")}
                  </h2>
                  <button
                    type="button"
                    onClick={() => void handleDownloadPdf()}
                    disabled={downloading}
                    aria-label={t("history.downloadPdf")}
                    title={t("history.downloadPdf")}
                    className="inline-flex size-8 items-center justify-center rounded-lg border border-border/70 bg-background text-brand transition-colors hover:bg-brand-soft disabled:opacity-60 print:hidden"
                  >
                    {downloading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FileDown className="size-4" />
                    )}
                  </button>
                </div>
                <dl className="px-3 py-1">
                  {transactionRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-start justify-between gap-3 border-b border-border/60 py-3 last:border-b-0"
                    >
                      <dt className="flex min-w-0 items-center gap-2 text-[13px] text-foreground/85">
                        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft/50 text-brand-dark">
                          {row.icon}
                        </span>
                        <span className="truncate">{row.label}</span>
                      </dt>
                      <dd
                        className={cn(
                          "max-w-[62%] break-all text-right text-[14px] font-semibold",
                          row.success && "text-brand",
                        )}
                      >
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>

            <div className="grid gap-2 border-t border-border/70 bg-background px-3 py-3 text-[12px] sm:grid-cols-2 md:grid-cols-5">
              <div className="flex items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <ShieldCheck className="size-4 text-brand" />
                <span>Secure transactions</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <Clock3 className="size-4 text-brand" />
                <span>Fast transfer</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <Hash className="size-4 text-brand" />
                <span>Scan MySewa App</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <Phone className="size-4 text-brand" />
                <span>24/7 support</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border/70 px-2.5 py-2">
                <BadgeCheck className="size-4 text-brand" />
                <span>Reliable service</span>
              </div>
            </div>
          </div>

          {statement.item.kind === "deposit" && (
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
