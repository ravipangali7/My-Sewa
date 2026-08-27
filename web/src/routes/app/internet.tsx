import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search, Wifi, ChevronRight, Check } from "lucide-react";
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
import type {
  InternetBillInquiry,
  InternetBillPackage,
  InternetBillTransaction,
  IspOption,
} from "@/lib/types";

export const Route = createFileRoute("/app/internet")({
  head: () => ({
    meta: [
      { title: "Internet Bill Payment — MySewa" },
      {
        name: "description",
        content: "Pay Worldlink, Vianet, Subisu and other ISP bills from your MySewa business wallet.",
      },
    ],
  }),
  component: InternetBillPayment,
});

type Step = "isp" | "customer" | "review" | "pay";

function InternetBillPayment() {
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

  const [step, setStep] = useState<Step>("isp");
  const [selectedIsp, setSelectedIsp] = useState<IspOption | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [inquiry, setInquiry] = useState<InternetBillInquiry | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<InternetBillPackage | null>(null);
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
    settingsQuery.data?.config?.payment?.internet_bills_enabled !== false && !accountPending;

  const ispsQuery = useQuery({
    queryKey: ["internet", "isps"],
    queryFn: () => apiClient.internetIsps(),
    enabled,
  });

  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    ...liveQueryOptions(),
  });

  const historyQuery = useQuery({
    queryKey: ["internet-bills", debounced],
    queryFn: () => apiClient.internetHistory(debounced),
    ...liveQueryOptions(),
  });
  const internetItems = useMemo(
    () => sortByLatestFirst(historyQuery.data?.items ?? []),
    [historyQuery.data?.items],
  );
  const internetStats = historyQuery.data?.stats;

  usePendingStatusPoll(
    internetItems,
    async (item) => {
      const res = await apiClient.internetStatus(item.merchant_txn_id);
      return { nextStatus: res.local_bill?.status ?? res.status, message: res.message };
    },
    {
      invalidateKeys: [["internet-bills"], ["wallet"]],
      onSettled: (_item, next, message) => toastPendingSettled(next, message, t),
    },
  );

  const walletBalance = Number(walletQuery.data?.balance ?? 0);
  const walletBlocked = isWalletTxnLocked(walletQuery.data, user);
  const walletLockMessage = t(walletTxnLockMessageKey(walletQuery.data, user));
  const pkgAmount = Number(selectedPackage?.amount ?? 0);
  const totalDue = Number(totalDebited) || pkgAmount;
  const insufficient = pkgAmount > 0 && totalDue > 0 && walletBalance < totalDue;

  useEffect(() => {
    if (!selectedPackage || !selectedIsp || pkgAmount <= 0 || !enabled) {
      setCharge("0.00");
      setCashback("0.00");
      setTotalDebited("0.00");
      return;
    }
    let cancelled = false;
    setFeeLoading(true);
    const payService = selectedIsp.pay_service || "WLINK_PAY";
    const timer = setTimeout(() => {
      apiClient
        .calculateCharge(payService, pkgAmount)
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
            setTotalDebited(pkgAmount.toFixed(2));
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
  }, [selectedPackage, selectedIsp, pkgAmount, enabled]);

  const inquiryMutation = useMutation({
    mutationFn: async () => {
      if (!selectedIsp) throw new Error(t("internet.selectIsp"));
      const cleaned = customerId.trim();
      if (!cleaned) throw new Error(t("internet.customerRequired"));
      return apiClient.internetInquiry({ isp_id: selectedIsp.id, customer_id: cleaned });
    },
    onSuccess: (res) => {
      setInquiry(res.data);
      setStep("review");
      toast.success(t("internet.inquirySuccess"));
    },
    onError: (err) => {
      toastApiError(err, { title: t("internet.inquiryFailed"), fallback: t("internet.inquiryFailed") });
    },
  });

  const payMutation = useMutation({
    mutationFn: async (transaction_pin: string) => {
      if (!selectedIsp || !inquiry || !selectedPackage) {
        throw new Error(t("internet.selectPackageError"));
      }
      if (accountPending) throw new Error(t("account.pending"));
      if (walletBlocked) throw new Error(walletLockMessage);
      if (!enabled) throw new Error(t("internet.disabledError"));
      if (insufficient) {
        throw new Error(
          t("topup.insufficient", {
            required: formatNPR(totalDue),
            available: formatNPR(walletBalance),
          }),
        );
      }
      return apiClient.internetPay({
        isp_id: selectedIsp.id,
        customer_id: inquiry.customer_id,
        amount: Number(Number(selectedPackage.amount).toFixed(2)),
        package_name: selectedPackage.name,
        customer_name: inquiry.customer_name || selectedPackage.customer_name || "",
        pay_data: selectedPackage.pay_data,
        transaction_pin,
      });
    },
    onSuccess: (res) => {
      setPinOpen(false);
      setPinError(null);
      const isPending = res.data.status === "pending";
      if (isPending) {
        toast.message(res.message || t("internet.pendingTitle"), {
          description: res.pending_message || t("topup.pendingBody"),
        });
      } else {
        toast.success(res.message || t("internet.paySuccess"), {
          description: t("transfer.debited", {
            amount: formatNPR(res.data.total_debited || totalDebited),
          }),
        });
      }
      resetFlow();
      setLastReceiptId(activityIdForKind("internet", res.data.id));
      queryClient.invalidateQueries({ queryKey: ["internet-bills"] });
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
            title: t("internet.payFailed"),
            fallback: t("topup.insufficient", {
              required: formatNPR(String(body["required"] ?? totalDue)),
              available: formatNPR(String(body["available"] ?? walletBalance)),
            }),
          });
          return;
        }
      }
      setPinOpen(false);
      toastApiError(err, { title: t("internet.payFailed"), fallback: t("internet.payFailed") });
    },
  });

  const resetFlow = () => {
    setStep("isp");
    setSelectedIsp(null);
    setCustomerId("");
    setInquiry(null);
    setSelectedPackage(null);
    setCharge("0.00");
    setCashback("0.00");
    setTotalDebited("0.00");
  };

  const goBack = () => {
    if (step === "pay") setStep("review");
    else if (step === "review") setStep("customer");
    else if (step === "customer") setStep("isp");
  };

  const stepTitle = useMemo(() => {
    if (step === "isp") return t("internet.stepIsp");
    if (step === "customer") return t("internet.stepCustomer");
    if (step === "review") return t("internet.stepReview");
    return t("internet.stepPay");
  }, [step, t]);

  const isps = ispsQuery.data?.isps ?? [];
  const localIspLogos: Record<string, string> = {
    worldlink: "/isps/worldlink.png",
    vianet: "/isps/vianet.png",
    subisu: "/isps/subisu.png",
    dishhome: "/isps/dishhome.png",
  };
  const ispLogoDomainByName: Record<string, string> = {
    worldlink: "worldlink.com.np",
    vianet: "vianet.com.np",
    subisu: "subisu.net.np",
    "dish home": "dishhome.com.np",
    dishhome: "dishhome.com.np",
  };

  const resolveIspLogo = (isp: IspOption) => {
    if (localIspLogos[isp.id]) return localIspLogos[isp.id];
    if (isp.logo_image_url) return isp.logo_image_url;
    const normalizedName = isp.name.toLowerCase();
    const matched = Object.entries(ispLogoDomainByName).find(([key]) =>
      normalizedName.includes(key),
    );
    if (!matched) return null;
    return `https://logo.clearbit.com/${matched[1]}`;
  };

  return (
    <UserShell
      title={t("internet.title")}
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
          aria-label={t("internet.searchTitle")}
        >
          <Search className="size-4" />
        </Button>
      }
    >
      <div className="min-w-0 max-w-full space-y-5 overflow-x-clip">
        <AccountPendingBanner />
        {!enabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4">
            <p className="text-[15px] font-medium text-destructive">{t("internet.disabledTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("internet.disabledBody")}</p>
          </section>
        ) : null}

        <section className="inset-group min-w-0 max-w-full p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{stepTitle}</h2>
            {step !== "isp" ? (
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

          {step === "isp" ? (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">{t("internet.ispHelp")}</p>
              {ispsQuery.isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {isps.map((isp) => (
                    <li key={isp.id}>
                      <button
                        type="button"
                        disabled={!enabled}
                        onClick={() => {
                          setSelectedIsp(isp);
                          setStep("customer");
                        }}
                        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-3 text-left shadow-card transition-colors hover:border-brand/40 hover:bg-brand/5 disabled:opacity-50"
                      >
                        <span
                          className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-border"
                        >
                          {resolveIspLogo(isp) ? (
                            <img
                              src={resolveIspLogo(isp)!}
                              alt={`${isp.name} logo`}
                              className="size-full object-contain p-1"
                              loading="lazy"
                            />
                          ) : (
                            <span
                              className="flex size-full items-center justify-center rounded-full text-white"
                              style={{ backgroundColor: isp.color || "#2563EB" }}
                            >
                              <Wifi className="size-5" />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{isp.name}</span>
                          <span className="block text-[12px] text-muted-foreground">
                            {isp.customer_label}
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

          {step === "customer" && selectedIsp ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                inquiryMutation.mutate();
              }}
            >
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                <span
                  className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-border"
                >
                  {resolveIspLogo(selectedIsp) ? (
                    <img
                      src={resolveIspLogo(selectedIsp)!}
                      alt={`${selectedIsp.name} logo`}
                      className="size-full object-contain p-1"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className="flex size-full items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: selectedIsp.color || "#2563EB" }}
                    >
                      <Wifi className="size-4" />
                    </span>
                  )}
                </span>
                <div>
                  <p className="text-[14px] font-semibold">{selectedIsp.name}</p>
                  <p className="text-[12px] text-muted-foreground">{t("internet.billPayment")}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer_id">{selectedIsp.customer_label}</Label>
                <Input
                  id="customer_id"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  placeholder={selectedIsp.placeholder}
                  className="h-12 rounded-xl font-medium"
                  disabled={!enabled}
                  autoComplete="off"
                  required
                />
                <p className="text-[12px] text-muted-foreground">{t("internet.customerHelp")}</p>
              </div>
              <Button
                type="submit"
                disabled={inquiryMutation.isPending || !enabled}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                <Search className="mr-2 size-4" />
                {inquiryMutation.isPending ? t("internet.liveInquiry") : t("internet.inquiry")}
              </Button>
            </form>
          ) : null}

          {step === "review" && inquiry ? (
            <div className="space-y-4">
              <dl className="space-y-2 rounded-xl bg-muted/50 p-3 text-[14px]">
                <Row label={t("internet.isp")} value={inquiry.isp_name} />
                <Row label={selectedIsp?.customer_label ?? t("internet.customerId")} value={inquiry.customer_id} mono />
                <Row
                  label={t("internet.customerName")}
                  value={
                    (inquiry.customer_name || "").trim() ||
                    [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
                    (user?.nickname || "").trim() ||
                    t("profile.emailEmpty")
                  }
                />
                {inquiry.current_package ? (
                  <Row label={t("internet.currentPackage")} value={inquiry.current_package} />
                ) : null}
                {inquiry.billing_period ? (
                  <Row label={t("internet.billingPeriod")} value={String(inquiry.billing_period)} />
                ) : null}
                {inquiry.due_date ? (
                  <Row label={t("internet.dueDate")} value={inquiry.due_date} />
                ) : null}
                {inquiry.subscription_status ? (
                  <Row label={t("internet.subscriptionStatus")} value={inquiry.subscription_status} />
                ) : null}
                {inquiry.payable_amount ? (
                  <Row label={t("internet.payableAmount")} value={formatNPR(inquiry.payable_amount)} strong />
                ) : null}
                <Row
                  label={t("common.mobile")}
                  value={(inquiry.phone || "").trim() || user?.phone || "—"}
                />
              </dl>

              <div className="space-y-2">
                <p className="text-[13px] font-medium text-muted-foreground">
                  {t("internet.selectPackage")}
                </p>
                <ul className="space-y-2">
                  {inquiry.packages.map((pkg) => {
                    const selected = selectedPackage?.id === pkg.id;
                    return (
                      <li key={pkg.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPackage(pkg);
                            setStep("pay");
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                            selected
                              ? "border-brand bg-brand/10"
                              : "border-border bg-surface hover:border-brand/30",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-semibold">{pkg.name}</p>
                            {pkg.billing_period ? (
                              <p className="text-[12px] text-muted-foreground">
                                {t("internet.billingPeriod")}: {String(pkg.billing_period)}
                              </p>
                            ) : null}
                          </div>
                          <p className="tabular text-[16px] font-bold text-brand-dark">
                            {formatNPR(pkg.amount)}
                          </p>
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : null}

          {step === "pay" && selectedPackage && inquiry && selectedIsp ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand/20 bg-brand/5 p-3">
                <p className="text-[13px] text-muted-foreground">{selectedIsp.name}</p>
                <p className="mt-1 text-[16px] font-semibold">{selectedPackage.name}</p>
                <p className="mt-2 tabular text-[28px] font-bold">{formatNPR(selectedPackage.amount)}</p>
              </div>

              <div className="rounded-xl bg-muted px-3 py-2.5 text-[14px]">
                <p className="text-[12px] text-muted-foreground">{t("topup.walletLabel")}</p>
                <p className="tabular text-[17px] font-semibold">
                  {walletQuery.isLoading ? "…" : formatNPR(walletBalance)}
                </p>
              </div>

              <div className="rounded-xl bg-muted p-3 text-[14px]">
                <FeeRow label={t("common.amount")} value={formatNPR(pkgAmount)} />
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
                  : t("internet.confirmPay", { amount: formatNPR(totalDebited || pkgAmount) })}
              </Button>
            </div>
          ) : null}
        </section>

        <section>
          {lastReceiptId ? (
            <div className="mb-3">
              <TransactionResultBanner
                tone={
                  internetItems.find(
                    (x) => activityIdForKind("internet", x.id) === lastReceiptId,
                  )?.status === "failed"
                    ? "danger"
                    : internetItems.find(
                          (x) => activityIdForKind("internet", x.id) === lastReceiptId,
                        )?.status === "pending"
                      ? "warning"
                      : "success"
                }
                title={t("internet.paySuccess")}
                body={t("history.downloadStatement")}
                receiptLabel={t("history.downloadPdf")}
                onDownloadReceipt={() => void downloadReceipt(lastReceiptId)}
                downloading={receiptDownloading}
              />
            </div>
          ) : null}
          <div className="mb-2 mt-4 px-1">
            <h2 className="text-[17px] font-semibold">{t("internet.history")}</h2>
          </div>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !internetItems.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("internet.empty")}
            </div>
          ) : (
            <ul className="inset-group min-w-0 divide-y divide-border overflow-hidden">
              {internetItems.map((item: InternetBillTransaction) => (
                <li key={item.id} className="min-w-0 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        {item.isp_name} · {item.customer_id}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {item.package_name || item.merchant_txn_id} · {formatDateTime(item.created_at)}
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
                          void downloadReceipt(activityIdForKind("internet", item.id))
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
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto overscroll-y-contain rounded-t-2xl px-4 pb-[max(2rem,calc(1rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] pt-5">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>{t("internet.searchTitle")}</SheetTitle>
          </SheetHeader>
          <ListPageToolbar
            stats={internetStats}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={async () => {
              setExporting(true);
              try {
                await downloadCsvExport("/api/internet/history/", debounced, "internet-bills.csv");
              } finally {
                setExporting(false);
              }
            }}
            exporting={exporting}
            searchPlaceholder={t("internet.searchPlaceholder")}
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
