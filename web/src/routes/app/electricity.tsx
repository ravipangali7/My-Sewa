import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Search,
  Check,
  RefreshCw,
  Wallet,
  Info,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
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
import { formatNPR } from "@/lib/format";
import { userFacingChargeExtra } from "@/lib/user-charge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { liveQueryOptions, settingsQueryOptions } from "@/lib/refresh";
import { toastPendingSettled, usePendingStatusPoll } from "@/hooks/use-pending-status-poll";
import { isAccountPending, isWalletTxnLocked, walletTxnLockMessageKey } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { TransactionPinDialog } from "@/components/TransactionPinDialog";
import { useI18n } from "@/lib/i18n";
import { ListPageToolbar } from "@/components/list/ListPageToolbar";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { COLORS } from "@/constants/colors";
import {
  extractCounterOptions,
  extractCustomerName,
  extractPayableAmount,
  type CounterOption,
} from "@/lib/utility-parse";
import type { UtilityInquiry } from "@/lib/types";

export const Route = createFileRoute("/app/electricity")({
  head: () => ({
    meta: [
      { title: "Electricity — MySewa" },
      {
        name: "description",
        content: "Pay NEA electricity bills from your MySewa business wallet.",
      },
    ],
  }),
  component: ElectricityBillPayment,
});

type Step = "list" | "details" | "review" | "pay";

/** Accents that are not header/CTA (pay summary tint, etc.) */
const NEA_GREEN = COLORS.brand;
/** Home page header gradient — used for electricity header + primary buttons */
const HOME_GRADIENT =
  "linear-gradient(105deg, #04275C 0%, #0A3D7A 28%, #0C5F8A 55%, #0A8A6A 82%, #10B981 100%)";
const PAGE_BG = "#EEF2F6";

function cleanCounterLabel(option: CounterOption) {
  const cut = option.label.indexOf(" (");
  if (cut > 0) return option.label.slice(0, cut);
  return option.label;
}

function formatBalanceNPR(value: number) {
  return `NPR ${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ElectricityBillPayment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { t } = useI18n();
  const { filters, setFilters, debounced } = useListFilters();
  const [exporting, setExporting] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [counterPickerOpen, setCounterPickerOpen] = useState(false);
  const accountPending = isAccountPending(user);

  const [step, setStep] = useState<Step>("list");
  const [counters, setCounters] = useState<CounterOption[]>([]);
  const [counterQuery, setCounterQuery] = useState("");
  const [selectedCounter, setSelectedCounter] = useState<CounterOption | null>(null);
  const [listSelection, setListSelection] = useState<CounterOption | null>(null);
  const [scNo, setScNo] = useState("");
  const [consumerId, setConsumerId] = useState("");
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
    settingsQuery.data?.config?.payment?.electricity_bills_enabled !== false && !accountPending;

  const countersQuery = useQuery({
    queryKey: ["electricity", "counters"],
    queryFn: () => apiClient.electricityCounters(),
    enabled,
  });

  useEffect(() => {
    if (!countersQuery.data?.data) return;
    setCounters(extractCounterOptions(countersQuery.data.data));
  }, [countersQuery.data]);

  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    ...liveQueryOptions(),
  });

  const historyQuery = useQuery({
    queryKey: ["electricity-bills", debounced],
    queryFn: () => apiClient.electricityHistory(debounced),
    ...liveQueryOptions(),
  });
  const electricityStats = historyQuery.data?.stats;

  usePendingStatusPoll(
    historyQuery.data?.items,
    async (item) => {
      const res = await apiClient.electricityStatus(item.merchant_txn_id);
      return { nextStatus: res.local_bill?.status ?? res.status, message: res.message };
    },
    {
      invalidateKeys: [["electricity-bills"], ["wallet"]],
      onSettled: (_item, next, message) => toastPendingSettled(next, message, t),
    },
  );

  const filteredCounters = useMemo(() => {
    const q = counterQuery.trim().toLowerCase();
    if (!q) return counters;
    return counters.filter(
      (c) =>
        cleanCounterLabel(c).toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.value.toLowerCase().includes(q),
    );
  }, [counters, counterQuery]);

  const walletBalance = Number(walletQuery.data?.balance ?? 0);
  const walletBlocked = isWalletTxnLocked(walletQuery.data, user);
  const walletLockMessage = t(walletTxnLockMessageKey(walletQuery.data, user));
  const payAmount = Number(amount) || 0;
  const totalDue = Number(totalDebited) || payAmount;
  const insufficient = payAmount > 0 && totalDue > 0 && walletBalance < totalDue;
  const listingCounter = listSelection;

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
        .calculateCharge("NEA_PAY", payAmount)
        .then((res) => {
          if (cancelled) return;
          setCharge(String(res.charge));
          setCashback(String(res.cashback_credit ?? res.cashback));
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
      if (!selectedCounter) throw new Error(t("electricity.selectCounter"));
      const sc = scNo.trim();
      const cid = consumerId.trim();
      if (!sc) throw new Error(t("electricity.scRequired"));
      if (!cid) throw new Error(t("electricity.consumerIdRequired"));
      return apiClient.electricityInquiry({
        sc_no: sc,
        consumer_id: cid,
        office_code: selectedCounter.value,
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
      toast.success(t("electricity.inquirySuccess"));
    },
    onError: (err) => {
      toastApiError(err, {
        title: t("electricity.inquiryFailed"),
        fallback: t("electricity.inquiryFailed"),
      });
    },
  });

  const payMutation = useMutation({
    mutationFn: async (transaction_pin: string) => {
      if (!selectedCounter || !inquiry) throw new Error(t("electricity.inquiryRequired"));
      if (accountPending) throw new Error(t("account.pending"));
      if (walletBlocked) throw new Error(walletLockMessage);
      if (!enabled) throw new Error(t("electricity.disabledError"));
      if (payAmount <= 0) throw new Error(t("electricity.amountRequired"));
      if (insufficient) {
        throw new Error(
          t("topup.insufficient", {
            required: formatNPR(totalDue),
            available: formatNPR(walletBalance),
          }),
        );
      }
      const body: Parameters<typeof apiClient.electricityPay>[0] = {
        sc_no: scNo.trim(),
        consumer_id: consumerId.trim(),
        office_code: selectedCounter.value,
        office_name: cleanCounterLabel(selectedCounter),
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
      return apiClient.electricityPay(body);
    },
    onSuccess: (res) => {
      setPinOpen(false);
      setPinError(null);
      const isPending = res.data.status === "pending";
      if (isPending) {
        toast.message(res.message || t("electricity.pendingTitle"), {
          description: res.pending_message || t("topup.pendingBody"),
        });
      } else {
        toast.success(res.message || t("electricity.paySuccess"), {
          description: t("transfer.debited", {
            amount: formatNPR(res.data.total_debited || totalDebited),
          }),
        });
      }
      resetFlow();
      queryClient.invalidateQueries({ queryKey: ["electricity-bills"] });
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
            title: t("electricity.payFailed"),
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
        title: t("electricity.payFailed"),
        fallback: t("electricity.payFailed"),
      });
    },
  });

  const resetFlow = () => {
    setStep("list");
    setSelectedCounter(null);
    setListSelection(null);
    setCounterQuery("");
    setScNo("");
    setConsumerId("");
    setInquiry(null);
    setCustomerName("");
    setAmount("");
    setCharge("0.00");
    setCashback("0.00");
    setTotalDebited("0.00");
  };

  const openDetails = (counter: CounterOption) => {
    setSelectedCounter(counter);
    setListSelection(counter);
    setScNo("");
    setConsumerId("");
    setInquiry(null);
    setCustomerName("");
    setAmount("");
    setStep("details");
    setCounterPickerOpen(false);
  };

  const goBack = () => {
    if (step === "pay") {
      setStep("review");
      return;
    }
    if (step === "review") {
      setStep("details");
      setInquiry(null);
      return;
    }
    if (step === "details") {
      setStep("list");
      setSelectedCounter(null);
      setScNo("");
      setConsumerId("");
      return;
    }
    resetFlow();
  };

  const onListProceed = () => {
    if (!listingCounter) {
      toast.error(t("electricity.selectCounter"));
      setCounterPickerOpen(true);
      return;
    }
    openDetails(listingCounter);
  };

  return (
    <UserShell title={t("electricity.title")} hideHeader>
      <div
        className="-mx-3 min-h-[calc(100dvh-5.5rem)] sm:-mx-4"
        style={{ backgroundColor: PAGE_BG }}
      >
        {/* Curved header — home page gradient */}
        <header
          className="relative px-4 pt-[max(12px,var(--content-safe-top,var(--safe-area-top,env(safe-area-inset-top,0px))))] pb-7"
          style={{ background: HOME_GRADIENT }}
        >
          <div className="flex items-center gap-2">
            {step === "list" ? (
              <Link
                to="/app"
                aria-label={t("common.goBack")}
                className="inline-flex size-10 items-center justify-center text-white"
              >
                <ArrowLeft className="size-6" strokeWidth={2.25} />
              </Link>
            ) : (
              <button
                type="button"
                onClick={goBack}
                aria-label={t("common.goBack")}
                className="inline-flex size-10 items-center justify-center text-white"
              >
                <ArrowLeft className="size-6" strokeWidth={2.25} />
              </button>
            )}
            <h1 className="flex-1 text-center text-[20px] font-bold tracking-wide text-white">
              {t("electricity.title")}
            </h1>
            <button
              type="button"
              className="inline-flex size-10 items-center justify-center text-white"
              onClick={() => setSearchOpen(true)}
              aria-label={t("electricity.searchTitle")}
            >
              <Info className="size-6" strokeWidth={2} />
            </button>
          </div>
          {/* Downward curve */}
          <div
            className="pointer-events-none absolute inset-x-0 -bottom-4 h-8"
            style={{
              background: HOME_GRADIENT,
              borderBottomLeftRadius: "50% 100%",
              borderBottomRightRadius: "50% 100%",
            }}
            aria-hidden
          />
        </header>

        <div className="relative z-10 space-y-3.5 px-4 pt-2 pb-8">
          <AccountPendingBanner />
          {!enabled && !accountPending ? (
            <section className="rounded-2xl border border-destructive/20 bg-white p-4 shadow-sm">
              <p className="text-[15px] font-medium text-destructive">
                {t("electricity.disabledTitle")}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t("electricity.disabledBody")}
              </p>
            </section>
          ) : null}

          {/* ——— LIST (image 1) ——— */}
          {step === "list" ? (
            <>
              <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3.5 shadow-[0_2px_12px_-4px_rgba(16,24,40,0.12)]">
                <Wallet className="size-6 shrink-0 text-[#9CA3AF]" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <p className="tabular text-[17px] font-bold leading-tight text-[#111827]">
                    {walletQuery.isLoading ? "…" : formatBalanceNPR(walletBalance)}
                  </p>
                  <p className="text-[13px] text-[#9CA3AF]">{t("electricity.balanceLabel")}</p>
                </div>
                <button
                  type="button"
                  className="inline-flex size-9 items-center justify-center rounded-full text-[#9CA3AF]"
                  onClick={() => void walletQuery.refetch()}
                  aria-label={t("common.retry")}
                >
                  <RefreshCw
                    className={cn("size-5", walletQuery.isFetching && "animate-spin")}
                    strokeWidth={1.75}
                  />
                </button>
              </div>

              <ImportantInfoCard
                title={t("electricity.importantTitle")}
                body1={t("electricity.importantBody1")}
                body2={t("electricity.importantBody2")}
              />

              <div className="rounded-2xl bg-white px-4 py-4 shadow-[0_2px_12px_-4px_rgba(16,24,40,0.12)]">
                <Label
                  htmlFor="electricity_counter_list"
                  className="mb-2 block text-[15px] font-medium text-[#1F2937]"
                >
                  {t("electricity.counter")}
                </Label>
                <button
                  type="button"
                  id="electricity_counter_list"
                  disabled={!enabled}
                  onClick={() => {
                    setCounterQuery("");
                    setCounterPickerOpen(true);
                  }}
                  className={cn(
                    "flex h-12 w-full items-center justify-between rounded-xl px-3.5 text-left text-[15px] transition-colors disabled:opacity-50",
                    listingCounter
                      ? "border border-brand bg-white text-[#111827]"
                      : "border-0 bg-[#F3F4F6] text-[#9CA3AF]",
                  )}
                >
                  <span className="truncate">
                    {listingCounter
                      ? cleanCounterLabel(listingCounter)
                      : t("electricity.counterSelectPlaceholder")}
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    className="size-5 shrink-0 text-[#9CA3AF]"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z" />
                  </svg>
                </button>
              </div>

              <button
                type="button"
                disabled={!enabled}
                onClick={onListProceed}
                className="flex h-[52px] w-full items-center justify-center rounded-full text-[16px] font-bold tracking-[0.08em] text-white shadow-sm disabled:opacity-50"
                style={{ background: HOME_GRADIENT }}
              >
                {t("electricity.proceed")}
              </button>
            </>
          ) : null}

          {/* ——— DETAILS (image 2) ——— */}
          {step === "details" && selectedCounter ? (
            <>
              <ImportantInfoCard
                title={t("electricity.importantTitle")}
                body1={t("electricity.importantBody1")}
                body2={t("electricity.importantBody2")}
              />

              <div className="rounded-2xl bg-white px-4 py-4 shadow-[0_2px_12px_-4px_rgba(16,24,40,0.12)]">
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    inquiryMutation.mutate();
                  }}
                >
                  <div>
                    <Label
                      htmlFor="electricity_counter_details"
                      className="mb-2 block text-[15px] font-medium text-[#1F2937]"
                    >
                      {t("electricity.counter")}
                    </Label>
                    <Select
                      value={selectedCounter.value}
                      onValueChange={(value) => {
                        const match = counters.find((c) => c.value === value);
                        if (match) {
                          setSelectedCounter(match);
                          setListSelection(match);
                        }
                      }}
                      disabled={!enabled || !counters.length}
                    >
                      <SelectTrigger
                        id="electricity_counter_details"
                        className="h-12 rounded-xl border-brand bg-white text-[15px] text-[#111827] shadow-none focus:ring-brand/30"
                      >
                        <SelectValue placeholder={t("electricity.counterSelectPlaceholder")}>
                          {cleanCounterLabel(selectedCounter)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {counters.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {cleanCounterLabel(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label
                      htmlFor="sc_no"
                      className="mb-2 block text-[15px] font-medium text-[#1F2937]"
                    >
                      {t("electricity.scNumber")}
                    </Label>
                    <Input
                      id="sc_no"
                      value={scNo}
                      onChange={(e) => setScNo(e.target.value)}
                      placeholder={t("electricity.scPlaceholder")}
                      className="h-12 rounded-xl border-0 bg-[#F3F4F6] text-[15px] shadow-none placeholder:text-[#9CA3AF] focus-visible:ring-brand/30"
                      disabled={!enabled}
                      autoComplete="off"
                      required
                    />
                  </div>

                  <div>
                    <Label
                      htmlFor="consumer_id"
                      className="mb-2 block text-[15px] font-medium text-[#1F2937]"
                    >
                      {t("electricity.consumerId")}
                    </Label>
                    <Input
                      id="consumer_id"
                      value={consumerId}
                      onChange={(e) => setConsumerId(e.target.value)}
                      placeholder={t("electricity.consumerIdPlaceholder")}
                      className="h-12 rounded-xl border-0 bg-[#F3F4F6] text-[15px] shadow-none placeholder:text-[#9CA3AF] focus-visible:ring-brand/30"
                      disabled={!enabled}
                      autoComplete="off"
                      required
                    />
                  </div>
                </form>
              </div>

              <button
                type="button"
                disabled={inquiryMutation.isPending || !enabled}
                onClick={() => inquiryMutation.mutate()}
                className="flex h-[52px] w-full items-center justify-center rounded-full text-[16px] font-bold tracking-[0.08em] text-white shadow-sm disabled:opacity-50"
                style={{ background: HOME_GRADIENT }}
              >
                {inquiryMutation.isPending
                  ? t("electricity.liveInquiry")
                  : t("electricity.proceed")}
              </button>
            </>
          ) : null}

          {/* ——— REVIEW ——— */}
          {step === "review" && inquiry && selectedCounter ? (
            <>
              <div className="rounded-2xl bg-white px-4 py-4 shadow-[0_2px_12px_-4px_rgba(16,24,40,0.12)]">
                <dl className="space-y-2.5 text-[14px]">
                  <Row label={t("electricity.counter")} value={cleanCounterLabel(selectedCounter)} />
                  <Row label={t("electricity.scNumber")} value={scNo.trim()} mono />
                  <Row label={t("electricity.consumerId")} value={consumerId.trim()} mono />
                  {customerName ? (
                    <Row label={t("electricity.customerName")} value={customerName} />
                  ) : null}
                </dl>
                <div className="mt-4">
                  <Label
                    htmlFor="electricity_amount"
                    className="mb-2 block text-[15px] font-medium text-[#1F2937]"
                  >
                    {t("electricity.amount")}
                  </Label>
                  <Input
                    id="electricity_amount"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={t("electricity.amountPlaceholder")}
                    className="h-12 rounded-xl border-0 bg-[#F3F4F6] font-medium tabular shadow-none focus-visible:ring-brand/30"
                    disabled={!enabled}
                    required
                  />
                  <p className="mt-1.5 text-[12px] text-[#9CA3AF]">{t("electricity.amountHelp")}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={!enabled || payAmount <= 0}
                onClick={() => setStep("pay")}
                className="flex h-[52px] w-full items-center justify-center gap-1 rounded-full text-[16px] font-bold tracking-wide text-white disabled:opacity-50"
                style={{ background: HOME_GRADIENT }}
              >
                {t("electricity.continuePay")}
                <ChevronRight className="size-5" />
              </button>
            </>
          ) : null}

          {/* ——— PAY ——— */}
          {step === "pay" && selectedCounter && inquiry ? (
            <>
              <div className="rounded-2xl bg-white px-4 py-4 shadow-[0_2px_12px_-4px_rgba(16,24,40,0.12)]">
                <div
                  className="rounded-xl border p-3"
                  style={{ borderColor: `${NEA_GREEN}33`, backgroundColor: `${NEA_GREEN}0D` }}
                >
                  <p className="text-[13px] text-[#6B7280]">{t("electricity.title")}</p>
                  <p className="mt-1 text-[16px] font-semibold text-[#111827]">
                    {scNo.trim()} · {consumerId.trim()}
                  </p>
                  <p className="mt-2 tabular text-[28px] font-bold text-[#111827]">
                    {formatNPR(payAmount)}
                  </p>
                </div>
                <div className="mt-3 rounded-xl bg-[#F3F4F6] px-3 py-2.5">
                  <p className="text-[12px] text-[#9CA3AF]">{t("topup.walletLabel")}</p>
                  <p className="tabular text-[17px] font-semibold">
                    {walletQuery.isLoading ? "…" : formatNPR(walletBalance)}
                  </p>
                </div>
                <div className="mt-3 rounded-xl bg-[#F3F4F6] p-3 text-[14px]">
                  <FeeRow label={t("common.amount")} value={formatNPR(payAmount)} />
                  {userFacingChargeExtra({
                    amount: payAmount,
                    charge,
                    cashback,
                    totalDebited,
                  }) > 0 ? (
                    <FeeRow
                      label={t("electricity.serviceCharge")}
                      value={
                        feeLoading
                          ? "…"
                          : formatNPR(
                              userFacingChargeExtra({
                                amount: payAmount,
                                charge,
                                cashback,
                                totalDebited,
                              }),
                            )
                      }
                    />
                  ) : null}
                  <div className="mt-2 border-t border-[#E5E7EB] pt-2">
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
              </div>
              <button
                type="button"
                disabled={payMutation.isPending || feeLoading || insufficient || !enabled || walletBlocked}
                onClick={() => {
                  setPinError(null);
                  setPinOpen(true);
                }}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-bold text-white disabled:opacity-50"
                style={{ background: HOME_GRADIENT }}
              >
                <Check className="size-5" />
                {payMutation.isPending
                  ? t("common.processing")
                  : t("electricity.confirmPay", {
                      amount: formatNPR(totalDebited || payAmount),
                    })}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Counter picker sheet — full powerhouse list */}
      <Sheet open={counterPickerOpen} onOpenChange={setCounterPickerOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-hidden rounded-t-2xl px-0 pb-[max(1rem,calc(0.5rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] pt-4"
        >
          <SheetHeader className="mb-3 px-4 text-left">
            <SheetTitle>{t("electricity.powerhouseTitle")}</SheetTitle>
            <p className="text-[13px] text-muted-foreground">{t("electricity.powerhouseHelp")}</p>
          </SheetHeader>
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#9CA3AF]" />
              <Input
                value={counterQuery}
                onChange={(e) => setCounterQuery(e.target.value)}
                placeholder={t("electricity.searchCounters")}
                className="h-11 rounded-xl border-0 bg-[#F3F4F6] pl-9 shadow-none"
                autoFocus
              />
            </div>
          </div>
          {countersQuery.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-[#9CA3AF]">{t("common.loading")}</p>
          ) : countersQuery.isError ? (
            <div className="space-y-2 px-4 py-6">
              <p className="text-center text-sm text-destructive">{t("electricity.countersFailed")}</p>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full rounded-xl"
                onClick={() => void countersQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : !filteredCounters.length ? (
            <p className="px-4 py-8 text-center text-sm text-[#9CA3AF]">
              {t("electricity.noCounters")}
            </p>
          ) : (
            <ul className="max-h-[55vh] overflow-y-auto border-t border-[#F3F4F6]">
              {filteredCounters.map((counter) => {
                const active = listingCounter?.value === counter.value;
                return (
                  <li key={counter.value}>
                    <button
                      type="button"
                      onClick={() => openDetails(counter)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-3.5 text-left",
                        active ? "bg-brand-soft" : "hover:bg-[#F9FAFB]",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[#111827]">
                        {cleanCounterLabel(counter)}
                      </span>
                      {active ? (
                        <Check className="size-4 shrink-0 text-brand" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-[#D1D5DB]" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto overscroll-y-contain rounded-t-2xl px-4 pb-[max(2rem,calc(1rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] pt-5"
        >
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>{t("electricity.searchTitle")}</SheetTitle>
          </SheetHeader>
          <ListPageToolbar
            stats={electricityStats}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={async () => {
              setExporting(true);
              try {
                await downloadCsvExport(
                  "/api/electricity/history/",
                  debounced,
                  "electricity-bills.csv",
                );
              } finally {
                setExporting(false);
              }
            }}
            exporting={exporting}
            searchPlaceholder={t("electricity.searchPlaceholder")}
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
            style={{ background: HOME_GRADIENT }}
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

function ImportantInfoCard({
  title,
  body1,
  body2,
}: {
  title: string;
  body1: string;
  body2: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-brand/25 bg-white shadow-[0_2px_12px_-4px_rgba(16,24,40,0.08)]">
      <div className="flex items-center gap-2 bg-brand-soft px-4 py-2.5">
        <AlertTriangle className="size-[18px] shrink-0 text-brand" strokeWidth={2.25} />
        <p className="text-[15px] font-semibold text-brand-dark">{title}</p>
      </div>
      <ul className="space-y-2.5 px-4 py-3.5 text-[13px] leading-relaxed text-[#1F2937]">
        <li className="flex gap-2.5">
          <span className="mt-[7px] size-[5px] shrink-0 rounded-full bg-[#1F2937]" />
          <span>{body1}</span>
        </li>
        <li className="flex gap-2.5">
          <span className="mt-[7px] size-[5px] shrink-0 rounded-full bg-[#1F2937]" />
          <span>{body2}</span>
        </li>
      </ul>
    </section>
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
      <dt className="text-[#6B7280]">{label}</dt>
      <dd className={cn("text-right font-medium text-[#111827]", mono && "font-mono text-[13px]")}>
        {value}
      </dd>
    </div>
  );
}

function FeeRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-[#6B7280]">{label}</span>
      <span className={cn("tabular", strong ? "font-semibold text-[#111827]" : "font-medium")}>
        {value}
      </span>
    </div>
  );
}
