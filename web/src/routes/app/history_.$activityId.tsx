import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  CalendarClock,
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
  Wallet,
  X,
  Coins,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { buildActivityStatement } from "@/lib/activity";
import { downloadReceiptFromElement, shareReceiptFromElement } from "@/lib/statement-pdf";
import { liveQueryOptions } from "@/lib/refresh";
import { cn } from "@/lib/utils";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { userServiceChargeLabels } from "@/lib/user-charge";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { STATUS_TONE, type StatusKey } from "@/constants/colors";

export const Route = createFileRoute("/app/history_/$activityId")({
  head: () => ({
    meta: [
      { title: "Transaction Statement — MySewa" },
      {
        name: "description",
        content: "Detailed banking-style statement for a MySewa business wallet transaction.",
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

function DetailKv({
  label,
  value,
  icon,
  success,
  danger,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  success?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border/50 py-3.5 last:border-b-0">
      {icon ? (
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-dark">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <dt className="text-[12px] font-medium text-muted-foreground">{label}</dt>
        <dd
          className={cn(
            "mt-0.5 break-words text-[15px] font-semibold text-foreground",
            success && "text-brand",
            danger && "text-destructive",
          )}
        >
          {value}
        </dd>
      </div>
    </div>
  );
}

function SettlementRow({
  label,
  value,
  icon,
  debit,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  debit?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
        {icon}
      </span>
      <span className="min-w-0 flex-1 break-words text-[14px] text-foreground/80">{label}</span>
      <span
        className={cn(
          "shrink-0 break-all text-right text-[14px] font-semibold tabular-nums",
          debit ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function WalletBalanceCard({
  before,
  after,
  credit,
  labels,
}: {
  before: string;
  after: string;
  credit: boolean;
  labels: {
    title: string;
    before: string;
    after: string;
    delta: string;
  };
}) {
  const parseAmount = (raw: string) => {
    const n = Number(String(raw).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const beforeN = parseAmount(before);
  const afterN = parseAmount(after);
  const delta =
    beforeN != null && afterN != null ? afterN - beforeN : null;
  const deltaDisplay =
    delta == null
      ? null
      : `${delta >= 0 ? "+" : "−"}Rs. ${Math.abs(delta).toLocaleString("en-NP", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

  return (
    <section className="overflow-hidden rounded-[20px] border border-border/50 bg-gradient-to-br from-white via-white to-brand-soft/40 shadow-[0_8px_28px_-18px_rgba(2,8,23,0.28)]">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Wallet className="size-4" />
          </span>
          <p className="text-[12px] font-bold tracking-[0.1em] text-brand uppercase">
            {labels.title}
          </p>
        </div>
        {deltaDisplay ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums",
              credit || (delta != null && delta >= 0)
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700",
            )}
          >
            {labels.delta}: {deltaDisplay}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pb-4 pt-1">
        <div className="min-w-0 rounded-2xl border border-border/50 bg-white/90 px-3 py-3">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {labels.before}
          </p>
          <p className="mt-1 break-all text-[15px] font-bold tabular-nums text-foreground sm:text-[17px]">
            {before}
          </p>
        </div>
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand text-white shadow-sm">
          <ArrowRight className="size-4" />
        </span>
        <div className="min-w-0 rounded-2xl border border-brand/20 bg-brand-soft/60 px-3 py-3">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-brand-dark/70 uppercase">
            {labels.after}
          </p>
          <p className="mt-1 break-all text-[15px] font-black tabular-nums text-brand-dark sm:text-[17px]">
            {after}
          </p>
        </div>
      </div>
    </section>
  );
}

function QuickInfoCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {label}
          </p>
          <p className="mt-1 break-words text-[13px] font-semibold leading-snug text-foreground">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function WalletIllustration({ credit }: { credit: boolean }) {
  return (
    <div className="relative flex size-[88px] shrink-0 items-center justify-center sm:size-[104px]" aria-hidden>
      <div className="absolute inset-0 rounded-full bg-brand-soft/70" />
      <Wallet className="relative size-12 text-brand sm:size-14" strokeWidth={1.5} />
      <span
        className={cn(
          "absolute -right-0.5 -top-0.5 inline-flex size-8 items-center justify-center rounded-full border-2 border-white shadow-sm",
          credit ? "bg-success text-white" : "bg-brand text-white",
        )}
      >
        {credit ? <Coins className="size-4" /> : <Check className="size-4 stroke-[2.5]" />}
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
    ...liveQueryOptions(),
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
  const serviceChargeLabel = userServiceChargeLabels(t).find((label) => detailMap.has(label));
  const serviceChargeNpr = serviceChargeLabel ? detailMap.get(serviceChargeLabel) : undefined;
  const cashbackReturnNpr = detailMap.get(t("common.cashbackReturn"));
  const grossCommissionNpr = detailMap.get(t("history.grossCommission"));
  const tdsChargeRateLabel = statement
    ? [...detailMap.keys()].find((label) => label.startsWith(t("history.tdsCharge")))
    : undefined;
  const tdsChargeNpr = tdsChargeRateLabel ? detailMap.get(tdsChargeRateLabel) : undefined;
  const netCommissionNpr = detailMap.get(t("history.netCommissionCredited"));
  const balanceBeforeNpr = detailMap.get(t("history.balanceBefore"));
  const balanceAfterNpr = detailMap.get(t("history.balanceAfter"));
  const totalNpr =
    netCommissionNpr ??
    cashbackReturnNpr ??
    detailMap.get(t("history.totalCredited")) ??
    detailMap.get(t("common.totalDebited")) ??
    statement?.headlineAmount ??
    "—";
  const hasCommissionBreakdown = Boolean(grossCommissionNpr && tdsChargeNpr && netCommissionNpr);

  const summaryLabels = useMemo(() => {
    const labels = new Set([
      t("history.referenceCode"),
      t("history.dateTime"),
      t("history.channel"),
      t("common.amountNpr"),
      t("common.charge"),
      t("common.himalpayCharge"),
      t("common.cashback"),
      t("common.cashbackCharge"),
      t("common.cashbackReturn"),
      t("history.grossCommission"),
      t("history.tdsCharge"),
      t("history.netCommissionCredited"),
      t("history.totalCredited"),
      t("common.totalDebited"),
      t("history.balanceBefore"),
      t("history.balanceAfter"),
      ...userServiceChargeLabels(t),
    ]);
    if (tdsChargeRateLabel) labels.add(tdsChargeRateLabel);
    return labels;
  }, [t, tdsChargeRateLabel]);

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
    if (
      label === t("history.grossCommission") ||
      label === t("history.netCommissionCredited") ||
      label === t("history.netCommission")
    ) {
      return <Coins className="size-4" />;
    }
    if (userServiceChargeLabels(t).includes(label)) {
      return <Tag className="size-4" />;
    }
    if (label === t("common.himalpayCharge") || label === t("common.cashbackCharge")) {
      return <Tag className="size-4" />;
    }
    if (label === t("common.cashbackReturn") || label === t("activity.cashbackReturn")) {
      return <BadgeCheck className="size-4" />;
    }
    if (label === t("history.tdsCharge") || label.startsWith(t("history.tdsCharge"))) {
      return <Tag className="size-4" />;
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
          danger: Boolean(row.danger),
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
        <article className="relative mx-auto w-full min-w-0 max-w-lg bg-[#F5F7FA] px-3.5 pb-8 pt-[max(12px,var(--content-safe-top,var(--safe-area-top,env(safe-area-inset-top,0px))))] sm:max-w-2xl sm:px-5 print:max-w-none print:bg-white">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2 print:hidden">
            <Link to="/app/history" className="shrink-0 text-[14px] font-semibold text-brand">
              {t("history.back")}
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void handleShare()}
                disabled={sharing || downloading}
                aria-label={t("history.share")}
                title={t("history.share")}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-brand/25 bg-white px-2.5 text-[13px] font-semibold text-brand-dark transition-colors hover:bg-brand-soft disabled:opacity-60"
              >
                {sharing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Share2 className="size-4" />
                )}
                <span className="hidden xs:inline sm:inline">{t("history.share")}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                disabled={downloading || sharing}
                aria-label={t("history.downloadPdf")}
                title={t("history.downloadPdf")}
                className="inline-flex size-9 items-center justify-center rounded-xl border border-border/70 bg-white text-brand transition-colors hover:bg-brand-soft disabled:opacity-60"
              >
                {downloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileDown className="size-4" />
                )}
              </button>
            </div>
          </div>

          <div ref={receiptRef} className="min-w-0 space-y-3.5 overflow-x-clip">
            {/* Brand + status header */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-brand/15 bg-white p-1.5 shadow-sm">
                  <img
                    src={logoUrl || "/logo.png"}
                    alt="MySewa"
                    className="size-full object-contain"
                    decoding="sync"
                    onError={(e) => {
                      const el = e.currentTarget;
                      if (!el.src.includes("/logo.png")) {
                        el.src = "/logo.png";
                      }
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[22px] leading-none font-black tracking-tight text-brand-dark">
                    My<span className="text-primary">Sewa</span>
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                    {t("history.trustedWallet")}
                  </p>
                </div>
              </div>
              <div className="inline-flex max-w-full items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-dark to-brand px-3 py-2.5 text-white shadow-[0_10px_24px_-12px_rgba(10,122,75,0.85)]">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-white/35 bg-white/15">
                  {tone === "success" ? (
                    <Check className="size-4 stroke-[2.8]" />
                  ) : tone === "danger" ? (
                    <X className="size-4 stroke-[2.8]" />
                  ) : (
                    <Clock3 className="size-4 stroke-[2.8]" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="break-words text-[12px] leading-tight font-black tracking-wide uppercase">
                    {pageTitle}
                  </p>
                  <p className="text-[10px] text-white/85">{t("history.thankYou")}</p>
                </div>
                <span className="ml-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/30 bg-white/10">
                  <LockKeyhole className="size-3.5" />
                </span>
              </div>
            </div>

            {/* Amount hero card */}
            <section className="relative overflow-hidden rounded-[20px] border border-border/50 bg-white p-4 shadow-[0_8px_28px_-18px_rgba(2,8,23,0.35)] sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold tracking-[0.12em] text-brand/80 uppercase">
                    {t("common.amountNpr")}
                  </p>
                  <p
                    className={cn(
                      "mt-2 break-all text-[34px] leading-none font-black tracking-tight tabular-nums sm:text-[40px]",
                      statement.item.credit ? "text-success" : "text-brand-dark",
                    )}
                  >
                    {statement.item.credit ? "+" : "−"} {amountNpr}
                  </p>
                  <p className="mt-2.5 break-words text-[13px] font-medium text-muted-foreground">
                    {hasCommissionBreakdown
                      ? t("history.netCommissionCredited")
                      : statement.item.credit
                        ? t("history.totalCredited")
                        : t("common.totalDebited")}
                    :{" "}
                    <span className="break-all font-semibold tabular-nums text-foreground">
                      {totalNpr}
                    </span>
                  </p>
                </div>
                <WalletIllustration credit={statement.item.credit} />
              </div>
            </section>

            {/* Quick info 2×2 */}
            <div className="grid grid-cols-2 gap-2.5">
              <QuickInfoCard
                label={t("history.dateTime")}
                value={summaryMeta?.dateTime ?? "—"}
                icon={<CalendarClock className="size-4" />}
              />
              <QuickInfoCard
                label={t("history.referenceCode")}
                value={summaryMeta?.reference ?? "—"}
                icon={<Hash className="size-4" />}
              />
              <QuickInfoCard
                label={t("history.channel")}
                value={summaryMeta?.channel ?? "—"}
                icon={<UserRound className="size-4" />}
              />
              <QuickInfoCard
                label={t("history.receiptNo")}
                value={receiptNo}
                icon={<ReceiptText className="size-4" />}
              />
            </div>

            {/* Settlement */}
            <section className="overflow-hidden rounded-[20px] border border-border/50 bg-white shadow-[0_8px_28px_-18px_rgba(2,8,23,0.28)]">
              <div className="px-4 pt-4 pb-1">
                <p className="text-[12px] font-bold tracking-[0.1em] text-brand uppercase">
                  {t("history.settlement")}
                </p>
              </div>
              <div className="space-y-0.5 px-4 pb-3">
                {hasCommissionBreakdown ? (
                  <>
                    <SettlementRow
                      label={t("history.grossCommission")}
                      value={grossCommissionNpr ?? "—"}
                      icon={<Coins className="size-4" />}
                    />
                    <SettlementRow
                      label={tdsChargeRateLabel ?? t("history.tdsCharge")}
                      value={`− ${tdsChargeNpr}`}
                      icon={<Tag className="size-4" />}
                      debit
                    />
                    <SettlementRow
                      label={t("history.netCommissionCredited")}
                      value={netCommissionNpr ?? "—"}
                      icon={<Coins className="size-4" />}
                    />
                  </>
                ) : cashbackReturnNpr ? (
                  <SettlementRow
                    label={t("common.cashbackReturn")}
                    value={cashbackReturnNpr}
                    icon={<BadgeCheck className="size-4" />}
                  />
                ) : (
                  <SettlementRow
                    label={t("common.amountNpr")}
                    value={amountNpr}
                    icon={<Coins className="size-4" />}
                  />
                )}
                {serviceChargeLabel && serviceChargeNpr ? (
                  <SettlementRow
                    label={serviceChargeLabel}
                    value={serviceChargeNpr}
                    icon={<Tag className="size-4" />}
                  />
                ) : null}
              </div>
              <div className="mx-3 mb-3 rounded-xl bg-brand-soft/80 px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold tracking-wide text-brand-dark/70 uppercase">
                    {hasCommissionBreakdown
                      ? t("history.netCommissionCredited")
                      : statement.item.credit
                        ? t("history.totalCredited")
                        : t("common.totalDebited")}
                  </p>
                  <p className="break-all text-[22px] leading-none font-black tabular-nums text-brand-dark sm:text-[26px]">
                    {totalNpr}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-brand/10 bg-brand-soft/40 px-4 py-2.5 text-[12px] font-medium text-brand-dark">
                <ShieldCheck className="size-4 shrink-0" />
                <span className="min-w-0 break-words">{t("history.secureEncrypted")}</span>
              </div>
            </section>

            {balanceBeforeNpr && balanceAfterNpr ? (
              <WalletBalanceCard
                before={balanceBeforeNpr}
                after={balanceAfterNpr}
                credit={statement.item.credit}
                labels={{
                  title: t("history.walletBalanceCard"),
                  before: t("history.balanceBefore"),
                  after: t("history.balanceAfter"),
                  delta: t("history.balanceDelta"),
                }}
              />
            ) : null}

            {/* Transaction details */}
            <section className="overflow-hidden rounded-[20px] border border-border/50 bg-white shadow-[0_8px_28px_-18px_rgba(2,8,23,0.28)]">
              <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
                <ReceiptText className="size-4 shrink-0 text-brand" />
                <h2 className="text-[12px] font-bold tracking-[0.08em] text-brand-dark uppercase">
                  {t("history.transactionDetails")}
                </h2>
              </div>
              <dl className="px-4 py-1">
                {transactionRows.map((row) => (
                  <DetailKv
                    key={row.label}
                    label={row.label}
                    value={row.value}
                    icon={row.icon}
                    success={row.success}
                    danger={row.danger}
                  />
                ))}
              </dl>
            </section>

            {/* Trust strip */}
            <div className="grid grid-cols-5 gap-1.5 rounded-[18px] border border-border/50 bg-white px-2 py-3 shadow-[0_4px_18px_-14px_rgba(2,8,23,0.3)] sm:gap-2 sm:px-3">
              {(
                [
                  { icon: ShieldCheck, label: t("history.trustSecure") },
                  { icon: Clock3, label: t("history.trustFast") },
                  { icon: Hash, label: t("history.trustScan") },
                  { icon: Phone, label: t("history.trustSupport") },
                  { icon: BadgeCheck, label: t("history.trustReliable") },
                ] as const
              ).map(({ icon: Icon, label }) => (
                <div key={label} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                  <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="line-clamp-2 text-[9px] leading-tight font-medium text-muted-foreground sm:text-[10px]">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {statement.item.kind === "deposit" && (
            <section className="relative mt-3.5 min-w-0 overflow-x-clip rounded-[20px] border border-border/50 bg-white p-4 shadow-[0_8px_28px_-18px_rgba(2,8,23,0.28)]">
              <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
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

          <div className="relative mt-5">
            <Link
              to="/app/history"
              className="flex h-12 w-full items-center justify-center rounded-2xl bg-brand text-[16px] font-semibold text-white shadow-[0_12px_28px_-12px_rgba(10,122,75,0.9)] transition-colors hover:bg-brand-dark print:hidden"
            >
              {t("history.done")}
            </Link>
          </div>
        </article>
      )}
    </UserShell>
  );
}
