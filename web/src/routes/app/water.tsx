import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search, Droplets, ChevronRight, Check } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toastApiError } from "@/lib/api-errors";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDateTime, sortByLatestFirst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { isAccountPending } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { TransactionPinDialog } from "@/components/TransactionPinDialog";
import { useI18n } from "@/lib/i18n";
import { ListPageToolbar, ReceiptDownloadLink, TransactionResultBanner } from "@/components/list/ListPageToolbar";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { activityIdForKind, useReceiptDownload } from "@/lib/receipt-download";
import { useSiteBranding } from "@/hooks/use-site-branding";
import {
  extractCounterOptions,
  extractCustomerName,
  extractPayableAmount,
  type CounterOption,
} from "@/lib/utility-parse";
import type { UtilityInquiry, WaterBillTransaction } from "@/lib/types";

export const Route = createFileRoute("/app/water")({
  head: () => ({
    meta: [
      { title: "Khane Pani (KUKL) — MySewa" },
      {
        name: "description",
        content: "Pay KUKL Khane Pani water bills from your MySewa business wallet.",
      },
    ],
  }),
  component: WaterBillPayment,
});

type Step = "counter" | "account" | "review" | "pay";

function WaterBillPayment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { t } = useI18n();
  const { logoUrl } = useSiteBranding();
  const { download: downloadReceipt, downloading: receiptDownloading } = useReceiptDownload(
    t,
    user?.phone,
    logoUrl,
  );
  const { filters, setFilters, debounced } = useListFilters();
  const [exporting, setExporting] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);
  const accountPending = isAccountPending(user);

  const [step, setStep] = useState<Step>("counter");
  const [counters, setCounters] = useState<CounterOption[]>([]);
  const [selectedCounter, setSelectedCounter] = useState<CounterOption | null>(null);
  const [connectionNo, setConnectionNo] = useState("");
  const [customerCode, setCustomerCode] = useState("");
  const [inquiry, setInquiry] = useState<UtilityInquiry | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [amount, setAmount] = useState("");
  const [charge, setCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");
  const [feeLoading, setFeeLoading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });
  const enabled =
    settingsQuery.data?.config?.payment?.water_bills_enabled !== false && !accountPending;

  const countersQuery = useQuery({
    queryKey: ["water", "counters"],
    queryFn: () => apiClient.waterCounters(),
    enabled,
  });

  useEffect(() => {
    if (!countersQuery.data?.data) return;
    setCounters(extractCounterOptions(countersQuery.data.data));
  }, [countersQuery.data]);

  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const historyQuery = useQuery({
    queryKey: ["water-bills", debounced],
    queryFn: () => apiClient.waterHistory(debounced),
    refetchInterval: LIVE_REFETCH_MS,
  });
  const waterItems = useMemo(
    () => sortByLatestFirst(historyQuery.data?.items ?? []),
    [historyQuery.data?.items],
  );
  const waterStats = historyQuery.data?.stats;

  const walletBalance = Number(walletQuery.data?.balance ?? 0);
  const payAmount = Number(amount) || 0;
  const totalDue = Number(totalDebited) || payAmount;
  const insufficient = payAmount > 0 && totalDue > 0 && walletBalance < totalDue;

  useEffect(() => {
    if (payAmount <= 0 || !enabled || step !== "pay") {
      setCharge("0.00");
      setCashback("0.00");
      setTotalDebited("0.00");
      return;
    }
    let cancelled = false;
    setFeeLoading(true);
    const timer = setTimeout(() => {
      apiClient
        .calculateCharge("KUKL_PAY", payAmount)
        .then((res) => {
          if (cancelled) return;
          setCharge(String(res.charge));
          setCashback(String(res.cashback));
          setTotalDebited(String(res.total_debited));
        })
        .catch(() => {
          if (!cancelled) {
            setCharge("0.00");
            setCashback("0.00");
            setTotalDebited(payAmount.toFixed(2));
          }
        })
        .finally(() => {
          if (!cancelled) setFeeLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [payAmount, enabled, step]);

  const inquiryMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCounter) throw new Error(t("water.selectCounter"));
      const conn = connectionNo.trim();
      const code = customerCode.trim();
      if (!conn) throw new Error(t("water.connectionRequired"));
      if (!code) throw new Error(t("water.customerCodeRequired"));
      return apiClient.waterInquiry({
        connection_no: conn,
        customer_code: code,
        counter: selectedCounter.value,
      });
    },
    onSuccess: (res) => {
      const data = res.data;
      setInquiry(data);
      const name =
        extractCustomerName(data.raw) ||
        (typeof data.customer_name === "string" ? data.customer_name : "") ||
        "";
      const payable =
        extractPayableAmount(data.raw) ||
        (typeof data.payable_amount === "string" ? data.payable_amount : null) ||
        "";
      setCustomerName(name);
      setAmount(payable || "");
      setStep("review");
      toast.success(t("water.inquirySuccess"));
    },
    onError: (err) => {
      toastApiError(err, { title: t("water.inquiryFailed"), fallback: t("water.inquiryFailed") });
    },
  });

  const payMutation = useMutation({
    mutationFn: async (transaction_pin: string) => {
      if (!selectedCounter || !inquiry) throw new Error(t("water.inquiryRequired"));
      if (accountPending) throw new Error(t("account.pending"));
      if (!enabled) throw new Error(t("water.disabledError"));
      if (payAmount <= 0) throw new Error(t("water.amountRequired"));
      if (insufficient) {
        throw new Error(
          t("topup.insufficient", {
            required: formatNPR(totalDue),
            available: formatNPR(walletBalance),
          }),
        );
      }
      const body: Parameters<typeof apiClient.waterPay>[0] = {
        connection_no: connectionNo.trim(),
        customer_code: customerCode.trim(),
        counter: selectedCounter.value,
        amount: Number(payAmount.toFixed(2)),
        transaction_pin,
      };
      if (inquiry.session_id != null && String(inquiry.session_id).trim()) {
        body.session_id = String(inquiry.session_id);
      }
      if (customerName.trim()) body.customer_name = customerName.trim();
      if (typeof inquiry.raw === "object" && inquiry.raw) {
        body.pay_data = inquiry.raw as Record<string, unknown>;
      }
      return apiClient.waterPay(body);
    },
    onSuccess: (res) => {
      setPinOpen(false);
      setPinError(null);
      const isPending = res.data.status === "pending";
      if (isPending) {
        toast.message(res.message || t("water.pendingTitle"), {
          description: res.pending_message || t("topup.pendingBody"),
        });
      } else {
        toast.success(res.message || t("water.paySuccess"), {
          description: t("transfer.debited", {
            amount: formatNPR(res.data.total_debited || totalDebited),
          }),
        });
      }
      resetFlow();
      setLastReceiptId(activityIdForKind("water", res.data.id));
      queryClient.invalidateQueries({ queryKey: ["water-bills"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const body = err.body as Record<string, unknown>;
        const errors = body["errors"] as Record<string, string[]> | undefined;
        if (errors?.["transaction_pin"]?.[0] || body["code"] === "pin_not_set") {
          setPinError(errors?.["transaction_pin"]?.[0] || t("pin.incorrect"));
          return;
        }
        if (body["error"] === "Insufficient balance") {
          setPinOpen(false);
          toastApiError(err, {
            title: t("water.payFailed"),
            fallback: t("topup.insufficient", {
              required: formatNPR(String(body["required"] ?? totalDue)),
              available: formatNPR(String(body["available"] ?? walletBalance)),
            }),
          });
          return;
        }
      }
      setPinOpen(false);
      toastApiError(err, { title: t("water.payFailed"), fallback: t("water.payFailed") });
    },
  });

  const resetFlow = () => {
    setStep("counter");
    setSelectedCounter(null);
    setConnectionNo("");
    setCustomerCode("");
    setInquiry(null);
    setCustomerName("");
    setAmount("");
    setCharge("0.00");
    setCashback("0.00");
    setTotalDebited("0.00");
  };

  const goBack = () => {
    if (step === "pay") setStep("review");
    else if (step === "review") setStep("account");
    else if (step === "account") setStep("counter");
  };

  const stepTitle = useMemo(() => {
    if (step === "counter") return t("water.stepCounter");
    if (step === "account") return t("water.stepAccount");
    if (step === "review") return t("water.stepReview");
    return t("water.stepPay");
  }, [step, t]);

  return (
    <UserShell
      title={t("water.title")}
      back="/app"
      headerTrailing={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-10 shrink-0 rounded-xl border border-white/25 bg-white/15 text-primary-foreground shadow-sm backdrop-blur",
            "hover:bg-white/25",
            "lg:border-border lg:bg-surface lg:text-foreground lg:hover:border-brand/35 lg:hover:bg-brand-soft lg:hover:text-brand-dark",
          )}
          onClick={() => setSearchOpen(true)}
          aria-label={t("water.searchTitle")}
        >
          <Search className="size-4" />
        </Button>
      }
    >
      <div className="min-w-0 max-w-full space-y-5 overflow-x-clip">
        {accountPending ? <AccountPendingBanner /> : null}
        {!enabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4">
            <p className="text-[15px] font-medium text-destructive">{t("water.disabledTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("water.disabledBody")}</p>
          </section>
        ) : null}

        <section className="inset-group min-w-0 max-w-full p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{stepTitle}</h2>
            {step !== "counter" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-[13px]"
                onClick={goBack}
              >
                <ArrowLeft className="size-3.5" />
                {t("common.goBack")}
              </Button>
            ) : null}
          </div>

          {step === "counter" ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">{t("water.counterHelp")}</p>
              {countersQuery.isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : countersQuery.isError ? (
                <div className="space-y-3 py-4 text-center">
                  <p className="text-sm text-destructive">{t("water.countersFailed")}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => void countersQuery.refetch()}
                  >
                    {t("common.retry")}
                  </Button>
                </div>
              ) : !counters.length ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("water.noCounters")}</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {counters.map((c) => (
                    <li key={c.value}>
                      <button
                        type="button"
                        disabled={!enabled}
                        onClick={() => {
                          setSelectedCounter(c);
                          setStep("account");
                        }}
                        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-3 text-left shadow-card transition-colors hover:border-brand/40 hover:bg-brand/5 disabled:opacity-50"
                      >
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0EA5E9] text-white">
                          <Droplets className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold">{c.label}</span>
                          <span className="block text-[12px] text-muted-foreground">
                            {t("water.counter")}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {step === "account" && selectedCounter ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                inquiryMutation.mutate();
              }}
            >
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0EA5E9] text-white">
                  <Droplets className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{selectedCounter.label}</p>
                  <p className="text-[12px] text-muted-foreground">{t("water.billPayment")}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="connection_no">{t("water.connectionNo")}</Label>
                <Input
                  id="connection_no"
                  value={connectionNo}
                  onChange={(e) => setConnectionNo(e.target.value)}
                  placeholder={t("water.connectionPlaceholder")}
                  className="h-12 rounded-xl font-medium"
                  disabled={!enabled}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer_code">{t("water.customerCode")}</Label>
                <Input
                  id="customer_code"
                  value={customerCode}
                  onChange={(e) => setCustomerCode(e.target.value)}
                  placeholder={t("water.customerCodePlaceholder")}
                  className="h-12 rounded-xl font-medium"
                  disabled={!enabled}
                  autoComplete="off"
                  required
                />
                <p className="text-[12px] text-muted-foreground">{t("water.accountHelp")}</p>
              </div>
              <Button
                type="submit"
                disabled={inquiryMutation.isPending || !enabled}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                <Search className="mr-2 size-4" />
                {inquiryMutation.isPending ? t("water.liveInquiry") : t("water.inquiry")}
              </Button>
            </form>
          ) : null}

          {step === "review" && inquiry && selectedCounter ? (
            <div className="space-y-4">
              <dl className="space-y-2 rounded-xl bg-muted/50 p-3 text-[14px]">
                <Row label={t("water.counter")} value={selectedCounter.label} />
                <Row label={t("water.connectionNo")} value={connectionNo.trim()} mono />
                <Row label={t("water.customerCode")} value={customerCode.trim()} mono />
                {customerName ? <Row label={t("water.customerName")} value={customerName} /> : null}
              </dl>
              <div className="space-y-1.5">
                <Label htmlFor="water_amount">{t("water.amount")}</Label>
                <Input
                  id="water_amount"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={t("water.amountPlaceholder")}
                  className="h-12 rounded-xl font-medium tabular"
                  disabled={!enabled}
                  required
                />
                <p className="text-[12px] text-muted-foreground">{t("water.amountHelp")}</p>
              </div>
              <Button
                type="button"
                disabled={!enabled || payAmount <= 0}
                className="h-12 w-full rounded-xl text-[17px]"
                onClick={() => setStep("pay")}
              >
                {t("water.continuePay")}
                <ChevronRight className="ml-2 size-4" />
              </Button>
            </div>
          ) : null}

          {step === "pay" && selectedCounter && inquiry ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand/20 bg-brand/5 p-3">
                <p className="text-[13px] text-muted-foreground">{t("water.title")}</p>
                <p className="mt-1 text-[16px] font-semibold">
                  {connectionNo.trim()} · {customerCode.trim()}
                </p>
                <p className="mt-2 tabular text-[28px] font-bold">{formatNPR(payAmount)}</p>
              </div>

              <div className="rounded-xl bg-muted px-3 py-2.5 text-[14px]">
                <p className="text-[12px] text-muted-foreground">{t("topup.walletLabel")}</p>
                <p className="tabular text-[17px] font-semibold">
                  {walletQuery.isLoading ? "…" : formatNPR(walletBalance)}
                </p>
              </div>

              <div className="rounded-xl bg-muted p-3 text-[14px]">
                <FeeRow label={t("common.amount")} value={formatNPR(payAmount)} />
                <FeeRow label={t("common.charge")} value={feeLoading ? "…" : formatNPR(charge)} />
                <FeeRow
                  label={t("common.cashback")}
                  value={feeLoading ? "…" : `− ${formatNPR(cashback)}`}
                />
                <div className="mt-2 border-t border-separator pt-2">
                  <FeeRow
                    label={t("common.totalDebited")}
                    value={feeLoading ? "…" : formatNPR(totalDebited)}
                    strong
                  />
                </div>
                {insufficient ? (
                  <p className="mt-2 text-[12px] font-medium text-destructive" role="alert">
                    {t("topup.insufficient", {
                      required: formatNPR(totalDue),
                      available: formatNPR(walletBalance),
                    })}
                  </p>
                ) : null}
              </div>

              <Button
                type="button"
                disabled={payMutation.isPending || feeLoading || insufficient || !enabled}
                className="h-12 w-full rounded-xl text-[17px]"
                onClick={() => {
                  setPinError(null);
                  setPinOpen(true);
                }}
              >
                <Check className="mr-2 size-4" />
                {payMutation.isPending
                  ? t("common.processing")
                  : t("water.confirmPay", { amount: formatNPR(totalDebited || payAmount) })}
              </Button>
            </div>
          ) : null}
        </section>

        <section>
          {lastReceiptId ? (
            <div className="mb-3">
              <TransactionResultBanner
                tone={
                  waterItems.find((x) => activityIdForKind("water", x.id) === lastReceiptId)
                    ?.status === "failed"
                    ? "danger"
                    : waterItems.find((x) => activityIdForKind("water", x.id) === lastReceiptId)
                          ?.status === "pending"
                      ? "warning"
                      : "success"
                }
                title={t("water.paySuccess")}
                body={t("history.downloadStatement")}
                receiptLabel={t("history.downloadPdf")}
                onDownloadReceipt={() => void downloadReceipt(lastReceiptId)}
                downloading={receiptDownloading}
              />
            </div>
          ) : null}
          <div className="mb-2 mt-4 px-1">
            <h2 className="text-[17px] font-semibold">{t("water.history")}</h2>
          </div>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !waterItems.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("water.empty")}
            </div>
          ) : (
            <ul className="inset-group min-w-0 divide-y divide-border overflow-hidden">
              {waterItems.map((item: WaterBillTransaction) => (
                <li key={item.id} className="min-w-0 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        {item.connection_no} · {item.customer_code}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {item.counter || item.merchant_txn_id} · {formatDateTime(item.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-[15px] font-semibold">{formatNPR(item.amount)}</p>
                      <StatusChip status={item.status} compact className="mt-1" />
                    </div>
                  </div>
                  {(item.status === "success" || item.status === "failed") && (
                    <div className="mt-1 flex justify-end">
                      <ReceiptDownloadLink
                        label={t("list.downloadReceipt")}
                        downloading={receiptDownloading}
                        onClick={() => void downloadReceipt(activityIdForKind("water", item.id))}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto overscroll-y-contain rounded-t-2xl px-4 pb-[max(2rem,calc(1rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] pt-5"
        >
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>{t("water.searchTitle")}</SheetTitle>
          </SheetHeader>
          <ListPageToolbar
            stats={waterStats}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={async () => {
              setExporting(true);
              try {
                await downloadCsvExport("/api/water/history/", debounced, "water-bills.csv");
              } finally {
                setExporting(false);
              }
            }}
            exporting={exporting}
            searchPlaceholder={t("water.searchPlaceholder")}
            exportLabel={t("list.exportCsv")}
            statsLabels={{
              total: t("list.statsTotal"),
              success: t("list.statsSuccess"),
              pending: t("list.statsPending"),
              failed: t("list.statsFailed"),
            }}
            statusOptions={[...TXN_STATUS_OPTIONS]}
          />
          <Button
            type="button"
            className="mt-4 h-11 w-full rounded-xl"
            onClick={() => setSearchOpen(false)}
          >
            {t("history.applyFilters")}
          </Button>
        </SheetContent>
      </Sheet>

      <TransactionPinDialog
        open={pinOpen}
        onOpenChange={(open) => {
          setPinOpen(open);
          if (!open) setPinError(null);
        }}
        hasPin={Boolean(user?.has_transaction_pin)}
        confirming={payMutation.isPending}
        error={pinError}
        onConfirm={(pin) => {
          setPinError(null);
          payMutation.mutate(pin);
        }}
      />
    </UserShell>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-right font-medium",
          mono && "font-mono text-[13px]",
          strong && "text-[17px] font-semibold tabular",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function FeeRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular", strong ? "font-semibold" : "font-medium")}>{value}</span>
    </div>
  );
}
