import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search, Zap, ChevronRight, Check } from "lucide-react";
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
import { liveQueryOptions, settingsQueryOptions } from "@/lib/refresh";
import { toastPendingSettled, usePendingStatusPoll } from "@/hooks/use-pending-status-poll";
import { isAccountPending, isWalletTxnLocked, walletTxnLockMessageKey } from "@/lib/account-status";
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
import type {
  CommunityElectricityTransaction,
  CommunityProviderOption,
  UtilityInquiry,
} from "@/lib/types";

export const Route = createFileRoute("/app/community-electricity")({
  head: () => ({
    meta: [
      { title: "Community Electricity — MySewa" },
      {
        name: "description",
        content:
          "Pay Himchuli, Watermark, Dreamer, Softlab and BPC community electricity bills from your MySewa business wallet.",
      },
    ],
  }),
  component: CommunityElectricityPayment,
});

type Step = "provider" | "counter" | "customer" | "review" | "pay";

function CommunityElectricityPayment() {
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

  const [step, setStep] = useState<Step>("provider");
  const [selectedProvider, setSelectedProvider] = useState<CommunityProviderOption | null>(null);
  const [counterOptions, setCounterOptions] = useState<CounterOption[]>([]);
  const [selectedCounter, setSelectedCounter] = useState<CounterOption | null>(null);
  const [customerRef, setCustomerRef] = useState("");
  const [serviceSlug, setServiceSlug] = useState("");
  const [consumerId, setConsumerId] = useState("");
  const [month, setMonth] = useState("");
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
    ...settingsQueryOptions(),
  });
  const enabled =
    settingsQuery.data?.config?.payment?.community_electricity_enabled !== false &&
    !accountPending;

  const providersQuery = useQuery({
    queryKey: ["community-electricity", "providers"],
    queryFn: () => apiClient.communityElectricityProviders(),
    enabled,
  });

  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    ...liveQueryOptions(),
  });

  const historyQuery = useQuery({
    queryKey: ["community-electricity", debounced],
    queryFn: () => apiClient.communityElectricityHistory(debounced),
    ...liveQueryOptions(),
  });
  const ceItems = useMemo(
    () => sortByLatestFirst(historyQuery.data?.items ?? []),
    [historyQuery.data?.items],
  );
  const ceStats = historyQuery.data?.stats;

  usePendingStatusPoll(
    ceItems,
    async (item) => {
      const res = await apiClient.communityElectricityStatus(item.merchant_txn_id);
      return { nextStatus: res.local_bill?.status ?? res.status, message: res.message };
    },
    {
      invalidateKeys: [["community-electricity"], ["wallet"]],
      onSettled: (_item, next, message) => toastPendingSettled(next, message, t),
    },
  );

  const walletBalance = Number(walletQuery.data?.balance ?? 0);
  const walletBlocked = isWalletTxnLocked(walletQuery.data, user);
  const walletLockMessage = t(walletTxnLockMessageKey(walletQuery.data, user));
  const payAmount = Number(amount) || 0;
  const totalDue = Number(totalDebited) || payAmount;
  const insufficient = payAmount > 0 && totalDue > 0 && walletBalance < totalDue;
  const payService = selectedProvider?.pay_service || "HIMCHULI_PAY";

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
        .calculateCharge(payService, payAmount)
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
  }, [payAmount, enabled, step, payService]);

  const countersMutation = useMutation({
    mutationFn: async (provider: CommunityProviderOption) => {
      if (provider.has_counters) {
        return apiClient.communityElectricityCounters({ platform_id: provider.id });
      }
      if (provider.has_slugs) {
        const code = customerRef.trim();
        const slug = serviceSlug.trim();
        if (!code) throw new Error(t("communityElectricity.customerRequired"));
        if (!slug) throw new Error(t("communityElectricity.slugRequired"));
        return apiClient.communityElectricityCounters({
          platform_id: provider.id,
          customer_code: code,
          customer_ref: code,
          service_slug: slug,
        });
      }
      throw new Error(t("communityElectricity.noCounterStep"));
    },
    onSuccess: (res) => {
      const opts = extractCounterOptions(res.data);
      setCounterOptions(opts);
      if (!opts.length) {
        toast.message(t("communityElectricity.noCounters"));
      }
    },
    onError: (err) => {
      toastApiError(err, {
        title: t("communityElectricity.countersFailed"),
        fallback: t("communityElectricity.countersFailed"),
      });
    },
  });

  const selectProvider = (provider: CommunityProviderOption) => {
    setSelectedProvider(provider);
    setSelectedCounter(null);
    setCounterOptions([]);
    setCustomerRef("");
    setConsumerId("");
    setMonth("");
    setServiceSlug(provider.default_service_slug || "");
    setInquiry(null);
    setCustomerName("");
    setAmount("");
    if (provider.has_counters) {
      setStep("counter");
      countersMutation.mutate(provider);
    } else {
      setStep("customer");
    }
  };

  const buildInquiryBody = () => {
    if (!selectedProvider) throw new Error(t("communityElectricity.selectProvider"));
    const ref = customerRef.trim();
    if (!ref) throw new Error(t("communityElectricity.customerRequired"));
    const pid = selectedProvider.id;
    const body: Parameters<typeof apiClient.communityElectricityInquiry>[0] = {
      platform_id: pid,
      customer_ref: ref,
    };
    if (pid === "himchuli") {
      body.customer_number = ref;
      body.service_slug = serviceSlug.trim() || "himchuli";
    } else if (pid === "watermark") {
      body.customer_code = ref;
      body.service_slug = serviceSlug.trim();
      if (!body.service_slug) throw new Error(t("communityElectricity.slugRequired"));
    } else if (pid === "dreamer") {
      body.customer_no = ref;
      body.service_slug = serviceSlug.trim();
      if (!body.service_slug) throw new Error(t("communityElectricity.slugRequired"));
    } else if (pid === "softlab") {
      body.customer_code = ref;
      body.service_slug = serviceSlug.trim();
      if (!body.service_slug) throw new Error(t("communityElectricity.slugRequired"));
      const monthNum = month.trim() === "" ? 0 : Number(month);
      if (!Number.isFinite(monthNum) || monthNum < 0) {
        throw new Error(t("communityElectricity.monthRequired"));
      }
      body.month = monthNum;
    } else if (pid === "bpc") {
      body.consumer_no = ref;
      body.consumer_id = consumerId.trim();
      body.counter_code = selectedCounter?.value || "";
      if (!body.consumer_id) throw new Error(t("communityElectricity.consumerIdRequired"));
      if (!body.counter_code) throw new Error(t("communityElectricity.counterRequired"));
    }
    return body;
  };

  const inquiryMutation = useMutation({
    mutationFn: async () => apiClient.communityElectricityInquiry(buildInquiryBody()),
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
      toast.success(t("communityElectricity.inquirySuccess"));
    },
    onError: (err) => {
      toastApiError(err, {
        title: t("communityElectricity.inquiryFailed"),
        fallback: t("communityElectricity.inquiryFailed"),
      });
    },
  });

  const payMutation = useMutation({
    mutationFn: async (transaction_pin: string) => {
      if (!selectedProvider || !inquiry) {
        throw new Error(t("communityElectricity.inquiryRequired"));
      }
      if (accountPending) throw new Error(t("account.pending"));
      if (walletBlocked) throw new Error(walletLockMessage);
      if (!enabled) throw new Error(t("communityElectricity.disabledError"));
      if (payAmount <= 0) throw new Error(t("communityElectricity.amountRequired"));
      if (insufficient) {
        throw new Error(
          t("topup.insufficient", {
            required: formatNPR(totalDue),
            available: formatNPR(walletBalance),
          }),
        );
      }
      const inquiryBody = buildInquiryBody();
      const body: Parameters<typeof apiClient.communityElectricityPay>[0] = {
        ...inquiryBody,
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
      return apiClient.communityElectricityPay(body);
    },
    onSuccess: (res) => {
      setPinOpen(false);
      setPinError(null);
      const isPending = res.data.status === "pending";
      if (isPending) {
        toast.message(res.message || t("communityElectricity.pendingTitle"), {
          description: res.pending_message || t("topup.pendingBody"),
        });
      } else {
        toast.success(res.message || t("communityElectricity.paySuccess"), {
          description: t("transfer.debited", {
            amount: formatNPR(res.data.total_debited || totalDebited),
          }),
        });
      }
      resetFlow();
      setLastReceiptId(activityIdForKind("community_electricity", res.data.id));
      queryClient.invalidateQueries({ queryKey: ["community-electricity"] });
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
            title: t("communityElectricity.payFailed"),
            fallback: t("topup.insufficient", {
              required: formatNPR(String(body["required"] ?? totalDue)),
              available: formatNPR(String(body["available"] ?? walletBalance)),
            }),
          });
          return;
        }
      }
      setPinOpen(false);
      toastApiError(err, {
        title: t("communityElectricity.payFailed"),
        fallback: t("communityElectricity.payFailed"),
      });
    },
  });

  const resetFlow = () => {
    setStep("provider");
    setSelectedProvider(null);
    setSelectedCounter(null);
    setCounterOptions([]);
    setCustomerRef("");
    setServiceSlug("");
    setConsumerId("");
    setMonth("");
    setInquiry(null);
    setCustomerName("");
    setAmount("");
    setCharge("0.00");
    setCashback("0.00");
    setTotalDebited("0.00");
  };

  const goBack = () => {
    if (step === "pay") setStep("review");
    else if (step === "review") setStep("customer");
    else if (step === "customer") {
      if (selectedProvider?.has_counters) setStep("counter");
      else setStep("provider");
    } else if (step === "counter") setStep("provider");
  };

  const stepTitle = useMemo(() => {
    if (step === "provider") return t("communityElectricity.stepProvider");
    if (step === "counter") return t("communityElectricity.stepCounter");
    if (step === "customer") return t("communityElectricity.stepCustomer");
    if (step === "review") return t("communityElectricity.stepReview");
    return t("communityElectricity.stepPay");
  }, [step, t]);

  const providers = providersQuery.data?.providers ?? [];

  return (
    <UserShell
      title={t("communityElectricity.title")}
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
          aria-label={t("communityElectricity.searchTitle")}
        >
          <Search className="size-4" />
        </Button>
      }
    >
      <div className="min-w-0 max-w-full space-y-5">
        <AccountPendingBanner />
        {!enabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4">
            <p className="text-[15px] font-medium text-destructive">
              {t("communityElectricity.disabledTitle")}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("communityElectricity.disabledBody")}
            </p>
          </section>
        ) : null}

        <section className="inset-group min-w-0 max-w-full p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{stepTitle}</h2>
            {step !== "provider" ? (
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

          {step === "provider" ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                {t("communityElectricity.providerHelp")}
              </p>
              {providersQuery.isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {providers.map((provider) => (
                    <li key={provider.id}>
                      <button
                        type="button"
                        disabled={!enabled}
                        onClick={() => selectProvider(provider)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-3 text-left shadow-card transition-colors hover:border-brand/40 hover:bg-brand/5 disabled:opacity-50"
                      >
                        <span
                          className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-white"
                          style={{ backgroundColor: provider.color || "#0D9488" }}
                        >
                          {provider.logo_image_url ? (
                            <img
                              src={provider.logo_image_url}
                              alt=""
                              className="size-full object-contain bg-white p-1"
                              loading="lazy"
                            />
                          ) : (
                            <Zap className="size-5" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{provider.name}</span>
                          <span className="block text-[12px] text-muted-foreground">
                            {provider.customer_label}
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

          {step === "counter" && selectedProvider ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                {t("communityElectricity.counterHelp", { provider: selectedProvider.name })}
              </p>
              {countersMutation.isPending ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : !counterOptions.length ? (
                <div className="space-y-3 py-4 text-center">
                  <p className="text-sm text-muted-foreground">{t("communityElectricity.noCounters")}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => countersMutation.mutate(selectedProvider)}
                  >
                    {t("common.retry")}
                  </Button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {counterOptions.map((c) => (
                    <li key={c.value}>
                      <button
                        type="button"
                        disabled={!enabled}
                        onClick={() => {
                          setSelectedCounter(c);
                          setStep("customer");
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                          selectedCounter?.value === c.value
                            ? "border-brand bg-brand/10"
                            : "border-border bg-surface hover:border-brand/30",
                        )}
                      >
                        <span className="min-w-0 flex-1 text-[15px] font-semibold">{c.label}</span>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {step === "customer" && selectedProvider ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                inquiryMutation.mutate();
              }}
            >
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: selectedProvider.color || "#0D9488" }}
                >
                  <Zap className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{selectedProvider.name}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {t("communityElectricity.billPayment")}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ce_customer">{selectedProvider.customer_label}</Label>
                <Input
                  id="ce_customer"
                  value={customerRef}
                  onChange={(e) => setCustomerRef(e.target.value)}
                  placeholder={selectedProvider.placeholder}
                  className="h-12 rounded-xl font-medium"
                  disabled={!enabled}
                  autoComplete="off"
                  required
                />
              </div>

              {selectedProvider.id === "bpc" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ce_consumer_id">{t("communityElectricity.consumerId")}</Label>
                  <Input
                    id="ce_consumer_id"
                    value={consumerId}
                    onChange={(e) => setConsumerId(e.target.value)}
                    placeholder={t("communityElectricity.consumerIdPlaceholder")}
                    className="h-12 rounded-xl font-medium"
                    disabled={!enabled}
                    autoComplete="off"
                    required
                  />
                  {selectedCounter ? (
                    <p className="text-[12px] text-muted-foreground">
                      {t("communityElectricity.counter")}: {selectedCounter.label}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {selectedProvider.id === "softlab" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ce_month">{t("communityElectricity.month")}</Label>
                  <Input
                    id="ce_month"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    placeholder={t("communityElectricity.monthPlaceholder")}
                    className="h-12 rounded-xl font-medium"
                    disabled={!enabled}
                  />
                </div>
              ) : null}

              {selectedProvider.id !== "bpc" &&
              (selectedProvider.inquiry_fields.includes("service_slug") ||
                selectedProvider.has_slugs) ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ce_slug">{t("communityElectricity.serviceSlug")}</Label>
                  <Input
                    id="ce_slug"
                    value={serviceSlug}
                    onChange={(e) => setServiceSlug(e.target.value)}
                    placeholder={t("communityElectricity.slugPlaceholder")}
                    className="h-12 rounded-xl font-medium"
                    disabled={!enabled}
                    autoComplete="off"
                    required={selectedProvider.id !== "himchuli"}
                  />
                  {selectedProvider.has_slugs ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-1 h-10 w-full rounded-xl"
                      disabled={!enabled || countersMutation.isPending}
                      onClick={() => countersMutation.mutate(selectedProvider)}
                    >
                      {countersMutation.isPending
                        ? t("common.loading")
                        : t("communityElectricity.fetchSlugs")}
                    </Button>
                  ) : null}
                  {selectedProvider.has_slugs && counterOptions.length ? (
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                      {counterOptions.map((opt) => (
                        <li key={opt.value}>
                          <button
                            type="button"
                            className="w-full rounded-lg border border-border px-3 py-2 text-left text-[13px] hover:border-brand/40"
                            onClick={() => setServiceSlug(opt.value)}
                          >
                            {opt.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <p className="text-[12px] text-muted-foreground">
                {t("communityElectricity.customerHelp")}
              </p>
              <Button
                type="submit"
                disabled={inquiryMutation.isPending || !enabled}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                <Search className="mr-2 size-4" />
                {inquiryMutation.isPending
                  ? t("communityElectricity.liveInquiry")
                  : t("communityElectricity.inquiry")}
              </Button>
            </form>
          ) : null}

          {step === "review" && inquiry && selectedProvider ? (
            <div className="space-y-4">
              <dl className="space-y-2 rounded-xl bg-muted/50 p-3 text-[14px]">
                <Row label={t("communityElectricity.provider")} value={selectedProvider.name} />
                <Row
                  label={selectedProvider.customer_label}
                  value={customerRef.trim()}
                  mono
                />
                {customerName ? (
                  <Row label={t("communityElectricity.customerName")} value={customerName} />
                ) : null}
                {selectedCounter ? (
                  <Row label={t("communityElectricity.counter")} value={selectedCounter.label} />
                ) : null}
                {consumerId.trim() ? (
                  <Row label={t("communityElectricity.consumerId")} value={consumerId.trim()} mono />
                ) : null}
                {serviceSlug.trim() ? (
                  <Row label={t("communityElectricity.serviceSlug")} value={serviceSlug.trim()} />
                ) : null}
                {selectedProvider.id === "softlab" && month.trim() !== "" ? (
                  <Row label={t("communityElectricity.month")} value={month.trim()} />
                ) : null}
              </dl>
              <div className="space-y-1.5">
                <Label htmlFor="ce_amount">{t("communityElectricity.amount")}</Label>
                <Input
                  id="ce_amount"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={t("communityElectricity.amountPlaceholder")}
                  className="h-12 rounded-xl font-medium tabular"
                  disabled={!enabled}
                  required
                />
                <p className="text-[12px] text-muted-foreground">
                  {t("communityElectricity.amountHelp")}
                </p>
              </div>
              <Button
                type="button"
                disabled={!enabled || payAmount <= 0}
                className="h-12 w-full rounded-xl text-[17px]"
                onClick={() => setStep("pay")}
              >
                {t("communityElectricity.continuePay")}
                <ChevronRight className="ml-2 size-4" />
              </Button>
            </div>
          ) : null}

          {step === "pay" && selectedProvider && inquiry ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand/20 bg-brand/5 p-3">
                <p className="text-[13px] text-muted-foreground">{selectedProvider.name}</p>
                <p className="mt-1 text-[16px] font-semibold">{customerRef.trim()}</p>
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
                disabled={payMutation.isPending || feeLoading || insufficient || !enabled || walletBlocked}
                className="h-12 w-full rounded-xl text-[17px]"
                onClick={() => {
                  setPinError(null);
                  setPinOpen(true);
                }}
              >
                <Check className="mr-2 size-4" />
                {payMutation.isPending
                  ? t("common.processing")
                  : t("communityElectricity.confirmPay", {
                      amount: formatNPR(totalDebited || payAmount),
                    })}
              </Button>
            </div>
          ) : null}
        </section>

        <section>
          {lastReceiptId ? (
            <div className="mb-3">
              <TransactionResultBanner
                tone={
                  ceItems.find(
                    (x) => activityIdForKind("community_electricity", x.id) === lastReceiptId,
                  )?.status === "failed"
                    ? "danger"
                    : ceItems.find(
                          (x) =>
                            activityIdForKind("community_electricity", x.id) === lastReceiptId,
                        )?.status === "pending"
                      ? "warning"
                      : "success"
                }
                title={t("communityElectricity.paySuccess")}
                body={t("history.downloadStatement")}
                receiptLabel={t("history.downloadPdf")}
                onDownloadReceipt={() => void downloadReceipt(lastReceiptId)}
                downloading={receiptDownloading}
              />
            </div>
          ) : null}
          <div className="mb-2 mt-4 px-1">
            <h2 className="text-[17px] font-semibold">{t("communityElectricity.history")}</h2>
          </div>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !ceItems.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("communityElectricity.empty")}
            </div>
          ) : (
            <ul className="inset-group min-w-0 divide-y divide-border overflow-hidden">
              {ceItems.map((item: CommunityElectricityTransaction) => (
                <li key={item.id} className="min-w-0 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        {item.platform_name} · {item.customer_ref}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {item.merchant_txn_id} · {formatDateTime(item.created_at)}
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
                        onClick={() =>
                          void downloadReceipt(
                            activityIdForKind("community_electricity", item.id),
                          )
                        }
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
            <SheetTitle>{t("communityElectricity.searchTitle")}</SheetTitle>
          </SheetHeader>
          <ListPageToolbar
            stats={ceStats}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={async () => {
              setExporting(true);
              try {
                await downloadCsvExport(
                  "/api/community-electricity/history/",
                  debounced,
                  "community-electricity.csv",
                );
              } finally {
                setExporting(false);
              }
            }}
            exporting={exporting}
            searchPlaceholder={t("communityElectricity.searchPlaceholder")}
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
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right font-medium", mono && "font-mono text-[13px]")}>{value}</dd>
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
