import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Search,
  Droplets,
  ChevronRight,
  ChevronUp,
  Check,
  RefreshCw,
  Wallet,
  Info,
  LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      { title: "Khanepani — MySewa" },
      {
        name: "description",
        content: "Pay drinking water bills from your MySewa business wallet.",
      },
    ],
  }),
  component: WaterBillPayment,
});

type Step = "provider" | "account" | "review" | "pay";

type WaterProvider = {
  id: string;
  name: string;
  enabled: boolean;
};

/** Top-level drinking water companies shown as a list (reference UI). */
const WATER_PROVIDERS: WaterProvider[] = [
  { id: "community", name: "Community Khanepani", enabled: false },
  { id: "kukl", name: "KUKL", enabled: true },
  { id: "sansthan", name: "Khanepani Sansthan", enabled: false },
];

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
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const accountPending = isAccountPending(user);

  const [step, setStep] = useState<Step>("provider");
  const [providerQuery, setProviderQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<WaterProvider | null>(null);
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
    queryKey: ["water", "counters", selectedProvider?.id],
    queryFn: () => apiClient.waterCounters(),
    enabled: enabled && selectedProvider?.id === "kukl" && step !== "provider",
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

  const filteredProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    if (!q) return WATER_PROVIDERS;
    return WATER_PROVIDERS.filter((p) => p.name.toLowerCase().includes(q));
  }, [providerQuery]);

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
      setPaymentsOpen(true);
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

  const selectProvider = (provider: WaterProvider) => {
    if (!provider.enabled) {
      toast.message(t("water.providerUnavailable", { provider: provider.name }));
      return;
    }
    if (!enabled) return;
    setSelectedProvider(provider);
    setSelectedCounter(null);
    setCounters([]);
    setConnectionNo("");
    setCustomerCode("");
    setInquiry(null);
    setCustomerName("");
    setAmount("");
    setStep("account");
  };

  const resetFlow = () => {
    setStep("provider");
    setSelectedProvider(null);
    setSelectedCounter(null);
    setCounters([]);
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
    else if (step === "account") {
      setSelectedProvider(null);
      setSelectedCounter(null);
      setCounters([]);
      setConnectionNo("");
      setCustomerCode("");
      setInquiry(null);
      setStep("provider");
    }
  };

  const shellTitle = step === "provider" ? t("water.title") : t("water.paymentTitle");
  const shellOnBack = step === "provider" ? undefined : goBack;

  return (
    <UserShell
      title={shellTitle}
      {...(step === "provider" ? { back: "/app" } : {})}
      {...(shellOnBack ? { onBack: shellOnBack } : {})}
      {...(step !== "provider"
        ? {
            headerTrailing: (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "size-10 shrink-0 rounded-full border border-white/25 bg-white/15 text-primary-foreground shadow-sm backdrop-blur",
                  "hover:bg-white/25",
                  "lg:border-border lg:bg-surface lg:text-foreground lg:hover:border-brand/35 lg:hover:bg-brand-soft lg:hover:text-brand-dark",
                )}
                onClick={() => setSearchOpen(true)}
                aria-label={t("water.searchTitle")}
              >
                <Info className="size-4" />
              </Button>
            ),
          }
        : {})}
    >
      <div className="min-w-0 max-w-full space-y-4 overflow-x-clip">
        {accountPending ? <AccountPendingBanner /> : null}
        {!enabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4">
            <p className="text-[15px] font-medium text-destructive">{t("water.disabledTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("water.disabledBody")}</p>
          </section>
        ) : null}

        {step === "provider" ? (
          <section className="-mx-3 overflow-hidden bg-surface sm:-mx-4 lg:mx-0 lg:rounded-2xl lg:border lg:border-border lg:shadow-card">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <div className="relative min-w-0 flex-1">
                <Input
                  value={providerQuery}
                  onChange={(e) => setProviderQuery(e.target.value)}
                  placeholder={t("water.providerSearchPlaceholder")}
                  className="h-11 rounded-full border border-border bg-surface pr-10 shadow-none"
                  disabled={!enabled}
                  autoComplete="off"
                />
                <Search className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <button
                type="button"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t("water.gridView")}
              >
                <LayoutGrid className="size-5" />
              </button>
            </div>

            {!filteredProviders.length ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {t("water.noProviders")}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {filteredProviders.map((provider) => (
                  <li key={provider.id}>
                    <button
                      type="button"
                      disabled={!enabled}
                      onClick={() => selectProvider(provider)}
                      className={cn(
                        "flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors",
                        "hover:bg-muted/40 active:bg-muted/60 disabled:opacity-50",
                        !provider.enabled && "opacity-70",
                      )}
                    >
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface shadow-sm">
                        <Droplets className="size-5 text-[#1D4ED8]" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[#0F172A]">
                        {provider.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {step === "account" && selectedProvider ? (
          <>
            <BalanceCard
              balance={walletBalance}
              loading={walletQuery.isLoading}
              fetching={walletQuery.isFetching}
              label={t("topup.walletLabel")}
              onRefresh={() => void walletQuery.refetch()}
              retryLabel={t("common.retry")}
            />

            <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
              <form
                id="water-account-form"
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!selectedCounter) {
                    toast.error(t("water.selectCounter"));
                    return;
                  }
                  inquiryMutation.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="water_counter" className="text-[14px] font-medium text-foreground">
                    {t("water.counter")}
                  </Label>
                  {countersQuery.isLoading ? (
                    <p className="py-3 text-sm text-muted-foreground">{t("common.loading")}</p>
                  ) : countersQuery.isError ? (
                    <div className="space-y-2">
                      <p className="text-sm text-destructive">{t("water.countersFailed")}</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full rounded-xl"
                        onClick={() => void countersQuery.refetch()}
                      >
                        {t("common.retry")}
                      </Button>
                    </div>
                  ) : (
                    <Select
                      {...(selectedCounter ? { value: selectedCounter.value } : {})}
                      onValueChange={(value) => {
                        const match = counters.find((c) => c.value === value) ?? null;
                        setSelectedCounter(match);
                      }}
                      disabled={!enabled || !counters.length}
                    >
                      <SelectTrigger
                        id="water_counter"
                        className="h-12 rounded-xl border-transparent bg-muted text-[15px] shadow-none data-[placeholder]:text-muted-foreground"
                      >
                        <SelectValue placeholder={t("water.counterSelectPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {counters.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="connection_no"
                    className="text-[14px] font-medium text-foreground"
                  >
                    {t("water.connectionNo")}
                  </Label>
                  <Input
                    id="connection_no"
                    value={connectionNo}
                    onChange={(e) => setConnectionNo(e.target.value)}
                    placeholder={t("water.connectionPlaceholder")}
                    className="h-12 rounded-xl border-transparent bg-muted font-medium shadow-none placeholder:text-muted-foreground"
                    disabled={!enabled}
                    autoComplete="off"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="customer_code"
                    className="text-[14px] font-medium text-foreground"
                  >
                    {t("water.customerCode")}
                  </Label>
                  <Input
                    id="customer_code"
                    value={customerCode}
                    onChange={(e) => setCustomerCode(e.target.value)}
                    placeholder={t("water.customerCodePlaceholder")}
                    className="h-12 rounded-xl border-transparent bg-muted font-medium shadow-none placeholder:text-muted-foreground"
                    disabled={!enabled}
                    autoComplete="off"
                    required
                  />
                </div>
              </form>
            </section>

            <Button
              type="submit"
              form="water-account-form"
              disabled={
                inquiryMutation.isPending ||
                !enabled ||
                !selectedCounter ||
                countersQuery.isLoading
              }
              className="h-12 w-full rounded-full text-[17px] font-bold tracking-[0.04em]"
            >
              {inquiryMutation.isPending ? t("water.liveInquiry") : t("water.proceed")}
            </Button>
          </>
        ) : null}

        {step === "review" && inquiry && selectedCounter ? (
          <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">{t("water.stepReview")}</h2>
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
            </div>
            <div className="space-y-4">
              <dl className="space-y-2 rounded-xl bg-muted/50 p-3 text-[14px]">
                {selectedProvider ? (
                  <Row label={t("water.provider")} value={selectedProvider.name} />
                ) : null}
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
                  className="h-12 rounded-xl border-transparent bg-muted font-medium tabular shadow-none"
                  disabled={!enabled}
                  required
                />
                <p className="text-[12px] text-muted-foreground">{t("water.amountHelp")}</p>
              </div>
              <Button
                type="button"
                disabled={!enabled || payAmount <= 0}
                className="h-12 w-full rounded-full text-[17px]"
                onClick={() => setStep("pay")}
              >
                {t("water.continuePay")}
                <ChevronRight className="ml-2 size-4" />
              </Button>
            </div>
          </section>
        ) : null}

        {step === "pay" && selectedCounter && inquiry ? (
          <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">{t("water.stepPay")}</h2>
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
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-brand/20 bg-brand/5 p-3">
                <p className="text-[13px] text-muted-foreground">
                  {selectedProvider?.name ?? t("water.title")}
                </p>
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
                className="h-12 w-full rounded-full text-[17px]"
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
          </section>
        ) : null}

        {step !== "provider" ? (
          <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 px-4 py-3 text-[14px] font-medium text-foreground"
              onClick={() => setPaymentsOpen((v) => !v)}
            >
              <ChevronUp
                className={cn("size-4 transition-transform", !paymentsOpen && "rotate-180")}
              />
              {t("water.myPayments")}
            </button>

            {paymentsOpen ? (
              <div className="border-t border-border px-4 pb-4 pt-2">
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
                {historyQuery.isLoading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("common.loading")}
                  </p>
                ) : !waterItems.length ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t("water.empty")}</p>
                ) : (
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {waterItems.map((item: WaterBillTransaction) => (
                      <li key={item.id} className="min-w-0 px-3 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-medium">
                              {item.connection_no} · {item.customer_code}
                            </p>
                            <p className="truncate text-[13px] text-muted-foreground">
                              {item.counter || item.merchant_txn_id} ·{" "}
                              {formatDateTime(item.created_at)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="tabular text-[15px] font-semibold">
                              {formatNPR(item.amount)}
                            </p>
                            <StatusChip status={item.status} compact className="mt-1" />
                          </div>
                        </div>
                        {(item.status === "success" || item.status === "failed") && (
                          <div className="mt-1 flex justify-end">
                            <ReceiptDownloadLink
                              label={t("list.downloadReceipt")}
                              downloading={receiptDownloading}
                              onClick={() =>
                                void downloadReceipt(activityIdForKind("water", item.id))
                              }
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
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

function BalanceCard({
  balance,
  loading,
  fetching,
  label,
  onRefresh,
  retryLabel,
}: {
  balance: number;
  loading: boolean;
  fetching: boolean;
  label: string;
  onRefresh: () => void;
  retryLabel: string;
}) {
  return (
    <div className="relative z-10 -mt-8 flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 shadow-[0_4px_16px_-4px_rgb(16_24_40_/_0.12)] lg:mt-0">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
        <Wallet className="size-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="tabular text-[18px] font-bold tracking-tight">
          {loading ? "…" : formatNPR(balance)}
        </p>
        <p className="text-[12px] text-muted-foreground">{label}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 rounded-full text-brand hover:bg-brand/10 hover:text-brand"
        onClick={onRefresh}
        aria-label={retryLabel}
      >
        <RefreshCw className={cn("size-4", fetching && "animate-spin")} />
      </Button>
    </div>
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
