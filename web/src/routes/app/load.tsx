import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Upload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { DepositAccountsPanel } from "@/components/DepositAccountsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDateTime, formatDate, sortByLatestFirst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { liveQueryOptions, settingsQueryOptions } from "@/lib/refresh";
import { isAccountPending, isWalletFrozen } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { useI18n } from "@/lib/i18n";
import type { TranslateFn } from "@/lib/i18n";
import { ListPageToolbar, ReceiptDownloadLink, TransactionResultBanner } from "@/components/list/ListPageToolbar";
import { useListFilters, DEPOSIT_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { activityIdForKind, useReceiptDownload } from "@/lib/receipt-download";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { enabledPaymentAccounts } from "@/lib/payment-accounts";
import { toDataURL } from "@/lib/qrcode";
import { isMySewaNativeApp, openExternalUrl } from "@/lib/native-app";
import type { DepositDestinations, PaymentMethod } from "@/lib/types";

const DEPOSIT_PAYMENT_METHODS: PaymentMethod[] = ["bank", "khalti", "esewa"];

type DestSource = "platform" | "dealer" | "checkout";

type PaybridgeDepositState = {
  depositId: number;
  paymentUrl: string;
  orderId: string;
  sessionId: string;
  amount: string;
  mode: "direct_qr" | "hosted" | string;
  qrImage: string;
  qrMessage: string;
  eventsUrl: string;
  expiresAt: string | null;
  qrScanned: boolean;
};

function resolveQrImage(qrImage: string, qrMessage: string): string {
  if (qrImage) return qrImage;
  if (!qrMessage) return "";
  try {
    return toDataURL(qrMessage, {
      width: 320,
      color: { dark: "#111827", light: "#FFFFFF" },
    });
  } catch {
    return "";
  }
}

function paymentMethodLabel(method: PaymentMethod, t: TranslateFn): string {
  if (method === "khalti") return t("load.methodKhalti");
  if (method === "esewa") return t("load.methodEsewa");
  return t("load.methodBank");
}

/** Value stored in Deposit.bank_name for admin review. */
function depositSourceLabel(
  method: PaymentMethod | "",
  bankName: string,
): string {
  if (method === "khalti") return "Khalti";
  if (method === "esewa") return "eSewa";
  if (method === "bank") {
    const name = bankName.trim();
    return name || "Bank";
  }
  return "";
}

function destinationBucket(
  dest: DepositDestinations | undefined,
  settingsBankDetails: DepositDestinations["bank_details"] | undefined,
  settingsQr: {
    qr_code_url?: string | null | undefined;
    khalti_qr_code_url?: string | null | undefined;
    esewa_qr_code_url?: string | null | undefined;
  },
  source: DestSource,
) {
  if (source === "dealer") {
    return dest?.dealer ?? null;
  }
  return (
    dest?.platform ?? {
      bank_details: dest?.bank_details ?? settingsBankDetails ?? null,
      qr_code_url: dest?.qr_code_url ?? settingsQr.qr_code_url ?? null,
      khalti_qr_code_url: dest?.khalti_qr_code_url ?? settingsQr.khalti_qr_code_url ?? null,
      esewa_qr_code_url: dest?.esewa_qr_code_url ?? settingsQr.esewa_qr_code_url ?? null,
    }
  );
}

export const Route = createFileRoute("/app/load")({
  head: () => ({
    meta: [
      { title: "Load Wallet — MySewa" },
      {
        name: "description",
        content:
          "Load your MySewa wallet with an in-app Fonepay QR via PayBridgeNP, or submit a manual deposit with payment proof.",
      },
      { property: "og:title", content: "Load Wallet — MySewa" },
      {
        property: "og:description",
        content: "Deposit via in-app PayBridgeNP QR or submit a manual wallet load request.",
      },
    ],
  }),
  component: LoadWallet,
});

function todayIsoDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function LoadWallet() {
  const queryClient = useQueryClient();
  const { user, wallet, token } = useAuth();
  const { t } = useI18n();
  const { logoUrl } = useSiteBranding();
  const { download: downloadReceipt, downloading: receiptDownloading } = useReceiptDownload(
    t,
    user?.phone,
    logoUrl,
  );
  const { filters, setFilters, debounced } = useListFilters();
  const [searchOpen, setSearchOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);
  const accountPending = isAccountPending(user);
  const walletFrozen = isWalletFrozen(wallet, user);
  const [transactionId, setTransactionId] = useState("");
  const [amount, setAmount] = useState("");
  const [depositDate, setDepositDate] = useState(todayIsoDate);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [bankName, setBankName] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [destSource, setDestSource] = useState<DestSource>("platform");
  const [checkoutAmount, setCheckoutAmount] = useState("");
  const [paybridgeDeposit, setPaybridgeDeposit] = useState<PaybridgeDepositState | null>(null);
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const checkoutPaidToast = useRef(false);

  const destQuery = useQuery({
    queryKey: ["deposit-destinations"],
    queryFn: () => apiClient.depositDestinations(),
    ...settingsQueryOptions(),
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
    ...settingsQueryOptions(),
  });

  const depositsQuery = useQuery({
    queryKey: ["deposits", debounced],
    queryFn: () => apiClient.listDeposits(debounced),
    ...liveQueryOptions(),
  });
  const depositItems = useMemo(
    () => sortByLatestFirst(depositsQuery.data?.items ?? []),
    [depositsQuery.data?.items],
  );
  const depositStats = depositsQuery.data?.stats;

  const payment = settingsQuery.data?.config?.payment;
  const security = settingsQuery.data?.config?.security;
  const depositsEnabled = payment?.deposits_enabled !== false && !accountPending && !walletFrozen;
  const requireScreenshot = security?.require_deposit_screenshot !== false;
  const minDeposit = payment?.min_deposit ?? 100;
  const maxDeposit = payment?.max_deposit ?? 100000;
  const instructions = payment?.deposit_instructions?.trim() || "";
  const canChooseDealer =
    destQuery.data?.can_use_dealer ??
    Boolean(user?.role === "customer" && user?.assigned_dealer_id);
  const payingCheckout = destSource === "checkout";
  const activeSource: DestSource = payingCheckout
    ? "checkout"
    : canChooseDealer && destSource === "dealer"
      ? "dealer"
      : "platform";
  const loadTabCount = 2 + (canChooseDealer ? 1 : 0);
  const activeDest = destinationBucket(
    destQuery.data,
    settingsQuery.data?.bank_details,
    {
      qr_code_url: settingsQuery.data?.qr_code_url,
      khalti_qr_code_url: settingsQuery.data?.khalti_qr_code_url,
      esewa_qr_code_url: settingsQuery.data?.esewa_qr_code_url,
    },
    activeSource,
  );
  const payingDealer = activeSource === "dealer";
  const dealerAccounts = payingDealer ? enabledPaymentAccounts(activeDest?.bank_details) : [];
  const dealerHasAccounts = !payingDealer || dealerAccounts.length > 0;

  const resetForm = () => {
    setTransactionId("");
    setAmount("");
    setDepositDate(todayIsoDate());
    setPaymentMethod("");
    setBankName("");
    setNote("");
    setFile(null);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (accountPending) throw new Error(t("account.pending"));
      if (walletFrozen) throw new Error(t("account.walletFrozen"));
      if (!depositsEnabled) throw new Error(t("load.disabledError"));
      const tid = transactionId.trim();
      if (!tid) throw new Error(t("load.txnIdRequired"));
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error(t("load.validAmount"));
      if (amt < minDeposit) throw new Error(t("load.minError", { min: minDeposit }));
      if (maxDeposit > 0 && amt > maxDeposit)
        throw new Error(t("load.maxError", { max: maxDeposit }));
      if (!depositDate) throw new Error(t("load.depositDateRequired"));
      if (!paymentMethod) throw new Error(t("load.paymentMethodRequired"));
      if (requireScreenshot && !file) throw new Error(t("load.screenshotRequired"));
      const fd = new FormData();
      fd.append("amount", amount);
      fd.append("transaction_id", tid);
      fd.append("deposit_date", depositDate);
      const source = depositSourceLabel(paymentMethod, bankName);
      if (source) fd.append("bank_name", source);
      const dest = destQuery.data;
      if (payingDealer && paymentMethod) {
        const match = (dest?.dealer?.bank_details?.accounts ?? []).find(
          (acc) => acc.method === paymentMethod && acc.enabled !== false,
        );
        if (!match?.payout_account_id) {
          throw new Error(t("load.dealerPayoutRequired"));
        }
        fd.append("payout_account_id", String(match.payout_account_id));
      }
      if (note.trim()) fd.append("note", note.trim());
      if (file) fd.append("screenshot_proof", file);
      return apiClient.createDeposit(fd);
    },
    onSuccess: (res) => {
      const approved = res.data?.status === "approved";
      toast.success(t("load.submitted"), {
        description: approved
          ? t("load.autoApproved")
          : payingDealer
            ? t("load.pendingDealerApproval")
            : t("load.pendingApproval"),
      });
      resetForm();
      setLastReceiptId(activityIdForKind("deposit", res.data.id));
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError || err instanceof Error ? err.message : t("load.submitFailed"),
      );
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      if (accountPending) throw new Error(t("account.pending"));
      if (walletFrozen) throw new Error(t("account.walletFrozen"));
      if (!depositsEnabled) throw new Error(t("load.disabledError"));
      const amt = Number(checkoutAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error(t("load.validAmount"));
      if (amt < minDeposit) throw new Error(t("load.minError", { min: minDeposit }));
      if (maxDeposit > 0 && amt > maxDeposit)
        throw new Error(t("load.maxError", { max: maxDeposit }));
      if (amt < 10) throw new Error(t("load.checkoutMinError"));
      return apiClient.paybridgeInitiate({ amount: amt });
    },
    onSuccess: (res) => {
      const depositId = Number(res.data?.id || 0);
      const paymentUrl = res.checkout_url || res.payment_url || "";
      const qrImage = resolveQrImage(res.qr_image || "", res.qr_message || "");
      const mode = String(
        res.mode ||
          (qrImage || res.qr_message ? "direct_qr" : paymentUrl ? "hosted" : ""),
      );
      // Prefer in-app Fonepay QR. Hosted checkout cannot be embedded (X-Frame-Options).
      if (!depositId || (!qrImage && !res.qr_message && !paymentUrl)) {
        toast.error(t("load.checkoutFailed"));
        return;
      }
      checkoutPaidToast.current = false;
      setPaybridgeDeposit({
        depositId,
        paymentUrl,
        orderId: res.data?.purchase_order_identifier || "",
        sessionId: res.session_id || res.data?.process_id || "",
        amount: String(res.data?.amount || checkoutAmount),
        mode: qrImage || res.qr_message ? "direct_qr" : mode,
        qrImage,
        qrMessage: res.qr_message || "",
        eventsUrl: res.events_url || "",
        expiresAt: res.expires_at || null,
        qrScanned: false,
      });
      setPaymentSheetOpen(true);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : t("load.checkoutFailed"),
      );
    },
  });

  const refreshQrMutation = useMutation({
    mutationFn: async (depositId: number) => apiClient.paybridgeRefreshQr({ deposit_id: depositId }),
    onSuccess: (res) => {
      const qrImage = resolveQrImage(res.qr_image || "", res.qr_message || "");
      setPaybridgeDeposit((prev) =>
        prev
          ? {
              ...prev,
              qrImage: qrImage || prev.qrImage,
              qrMessage: res.qr_message || prev.qrMessage,
              eventsUrl: res.events_url || prev.eventsUrl,
              expiresAt: res.expires_at || null,
              sessionId: res.session_id || prev.sessionId,
              qrScanned: false,
            }
          : prev,
      );
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : t("load.checkoutQrRefreshFailed"),
      );
    },
  });

  useEffect(() => {
    if (!payingCheckout) return;
    if (!checkoutAmount) {
      setCheckoutAmount(String(Math.max(minDeposit, 10)));
    }
  }, [payingCheckout, minDeposit, checkoutAmount]);

  const checkoutStatusQuery = useQuery({
    queryKey: ["paybridge-status", paybridgeDeposit?.depositId],
    enabled: Boolean(token) && Boolean(paybridgeDeposit?.depositId) && paymentSheetOpen,
    queryFn: () => apiClient.paybridgeStatus(paybridgeDeposit!.depositId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (
        status === "approved" ||
        status === "failed" ||
        status === "cancelled" ||
        status === "expired" ||
        status === "refunded" ||
        status === "rejected"
      ) {
        return false;
      }
      return 4000;
    },
  });

  // Live Direct-QR events (scan / paid / expired) without leaving the app.
  useEffect(() => {
    if (!paymentSheetOpen || !paybridgeDeposit?.eventsUrl) return;
    if (typeof EventSource === "undefined") return;

    const source = new EventSource(paybridgeDeposit.eventsUrl);
    const onScanned = () => {
      setPaybridgeDeposit((prev) => (prev ? { ...prev, qrScanned: true } : prev));
    };
    const onPaid = () => {
      void checkoutStatusQuery.refetch();
    };
    const onExpired = () => {
      if (paybridgeDeposit.depositId) {
        refreshQrMutation.mutate(paybridgeDeposit.depositId);
      }
    };

    source.addEventListener("qr.scanned", onScanned);
    source.addEventListener("qr.paid", onPaid);
    source.addEventListener("qr.expired", onExpired);
    source.onerror = () => {
      // Browser auto-reconnects; keep polling via status query as backup.
    };

    return () => {
      source.removeEventListener("qr.scanned", onScanned);
      source.removeEventListener("qr.paid", onPaid);
      source.removeEventListener("qr.expired", onExpired);
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally tied to session URL
  }, [paymentSheetOpen, paybridgeDeposit?.eventsUrl, paybridgeDeposit?.depositId]);

  useEffect(() => {
    const status = checkoutStatusQuery.data?.status;
    if (status !== "approved") return;
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["deposits"] });
    if (!checkoutPaidToast.current) {
      checkoutPaidToast.current = true;
      toast.success(t("load.checkoutSuccess"));
      setPaymentSheetOpen(false);
      setPaybridgeDeposit(null);
    }
  }, [checkoutStatusQuery.data?.status, queryClient, t]);

  const liveCheckout = checkoutStatusQuery.data;
  const checkoutAmountValue = liveCheckout?.amount || paybridgeDeposit?.amount || "";
  const checkoutPaid = liveCheckout?.status === "approved";
  const checkoutNeedsRetry =
    liveCheckout?.status === "failed" ||
    liveCheckout?.status === "cancelled" ||
    liveCheckout?.status === "expired";
  const checkoutWaiting =
    !checkoutPaid &&
    !checkoutNeedsRetry &&
    Boolean(paybridgeDeposit) &&
    (liveCheckout?.status === "pending" ||
      liveCheckout?.status === "processing" ||
      !liveCheckout?.status);
  const showInAppQr = Boolean(paybridgeDeposit?.qrImage) && !checkoutPaid;
  const showHostedFallback =
    !showInAppQr && Boolean(paybridgeDeposit?.paymentUrl) && !checkoutPaid;

  return (
    <UserShell
      title={t("load.pageTitle")}
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
          aria-label={t("load.searchTitle")}
        >
          <Search className="size-4" />
        </Button>
      }
    >
      <div className="grid min-w-0 max-w-full gap-5 lg:grid-cols-2">
        {accountPending || walletFrozen ? (
          <div className="lg:col-span-2">
            <AccountPendingBanner />
          </div>
        ) : null}
        {!depositsEnabled && !accountPending && !walletFrozen ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4 lg:col-span-2">
            <p className="text-[15px] font-medium text-destructive">{t("load.disabledTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("load.disabledBody")}</p>
          </section>
        ) : null}

        {depositsEnabled ? (
          <>
            <div className="lg:col-span-2">
                <Tabs
                  value={activeSource}
                  onValueChange={(value) => {
                    setDestSource(value as DestSource);
                    setPaymentMethod("");
                    setBankName("");
                  }}
                >
                  <TabsList
                    className={cn(
                      "grid h-11 w-full rounded-xl",
                      loadTabCount === 3 ? "grid-cols-3" : "grid-cols-2",
                    )}
                  >
                    <TabsTrigger value="platform" className="rounded-lg">
                      {t("load.sourceSuperAdmin")}
                    </TabsTrigger>
                    {canChooseDealer ? (
                      <TabsTrigger value="dealer" className="rounded-lg">
                        {t("load.sourceDealer")}
                      </TabsTrigger>
                    ) : null}
                    <TabsTrigger value="checkout" className="rounded-lg">
                      {t("load.sourceDeposit")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
            </div>

            {payingCheckout ? (
              <section className="inset-group min-w-0 max-w-full space-y-4 p-4 lg:col-span-2">
                <div>
                  <h2 className="text-[15px] font-semibold">{t("load.checkoutTitle")}</h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">{t("load.checkoutHelp")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="paybridge_amount">{t("load.depositedAmount")}</Label>
                  <Input
                    id="paybridge_amount"
                    type="number"
                    inputMode="decimal"
                    min={Math.max(minDeposit, 10)}
                    max={maxDeposit > 0 ? maxDeposit : undefined}
                    step="1"
                    value={checkoutAmount}
                    onChange={(e) => setCheckoutAmount(e.target.value)}
                    className="h-11 rounded-xl"
                    placeholder={String(Math.max(minDeposit, 10))}
                    disabled={checkoutMutation.isPending}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    {t("load.minError", { min: Math.max(minDeposit, 10) })}
                    {maxDeposit > 0 ? ` · ${t("load.maxError", { max: maxDeposit })}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  className="h-12 w-full rounded-xl"
                  disabled={
                    checkoutMutation.isPending ||
                    accountPending ||
                    walletFrozen ||
                    !depositsEnabled
                  }
                  onClick={() => {
                    if (paybridgeDeposit && !checkoutNeedsRetry && !checkoutPaid) {
                      setPaymentSheetOpen(true);
                      return;
                    }
                    checkoutMutation.mutate();
                  }}
                >
                  {checkoutMutation.isPending
                    ? t("load.checkoutRedirecting")
                    : t("load.checkoutPay")}
                </Button>
                <ul className="space-y-1.5 text-[13px] text-muted-foreground">
                  <li>1. {t("load.checkoutStep1")}</li>
                  <li>2. {t("load.checkoutStep2")}</li>
                  <li>3. {t("load.checkoutStep3")}</li>
                  <li>4. {t("load.checkoutStep4")}</li>
                  <li>5. {t("load.checkoutStep5")}</li>
                </ul>
              </section>
            ) : (
              <>
            <DepositAccountsPanel
              bankDetails={
                payingDealer
                  ? (activeDest?.bank_details ?? null)
                  : (activeDest?.bank_details ?? settingsQuery.data?.bank_details ?? null)
              }
              loading={destQuery.isLoading || settingsQuery.isLoading}
              qrOptions={
                payingDealer
                  ? []
                  : [
                      {
                        id: "bank" as const,
                        url: activeDest?.qr_code_url ?? settingsQuery.data?.qr_code_url ?? "",
                        label: t("load.qrBank"),
                        alt: t("load.qrBankAlt"),
                      },
                      {
                        id: "khalti" as const,
                        url:
                          activeDest?.khalti_qr_code_url ??
                          settingsQuery.data?.khalti_qr_code_url ??
                          "",
                        label: t("load.qrKhalti"),
                        alt: t("load.qrKhaltiAlt"),
                      },
                      {
                        id: "esewa" as const,
                        url:
                          activeDest?.esewa_qr_code_url ??
                          settingsQuery.data?.esewa_qr_code_url ??
                          "",
                        label: t("load.qrEsewa"),
                        alt: t("load.qrEsewaAlt"),
                      },
                    ]
              }
              instructions={
                payingDealer
                  ? dealerHasAccounts
                    ? t("load.dealerInstructions", {
                        dealer:
                          destQuery.data?.dealer_name || destQuery.data?.dealer_phone || "",
                      })
                    : t("load.dealerNotConfigured")
                  : instructions
              }
              title={
                payingDealer
                  ? t("load.dealerAccount")
                  : canChooseDealer
                    ? t("load.superAdminAccount")
                    : t("load.depositAccount")
              }
            />

            <section className="inset-group min-w-0 max-w-full p-4">
              <h2 className="mb-3 text-[15px] font-semibold">{t("load.submitTitle")}</h2>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="transaction_id">{t("load.transactionId")}</Label>
                  <Input
                    id="transaction_id"
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    className="h-11 rounded-xl"
                    placeholder={t("load.transactionIdPlaceholder")}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">{t("load.depositedAmount")}</Label>
                  <Input
                    id="amount"
                    inputMode="decimal"
                    placeholder={t("common.amountPlaceholder")}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="tabular h-12 rounded-xl text-[22px] font-semibold"
                    required
                  />
                  <p className="text-[12px] text-muted-foreground">
                    {t("common.minMax", { min: minDeposit, max: maxDeposit })}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="deposit_date">{t("load.depositDate")}</Label>
                  <Input
                    id="deposit_date"
                    type="date"
                    value={depositDate}
                    onChange={(e) => setDepositDate(e.target.value)}
                    className="h-11 rounded-xl"
                    placeholder={t("load.depositDate")}
                    title={t("load.depositDate")}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label id="payment_method_label">{t("load.paymentMethod")}</Label>
                  <div
                    role="radiogroup"
                    aria-labelledby="payment_method_label"
                    className="grid grid-cols-3 gap-2"
                  >
                    {DEPOSIT_PAYMENT_METHODS.map((method) => {
                      const selected = paymentMethod === method;
                      return (
                        <button
                          key={method}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            setPaymentMethod(method);
                            if (method !== "bank") setBankName("");
                          }}
                          className={cn(
                            "h-11 rounded-xl border text-[13px] font-medium transition-colors",
                            selected
                              ? "border-brand bg-brand/10 text-brand-dark"
                              : "border-border bg-surface text-muted-foreground hover:border-brand/30",
                          )}
                        >
                          {paymentMethodLabel(method, t)}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {payingDealer ? t("load.paymentMethodHintDealer") : t("load.paymentMethodHint")}
                  </p>
                  {paymentMethod === "bank" ? (
                    <div className="space-y-1.5 pt-1">
                      <Label htmlFor="bank_name">{t("load.userBankOptional")}</Label>
                      <Input
                        id="bank_name"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        className="h-11 rounded-xl"
                        placeholder={t("load.userBankPlaceholder")}
                        autoComplete="off"
                      />
                    </div>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="note">{t("load.remarksOptional")}</Label>
                  <Textarea
                    id="note"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="rounded-xl"
                    placeholder={t("load.remarksPlaceholder")}
                  />
                </div>
                {requireScreenshot ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="proof">{t("load.screenshot")}</Label>
                    <label
                      htmlFor="proof"
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-separator px-4 py-4 text-[15px] text-muted-foreground"
                    >
                      <Upload className="size-5" />
                      {file?.name ?? t("load.uploadScreenshot")}
                    </label>
                    <input
                      id="proof"
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      required={requireScreenshot}
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="proof">
                      {t("load.screenshot")} {t("load.screenshotOptional")}
                    </Label>
                    <label
                      htmlFor="proof"
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-separator px-4 py-4 text-[15px] text-muted-foreground"
                    >
                      <Upload className="size-5" />
                      {file?.name ?? t("load.uploadScreenshot")}
                    </label>
                    <input
                      id="proof"
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={createMutation.isPending || !dealerHasAccounts}
                  className="h-12 w-full rounded-xl text-[17px]"
                >
                  {createMutation.isPending ? t("common.submitting") : t("load.submit")}
                </Button>
              </form>
            </section>
              </>
            )}
          </>
        ) : null}

        <section className="min-w-0 max-w-full lg:col-span-2">
          {lastReceiptId ? (
            <div className="mb-3">
              <TransactionResultBanner
                tone={
                  depositItems.find(
                    (x) => activityIdForKind("deposit", x.id) === lastReceiptId,
                  )?.status === "rejected"
                    ? "danger"
                    : depositItems.find(
                          (x) => activityIdForKind("deposit", x.id) === lastReceiptId,
                        )?.status === "pending"
                      ? "warning"
                      : "success"
                }
                title={t("load.submitted")}
                body={t("history.downloadStatement")}
                receiptLabel={t("history.downloadPdf")}
                onDownloadReceipt={() => void downloadReceipt(lastReceiptId)}
                downloading={receiptDownloading}
              />
            </div>
          ) : null}
          <h2 className="mb-2 px-1 text-[17px] font-semibold">{t("load.myDeposits")}</h2>
          {depositsQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !depositItems.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("load.empty")}
            </div>
          ) : (
            <ul className="inset-group min-w-0 divide-y divide-border overflow-hidden">
              {depositItems.map((d) => (
                <li key={d.id} className="min-w-0 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        {formatNPR(d.amount)}{" "}
                        <span className="text-[13px] font-normal text-muted-foreground">
                          · #{d.id}
                        </span>
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {d.provider === "paybridgenp"
                          ? t("load.checkoutProvider")
                          : d.provider === "himalpay_checkout"
                            ? t("load.checkoutProviderHimal")
                            : d.transaction_id
                              ? `${t("common.txnId")}: ${d.transaction_id}`
                              : t("common.noNote")}
                        {d.purchase_order_identifier
                          ? ` · ${d.purchase_order_identifier}`
                          : d.deposit_date
                            ? ` · ${formatDate(d.deposit_date)}`
                            : ""}
                        {" · "}
                        {formatDateTime(d.created_at)}
                      </p>
                      {(d.status === "rejected" || d.status === "failed") &&
                      (d.rejection_reason || d.failure_reason) ? (
                        <p className="mt-0.5 break-words text-[13px] text-destructive">
                          {t("common.reason", {
                            reason: d.rejection_reason || d.failure_reason || "",
                          })}
                        </p>
                      ) : null}
                    </div>
                    <StatusChip status={d.status} className="shrink-0" />
                  </div>
                  {(d.status === "approved" || d.status === "rejected") && (
                    <div className="mt-1 flex justify-end">
                      <ReceiptDownloadLink
                        label={t("list.downloadReceipt")}
                        downloading={receiptDownloading}
                        onClick={() =>
                          void downloadReceipt(activityIdForKind("deposit", d.id))
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
      <Sheet
        open={paymentSheetOpen}
        onOpenChange={(open) => {
          setPaymentSheetOpen(open);
          if (!open && checkoutPaid) {
            setPaybridgeDeposit(null);
          }
        }}
      >
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto overscroll-y-contain rounded-t-2xl px-4 pb-[max(2rem,calc(1rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] pt-5"
        >
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>{t("load.checkoutTitle")}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t("load.checkoutAmountToPay")}</span>
              <span className="tabular font-semibold">
                {checkoutAmountValue ? formatNPR(checkoutAmountValue) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{t("common.status")}</span>
              {liveCheckout?.status ? (
                <StatusChip status={liveCheckout.status} />
              ) : (
                <span className="text-sm text-muted-foreground">{t("load.checkoutPending")}</span>
              )}
            </div>
            {paybridgeDeposit?.orderId ? (
              <p className="break-all text-[13px] text-muted-foreground">
                {t("load.checkoutOrder")}: {paybridgeDeposit.orderId}
              </p>
            ) : null}

            {showInAppQr ? (
              <div className="space-y-3 rounded-2xl border border-border/70 bg-surface p-4">
                <div className="text-center">
                  <p className="text-[15px] font-semibold">{t("load.checkoutQrTitle")}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {t("load.checkoutQrScan")}
                  </p>
                </div>
                <div className="mx-auto flex size-[240px] items-center justify-center rounded-xl bg-white p-3 shadow-sm">
                  <img
                    src={paybridgeDeposit!.qrImage}
                    alt={t("load.checkoutQrAlt")}
                    className="size-full object-contain"
                  />
                </div>
                <div className="flex flex-col items-center gap-1 text-center text-[13px]">
                  <p className="inline-flex items-center gap-2 font-medium">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        paybridgeDeposit?.qrScanned ? "bg-success" : "bg-amber-400",
                      )}
                    />
                    {paybridgeDeposit?.qrScanned
                      ? t("load.checkoutQrScanned")
                      : t("load.checkoutQrWaiting")}
                  </p>
                  <p className="text-muted-foreground">{t("load.checkoutQrHelp")}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full rounded-xl"
                  disabled={refreshQrMutation.isPending}
                  onClick={() => {
                    if (paybridgeDeposit?.depositId) {
                      refreshQrMutation.mutate(paybridgeDeposit.depositId);
                    }
                  }}
                >
                  <RefreshCw
                    className={cn(
                      "mr-2 size-4",
                      refreshQrMutation.isPending && "animate-spin",
                    )}
                  />
                  {refreshQrMutation.isPending
                    ? t("load.checkoutQrRefreshing")
                    : t("load.checkoutQrRefresh")}
                </Button>
              </div>
            ) : null}

            {showHostedFallback ? (
              <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4 text-center">
                <p className="text-[15px] font-semibold">{t("load.checkoutTitle")}</p>
                <p className="text-[13px] text-muted-foreground">
                  {t("load.checkoutHostedNoEmbed")}
                </p>
              </div>
            ) : null}

            {checkoutWaiting && !showInAppQr ? (
              <p className="text-center text-[13px] text-muted-foreground">
                {t("load.checkoutPending")}
              </p>
            ) : null}
            {checkoutPaid ? (
              <p className="text-center text-[13px] font-medium text-success">
                {t("load.checkoutSuccess")}
              </p>
            ) : null}
            {checkoutNeedsRetry ? (
              <p className="text-center text-[13px] text-destructive">
                {liveCheckout?.failure_reason || t("load.checkoutNotPaid")}
              </p>
            ) : null}
            <p className="text-[12px] text-muted-foreground">{t("load.checkoutVerifyNote")}</p>
            <div className="flex flex-col gap-2">
              {showHostedFallback ? (
                <Button
                  type="button"
                  className="h-11 w-full rounded-xl"
                  onClick={() => {
                    const url = paybridgeDeposit?.paymentUrl || "";
                    if (!url) return;
                    // Never navigate the Flutter WebView to PayBridge (X-Frame /
                    // cleartext / connection errors). Always open externally.
                    if (!openExternalUrl(url) && !isMySewaNativeApp()) {
                      window.open(url, "_blank", "noopener,noreferrer");
                    }
                  }}
                >
                  {t("load.checkoutOpenPay")}
                </Button>
              ) : null}
              {!checkoutPaid ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full rounded-xl"
                  disabled={checkoutStatusQuery.isFetching}
                  onClick={() => void checkoutStatusQuery.refetch()}
                >
                  {checkoutStatusQuery.isFetching
                    ? t("load.checkoutVerifying")
                    : t("load.checkoutCheckStatus")}
                </Button>
              ) : null}
              {checkoutNeedsRetry ? (
                <Button
                  type="button"
                  className="h-11 w-full rounded-xl"
                  disabled={checkoutMutation.isPending}
                  onClick={() => {
                    setPaybridgeDeposit(null);
                    checkoutMutation.mutate();
                  }}
                >
                  {t("load.checkoutPay")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full rounded-xl"
                onClick={() => setPaymentSheetOpen(false)}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto overscroll-y-contain rounded-t-2xl px-4 pb-[max(2rem,calc(1rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] pt-5"
        >
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>{t("load.searchTitle")}</SheetTitle>
          </SheetHeader>
          <ListPageToolbar
            stats={depositStats}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={async () => {
              setExporting(true);
              try {
                await downloadCsvExport("/api/deposit/list/", debounced, "deposits.csv");
              } finally {
                setExporting(false);
              }
            }}
            exporting={exporting}
            searchPlaceholder={t("load.searchPlaceholder")}
            exportLabel={t("list.exportCsv")}
            statsLabels={{
              total: t("list.statsTotal"),
              success: t("list.statsSuccess"),
              pending: t("list.statsPending"),
              failed: t("list.statsFailed"),
            }}
            statusOptions={[...DEPOSIT_STATUS_OPTIONS]}
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
    </UserShell>
  );
}
