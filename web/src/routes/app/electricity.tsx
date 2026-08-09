import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Search,
  Zap,
  ChevronRight,
  ChevronUp,
  Check,
  RefreshCw,
  Wallet,
  Info,
  AlertTriangle,
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
import type { ElectricityBillTransaction, UtilityInquiry } from "@/lib/types";

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

const BOARD_OPTIONS = [{ id: "nea", labelKey: "electricity.nea" as const }];

function ElectricityBillPayment() {
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
  const [paymentsOpen, setPaymentsOpen] = useState(true);
  const accountPending = isAccountPending(user);

  const [step, setStep] = useState<Step>("list");
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [counters, setCounters] = useState<CounterOption[]>([]);
  const [counterQuery, setCounterQuery] = useState("");
  const [selectedCounter, setSelectedCounter] = useState<CounterOption | null>(null);
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
  });
  const enabled =
    settingsQuery.data?.config?.payment?.electricity_bills_enabled !== false && !accountPending;

  const countersQuery = useQuery({
    queryKey: ["electricity", "counters", selectedBoard],
    queryFn: () => apiClient.electricityCounters(),
    enabled: enabled && selectedBoard === "nea",
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
    queryKey: ["electricity-bills", debounced],
    queryFn: () => apiClient.electricityHistory(debounced),
    refetchInterval: LIVE_REFETCH_MS,
  });
  const electricityItems = useMemo(
    () => sortByLatestFirst(historyQuery.data?.items ?? []),
    [historyQuery.data?.items],
  );
  const electricityStats = historyQuery.data?.stats;

  const filteredCounters = useMemo(() => {
    const q = counterQuery.trim().toLowerCase();
    if (!q) return counters;
    return counters.filter(
      (c) => c.label.toLowerCase().includes(q) || c.value.toLowerCase().includes(q),
    );
  }, [counters, counterQuery]);

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
        .calculateCharge("NEA_PAY", payAmount)
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
        office_name: selectedCounter.label,
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
      setLastReceiptId(activityIdForKind("electricity", res.data.id));
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
    setSelectedBoard(null);
    setSelectedCounter(null);
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

  const selectBoard = (boardId: string) => {
    setSelectedBoard(boardId);
    setSelectedCounter(null);
    setCounterQuery("");
    setCounters([]);
    setScNo("");
    setConsumerId("");
    setInquiry(null);
  };

  const selectCounter = (counter: CounterOption) => {
    setSelectedCounter(counter);
    setScNo("");
    setConsumerId("");
    setInquiry(null);
    setCustomerName("");
    setAmount("");
    setStep("details");
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

  const shellOnBack = step === "list" ? undefined : goBack;

  return (
    <UserShell
      title={t("electricity.title")}
      {...(step === "list" ? { back: "/app" } : {})}
      {...(shellOnBack ? { onBack: shellOnBack } : {})}
      headerTrailing={
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
          aria-label={t("electricity.searchTitle")}
        >
          <Info className="size-4" />
        </Button>
      }
    >
      <div className="min-w-0 max-w-full space-y-4 overflow-x-clip">
        {accountPending ? <AccountPendingBanner /> : null}
        {!enabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4">
            <p className="text-[15px] font-medium text-destructive">
              {t("electricity.disabledTitle")}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("electricity.disabledBody")}
            </p>
          </section>
        ) : null}

        {step === "list" ? (
          <>
            <BalanceCard
              balance={walletBalance}
              loading={walletQuery.isLoading}
              fetching={walletQuery.isFetching}
              label={t("topup.walletLabel")}
              onRefresh={() => void walletQuery.refetch()}
              retryLabel={t("common.retry")}
            />

            <ImportantInfoCard
              title={t("electricity.importantTitle")}
              body1={t("electricity.importantBody1")}
              body2={t("electricity.importantBody2")}
            />

            <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
              <div className="space-y-1.5">
                <Label htmlFor="electricity_board">{t("electricity.board")}</Label>
                <Select
                  {...(selectedBoard ? { value: selectedBoard } : {})}
                  onValueChange={(value) => selectBoard(value)}
                  disabled={!enabled}
                >
                  <SelectTrigger
                    id="electricity_board"
                    className="h-12 rounded-xl border-transparent bg-muted text-[15px] shadow-none"
                  >
                    <SelectValue placeholder={t("electricity.boardSelectPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {BOARD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {t(opt.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedBoard === "nea" ? (
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-[15px] font-semibold">{t("electricity.powerhouseTitle")}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {t("electricity.powerhouseHelp")}
                    </p>
                  </div>

                  {countersQuery.isLoading ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {t("common.loading")}
                    </p>
                  ) : countersQuery.isError ? (
                    <div className="space-y-2">
                      <p className="text-sm text-destructive">{t("electricity.countersFailed")}</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full rounded-xl"
                        onClick={() => void countersQuery.refetch()}
                      >
                        {t("common.retry")}
                      </Button>
                    </div>
                  ) : !counters.length ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {t("electricity.noCounters")}
                    </p>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={counterQuery}
                          onChange={(e) => setCounterQuery(e.target.value)}
                          placeholder={t("electricity.searchCounters")}
                          className="h-11 rounded-xl border-transparent bg-muted pl-9 shadow-none"
                        />
                      </div>
                      <ul className="max-h-[42vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
                        {filteredCounters.map((counter) => (
                          <li key={counter.value}>
                            <button
                              type="button"
                              disabled={!enabled}
                              onClick={() => selectCounter(counter)}
                              className="flex w-full items-center gap-3 px-3 py-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                            >
                              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#F59E0B]/15 text-[#F59E0B]">
                                <Zap className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold">
                                  {counter.label}
                                </span>
                                {counter.label !== counter.value ? (
                                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                    {counter.value}
                                  </span>
                                ) : null}
                              </span>
                              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {step === "details" && selectedCounter ? (
          <>
            <ImportantInfoCard
              title={t("electricity.importantTitle")}
              body1={t("electricity.importantBody1")}
              body2={t("electricity.importantBody2")}
            />

            <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  inquiryMutation.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="electricity_counter">{t("electricity.counter")}</Label>
                  <Select
                    value={selectedCounter.value}
                    onValueChange={(value) => {
                      const match = counters.find((c) => c.value === value);
                      if (match) setSelectedCounter(match);
                    }}
                    disabled={!enabled || !counters.length}
                  >
                    <SelectTrigger
                      id="electricity_counter"
                      className="h-12 rounded-xl border-brand/40 bg-muted text-[15px] shadow-none"
                    >
                      <SelectValue placeholder={t("electricity.counterSelectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {counters.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sc_no">{t("electricity.scNumber")}</Label>
                  <Input
                    id="sc_no"
                    value={scNo}
                    onChange={(e) => setScNo(e.target.value)}
                    placeholder={t("electricity.scPlaceholder")}
                    className="h-12 rounded-xl border-transparent bg-muted font-medium shadow-none"
                    disabled={!enabled}
                    autoComplete="off"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="consumer_id">{t("electricity.consumerId")}</Label>
                  <Input
                    id="consumer_id"
                    value={consumerId}
                    onChange={(e) => setConsumerId(e.target.value)}
                    placeholder={t("electricity.consumerIdPlaceholder")}
                    className="h-12 rounded-xl border-transparent bg-muted font-medium shadow-none"
                    disabled={!enabled}
                    autoComplete="off"
                    required
                  />
                  <p className="text-[12px] text-muted-foreground">{t("electricity.accountHelp")}</p>
                </div>

                <Button
                  type="submit"
                  disabled={inquiryMutation.isPending || !enabled}
                  className="h-12 w-full rounded-full text-[17px] font-semibold tracking-wide"
                >
                  {inquiryMutation.isPending
                    ? t("electricity.liveInquiry")
                    : t("electricity.proceed")}
                </Button>
              </form>
            </section>
          </>
        ) : null}

        {step === "review" && inquiry && selectedCounter ? (
          <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">{t("electricity.stepReview")}</h2>
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
                <Row label={t("electricity.counter")} value={selectedCounter.label} />
                <Row label={t("electricity.scNumber")} value={scNo.trim()} mono />
                <Row label={t("electricity.consumerId")} value={consumerId.trim()} mono />
                {customerName ? (
                  <Row label={t("electricity.customerName")} value={customerName} />
                ) : null}
              </dl>
              <div className="space-y-1.5">
                <Label htmlFor="electricity_amount">{t("electricity.amount")}</Label>
                <Input
                  id="electricity_amount"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={t("electricity.amountPlaceholder")}
                  className="h-12 rounded-xl font-medium tabular"
                  disabled={!enabled}
                  required
                />
                <p className="text-[12px] text-muted-foreground">{t("electricity.amountHelp")}</p>
              </div>
              <Button
                type="button"
                disabled={!enabled || payAmount <= 0}
                className="h-12 w-full rounded-full text-[17px]"
                onClick={() => setStep("pay")}
              >
                {t("electricity.continuePay")}
                <ChevronRight className="ml-2 size-4" />
              </Button>
            </div>
          </section>
        ) : null}

        {step === "pay" && selectedCounter && inquiry ? (
          <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">{t("electricity.stepPay")}</h2>
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
                <p className="text-[13px] text-muted-foreground">{t("electricity.title")}</p>
                <p className="mt-1 text-[16px] font-semibold">
                  {scNo.trim()} · {consumerId.trim()}
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
                  : t("electricity.confirmPay", {
                      amount: formatNPR(totalDebited || payAmount),
                    })}
              </Button>
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 px-4 py-3 text-[14px] font-medium text-muted-foreground"
            onClick={() => setPaymentsOpen((v) => !v)}
          >
            <ChevronUp
              className={cn("size-4 transition-transform", !paymentsOpen && "rotate-180")}
            />
            {t("electricity.myPayments")}
          </button>

          {paymentsOpen ? (
            <div className="border-t border-border px-4 pb-4 pt-2">
              {lastReceiptId ? (
                <div className="mb-3">
                  <TransactionResultBanner
                    tone={
                      electricityItems.find(
                        (x) => activityIdForKind("electricity", x.id) === lastReceiptId,
                      )?.status === "failed"
                        ? "danger"
                        : electricityItems.find(
                              (x) => activityIdForKind("electricity", x.id) === lastReceiptId,
                            )?.status === "pending"
                          ? "warning"
                          : "success"
                    }
                    title={t("electricity.paySuccess")}
                    body={t("history.downloadStatement")}
                    receiptLabel={t("history.downloadPdf")}
                    onDownloadReceipt={() => void downloadReceipt(lastReceiptId)}
                    downloading={receiptDownloading}
                  />
                </div>
              ) : null}

              {historyQuery.isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t("common.loading")}
                </div>
              ) : !electricityItems.length ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t("electricity.empty")}
                </div>
              ) : (
                <ul className="divide-y divide-border overflow-hidden">
                  {electricityItems.map((item: ElectricityBillTransaction) => (
                    <li key={item.id} className="min-w-0 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-medium">
                            {item.sc_no} · {item.consumer_id}
                          </p>
                          <p className="truncate text-[13px] text-muted-foreground">
                            {item.office_name || item.office_code || item.merchant_txn_id} ·{" "}
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
                              void downloadReceipt(activityIdForKind("electricity", item.id))
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
      </div>

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
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 shadow-card">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
        <Wallet className="size-5" />
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
        className="size-9 shrink-0 rounded-full"
        onClick={onRefresh}
        aria-label={retryLabel}
      >
        <RefreshCw className={cn("size-4", fetching && "animate-spin")} />
      </Button>
    </div>
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
    <section className="overflow-hidden rounded-2xl border border-[#BFDBFE] bg-surface shadow-card">
      <div className="flex items-center gap-2 bg-[#EFF6FF] px-4 py-2.5">
        <AlertTriangle className="size-4 shrink-0 text-[#2563EB]" />
        <p className="text-[14px] font-semibold text-[#2563EB]">{title}</p>
      </div>
      <ul className="space-y-2 px-4 py-3 text-[13px] leading-relaxed text-foreground">
        <li className="flex gap-2">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/70" />
          <span>{body1}</span>
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/70" />
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
