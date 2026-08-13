import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { BankCombobox } from "@/components/BankCombobox";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toastApiError, toastApiMessage } from "@/lib/api-errors";
import { apiClient, ApiError } from "@/lib/api";
import { mergeBankLists } from "@/lib/nepali-banks";
import type { BankOption, BankTransferTransaction } from "@/lib/types";
import { formatNPR, formatDateTime, sortByLatestFirst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { isAccountPending, canFundTransfer } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { TransactionPinDialog } from "@/components/TransactionPinDialog";
import { useI18n } from "@/lib/i18n";
import { ListPageToolbar, ReceiptDownloadLink, TransactionResultBanner } from "@/components/list/ListPageToolbar";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { activityIdForKind, useReceiptDownload } from "@/lib/receipt-download";
import { useSiteBranding } from "@/hooks/use-site-branding";

function displayTransferTotal(item: BankTransferTransaction) {
  const total = Number(item.total_debited);
  if (Number.isFinite(total) && total > 0) return formatNPR(item.total_debited);
  const combined = Number(item.amount) + Number(item.charge || 0);
  return formatNPR(Number.isFinite(combined) ? combined : item.amount);
}

export const Route = createFileRoute("/app/transfer")({
  head: () => ({
    meta: [
      { title: "Fund Transfer — Send Money in Nepal | MySewa" },
      {
        name: "description",
        content:
          "Send money from your MySewa business wallet to any Nepali bank account or mobile number: verify, review charges and confirm.",
      },
      { property: "og:title", content: "Fund Transfer — MySewa" },
      {
        property: "og:description",
        content: "Bank account or phone number transfers from your MySewa business wallet.",
      },
    ],
  }),
  component: Transfer,
});

type TransferMethod = "bank" | "phone";

type VerifiedDestination = {
  bank_code: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  is_mobile: boolean;
};

function Transfer() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { t, locale } = useI18n();
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
  const [method, setMethod] = useState<TransferMethod>("bank");
  const [bank, setBank] = useState("");
  const [accNo, setAccNo] = useState("");
  const [accName, setAccName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState(() => t("transfer.defaultRemarks"));
  const [verified, setVerified] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<"idle" | "verified" | "unverified">(
    "idle",
  );
  const [verifiedDetails, setVerifiedDetails] = useState<VerifiedDestination | null>(null);
  const [charge, setCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");
  const [verifying, setVerifying] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });
  const transfersEnabled =
    settingsQuery.data?.config?.payment?.transfers_enabled !== false &&
    !accountPending &&
    canFundTransfer(user);
  const depositsEnabled =
    settingsQuery.data?.config?.payment?.deposits_enabled !== false && !accountPending;
  const minTransfer = settingsQuery.data?.config?.transactions?.min_transfer ?? 10;
  const maxTransfer = settingsQuery.data?.config?.transactions?.max_transfer ?? 100000;
  const dailyLimit = settingsQuery.data?.config?.transactions?.daily_transfer_limit ?? 200000;
  const chargeEnabled =
    settingsQuery.data?.config?.transactions?.transfer_charge_enabled !== false;
  const cashbackEnabled =
    settingsQuery.data?.config?.transactions?.cashback_enabled !== false;

  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const banksQuery = useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const res = await apiClient.listBanks();
      return (res.banks || res.data?.banks || []) as BankOption[];
    },
    enabled: transfersEnabled,
    retry: 1,
  });

  useEffect(() => {
    if (!banksQuery.isError) return;
    toastApiError(banksQuery.error, {
      title: t("transfer.banksFailed"),
      fallback: t("transfer.banksFailedFallback"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banksQuery.isError, banksQuery.error]);

  const historyQuery = useQuery({
    queryKey: ["transfers", debounced],
    queryFn: () => apiClient.transferHistory(debounced),
    refetchInterval: LIVE_REFETCH_MS,
  });
  const transferItems = useMemo(
    () => sortByLatestFirst(historyQuery.data?.items ?? []),
    [historyQuery.data?.items],
  );
  const transferStats = historyQuery.data?.stats;

  // Auto-poll HimalPay status for pending transfers (wallet-service-reseller-status)
  useEffect(() => {
    const pending = transferItems.filter((item) => item.status === "pending");
    if (!pending.length) return;

    let cancelled = false;
    const poll = async () => {
      let changed = false;
      for (const item of pending.slice(0, 5)) {
        try {
          const res = await apiClient.transferStatus(item.merchant_txn_id);
          const next = res.local_transfer?.status;
          if (next && next !== "pending" && next !== item.status) {
            changed = true;
            if (next === "success") {
              toast.success(t("transfer.statusSuccess"));
              setLastReceiptId(activityIdForKind("transfer", item.id));
            } else if (next === "failed") {
              if (res.message) {
                toastApiMessage(res.message, {
                  title: t("transfer.statusFailed"),
                  fallback: t("transfer.statusFailed"),
                });
              } else {
                toast.error(t("transfer.statusFailed"));
              }
            }
          }
        } catch {
          // ignore transient status errors while polling
        }
        if (cancelled) return;
      }
      if (changed && !cancelled) {
        queryClient.invalidateQueries({ queryKey: ["transfers"] });
        queryClient.invalidateQueries({ queryKey: ["wallet"] });
      }
    };

    const timer = setInterval(poll, Math.max(LIVE_REFETCH_MS, 8000));
    void poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [transferItems, queryClient, t]);

  const banks = useMemo(
    () => mergeBankLists(banksQuery.data ?? []),
    [banksQuery.data],
  );
  const amt = Number(amount) || 0;
  const walletBalance = Number(walletQuery.data?.balance ?? 0);
  const totalDue = Number(totalDebited) || amt;
  const insufficient =
    amt >= minTransfer && totalDue > 0 && walletBalance < totalDue;
  const isMobile = method === "phone";
  const destinationNumber = isMobile ? phone.trim() : accNo.trim();

  useEffect(() => {
    if (!banks.length || !bank) return;
    if (banks.some((b) => b.bank_code === bank)) return;
    // Remap stale short codes (e.g. CTZN → CTZNNPKA) when provider list loads
    const remapped = banks.find((b) => b.bank_code.startsWith(bank));
    setBank(remapped?.bank_code ?? "");
  }, [banks, bank]);

  useEffect(() => {
    setVerified(false);
    setVerifyStatus("idle");
    setVerifiedDetails(null);
    setAmount("");
    setCharge("0.00");
    setCashback("0.00");
    setTotalDebited("0.00");
    if (method === "phone") setAccName("");
  }, [method]);

  function resetVerification() {
    setVerified(false);
    setVerifyStatus("idle");
    setVerifiedDetails(null);
    setAmount("");
    setCharge("0.00");
    setCashback("0.00");
    setTotalDebited("0.00");
  }

  useEffect(() => {
    setRemarks((prev) =>
      prev === "Fund Transfer" || prev === "फन्ड ट्रान्सफर" ? t("transfer.defaultRemarks") : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    if (!transfersEnabled || !verified || amt < minTransfer) {
      setCharge("0.00");
      setCashback("0.00");
      setTotalDebited("0.00");
      return;
    }
    const timer = setTimeout(() => {
      apiClient
        .calculateTransfer(amt)
        .then((res) => {
          setCharge(String(res.data.charge));
          setCashback(String(res.data.cashback));
          setTotalDebited(String(res.data.total_debited));
        })
        .catch((err) => {
          setCharge("0.00");
          setCashback("0.00");
          setTotalDebited(amt.toFixed(2));
          if (err instanceof ApiError) {
            const msg = err.message.toLowerCase();
            if (msg.includes("ip not") || msg.includes("allowlist") || err.status === 403) {
              toastApiError(err, {
                title: t("transfer.providerError"),
                fallback: t("transfer.providerError"),
              });
            }
          }
        });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amt, transfersEnabled, minTransfer, verified]);

  const selectedBank = banks.find((b) => b.bank_code === bank);

  const refreshStatus = async (item: BankTransferTransaction) => {
    setRefreshingId(item.id);
    try {
      const res = await apiClient.transferStatus(item.merchant_txn_id);
      const local = res.local_transfer;
      if (local?.status === "success" || res.status === "success") {
        toast.success(t("transfer.statusSuccess"));
        setLastReceiptId(activityIdForKind("transfer", item.id));
      } else if (local?.status === "failed" || res.status === "failed") {
        if (res.message) {
          toastApiMessage(res.message, {
            title: t("transfer.statusFailed"),
            fallback: t("transfer.statusFailed"),
          });
        } else {
          toast.error(t("transfer.statusFailed"));
        }
      } else {
        toast.message(t("transfer.statusPending"));
      }
      queryClient.invalidateQueries({ queryKey: ["transfers"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    } catch (err) {
      toastApiError(err, {
        title: t("transfer.failed"),
        fallback: t("transfer.statusPending"),
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const submitMutation = useMutation({
    mutationFn: (transaction_pin: string) => {
      if (accountPending) throw new Error(t("account.pending"));
      if (!transfersEnabled) throw new Error(t("transfer.disabledError"));
      if (amt < minTransfer) throw new Error(t("transfer.minError", { min: minTransfer }));
      if (maxTransfer > 0 && amt > maxTransfer) {
        throw new Error(t("transfer.maxError", { max: maxTransfer }));
      }
      if (insufficient) {
        throw new Error(
          t("transfer.insufficient", {
            required: formatNPR(totalDue),
            available: formatNPR(walletBalance),
          }),
        );
      }
      // HimalPay flow via Django: banks → verify → charge → BANK_TRANSFER → status poll.
      // Do NOT reuse the verify merchant_txn_id for payment (must be unique).
      return apiClient.createTransfer({
        amount: Number(amt.toFixed(2)),
        destination_bank: bank,
        destination_bank_name: selectedBank?.bank_name || "",
        destination_acc_no: destinationNumber,
        destination_acc_name: accName,
        is_destination_mobile: isMobile,
        transaction_remarks: remarks || t("transfer.defaultRemarks"),
        transaction_pin,
      });
    },
    onSuccess: (res) => {
      setPinOpen(false);
      setPinError(null);
      const isPending = res.data.status === "pending";
      if (isPending) {
        toast.message(res.message || t("transfer.pendingTitle"), {
          description: res.pending_message || t("transfer.pendingBody"),
        });
      } else {
        toast.success(res.message || t("transfer.submitted"), {
          description: t("transfer.debited", {
            amount: formatNPR(res.data.total_debited || totalDebited),
          }),
        });
      }
      setAccNo("");
      setPhone("");
      setAccName("");
      setAmount("");
      setVerified(false);
      setVerifyStatus("idle");
      setVerifiedDetails(null);
      queryClient.invalidateQueries({ queryKey: ["transfers"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
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
            title: t("transfer.failed"),
            fallback: t("transfer.insufficient", {
              required: formatNPR(String(body["required"] ?? totalDue)),
              available: formatNPR(String(body["available"] ?? walletBalance)),
            }),
          });
          return;
        }
      }
      setPinOpen(false);
      toastApiError(err, { title: t("transfer.failed"), fallback: t("transfer.failed") });
    },
  });

  async function verifyDestination() {
    if (accountPending) {
      toast.error(t("account.pending"));
      return;
    }
    if (!bank) {
      toast.error(
        isMobile ? t("transfer.enterBankAndPhone") : t("transfer.enterBankAndName"),
      );
      return;
    }
    if (isMobile) {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10) {
        toast.error(t("transfer.invalidNepaliMobile"));
        return;
      }
    } else {
      if (!accName.trim()) {
        toast.error(t("transfer.enterBankAndName"));
        return;
      }
      if (accNo.trim().length < 5) {
        toast.error(t("transfer.enterValidAccount"));
        return;
      }
    }
    setVerifying(true);
    try {
      const res = await apiClient.verifyBank({
        bank_code: bank,
        bank_name: selectedBank?.bank_name || "",
        // Phone transfers: name is not required — provider returns the registered holder.
        ...(isMobile ? {} : { account_name: accName.trim() }),
        account_number: destinationNumber,
        is_mobile: isMobile,
      });
      if (!res.data?.verified) {
        setVerified(false);
        setVerifyStatus("unverified");
        setVerifiedDetails(null);
        toast.error(t("transfer.dontMatch"));
        return;
      }
      const originalName = (res.data.account_name || "").trim();
      if (!originalName) {
        setVerified(false);
        setVerifyStatus("unverified");
        setVerifiedDetails(null);
        toast.error(t("transfer.dontMatch"));
        return;
      }
      const confirmedBankCode = res.data.bank_code || bank;
      const confirmedNumber = (res.data.account_number || destinationNumber).trim();
      if (res.data.bank_code && res.data.bank_code !== bank) {
        setBank(res.data.bank_code);
      }
      setAccName(originalName);
      setVerifiedDetails({
        bank_code: confirmedBankCode,
        bank_name:
          res.data.bank_name ||
          banks.find((b) => b.bank_code === confirmedBankCode)?.bank_name ||
          selectedBank?.bank_name ||
          confirmedBankCode,
        account_name: originalName,
        account_number: confirmedNumber,
        is_mobile: isMobile,
      });
      setVerified(true);
      setVerifyStatus("verified");
      toast.success(
        isMobile
          ? t("transfer.verifiedPhone", { name: originalName })
          : res.message || t("transfer.accountVerified"),
      );
    } catch (err) {
      setVerified(false);
      setVerifyStatus("unverified");
      setVerifiedDetails(null);
      const body =
        err instanceof ApiError && err.body && typeof err.body === "object"
          ? (err.body as Record<string, unknown>)
          : null;
      const errorCode = body?.error_code;
      const serviceBlocked =
        errorCode === 7000 ||
        errorCode === "7000" ||
        String(body?.error_type || "")
          .toLowerCase()
          .includes("walletservicenotallowed");
      const mismatch =
        !serviceBlocked &&
        err instanceof ApiError &&
        (body?.mismatch === true ||
          err.message === "Don't Match" ||
          err.message === "Account details do not match." ||
          err.message.toLowerCase().includes("don't match") ||
          err.message.toLowerCase().includes("do not match"));
      toastApiError(err, {
        title: mismatch
          ? t("transfer.dontMatch")
          : serviceBlocked
            ? t("transfer.verifyUnavailable")
            : t("transfer.verifyFailed"),
        fallback: mismatch
          ? t("transfer.dontMatch")
          : serviceBlocked
            ? t("transfer.verifyUnavailable")
            : t("transfer.verifyFailed"),
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <UserShell
      title={t("transfer.title")}
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
          aria-label={t("transfer.searchTitle")}
        >
          <Search className="size-4" />
        </Button>
      }
    >
      <div className="grid min-w-0 max-w-full gap-5 overflow-x-clip lg:grid-cols-2">
        {accountPending ? (
          <div className="lg:col-span-2">
            <AccountPendingBanner />
          </div>
        ) : null}
        {!transfersEnabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4 lg:col-span-2">
            <p className="text-[15px] font-medium text-destructive">{t("transfer.disabledTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("transfer.disabledBody")}</p>
          </section>
        ) : null}
        <section className="inset-group min-w-0 p-4">
          <div className="mb-4 flex min-w-0 items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5">
            <div>
              <p className="text-[12px] text-muted-foreground">
                {t("transfer.availableBalance")}
              </p>
              <p className="tabular text-[17px] font-semibold">
                {walletQuery.isLoading ? "…" : formatNPR(walletBalance)}
              </p>
            </div>
            {insufficient && depositsEnabled ? (
              <Link
                to="/app/load"
                className="text-[13px] font-medium text-brand underline-offset-2 hover:underline"
              >
                {t("topup.loadWallet")}
              </Link>
            ) : null}
          </div>

          <Tabs
            value={method}
            onValueChange={(v) => setMethod(v as TransferMethod)}
            className="mb-4"
          >
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl">
              <TabsTrigger value="bank" className="rounded-lg" disabled={!transfersEnabled}>
                {t("transfer.tabBank")}
              </TabsTrigger>
              <TabsTrigger value="phone" className="rounded-lg" disabled={!transfersEnabled}>
                {t("transfer.tabPhone")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!verified) {
                toast.error(t("transfer.verifyFirst"));
                return;
              }
              setPinError(null);
              setPinOpen(true);
            }}
          >
            <div className="space-y-1.5">
              <Label>{t("transfer.destBank")}</Label>
              <BankCombobox
                banks={banks}
                value={bank}
                loading={banksQuery.isLoading}
                disabled={!transfersEnabled}
                placeholder={t("transfer.selectBank")}
                onChange={(v) => {
                  setBank(v);
                  resetVerification();
                }}
              />
            </div>

            {!isMobile ? (
              <div className="space-y-1.5">
                <Label htmlFor="accName">{t("transfer.accHolder")}</Label>
                <Input
                  id="accName"
                  value={accName}
                  onChange={(e) => {
                    setAccName(e.target.value);
                    resetVerification();
                  }}
                  placeholder={t("transfer.accHolderPlaceholder")}
                  className="h-12 rounded-xl"
                  required
                  disabled={!transfersEnabled || !bank}
                />
              </div>
            ) : null}

            {isMobile ? (
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("transfer.destPhone")}</Label>
                <div className="flex min-w-0 gap-2">
                  <Input
                    id="phone"
                    inputMode="tel"
                    placeholder={t("transfer.phonePlaceholder")}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      resetVerification();
                      setAccName("");
                    }}
                    className="h-12 min-w-0 flex-1 rounded-xl"
                    required
                    disabled={!transfersEnabled || !bank}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12 shrink-0 rounded-xl"
                    disabled={
                      verifying ||
                      !transfersEnabled ||
                      !bank ||
                      phone.replace(/\D/g, "").length < 10
                    }
                    onClick={verifyDestination}
                  >
                    {verifying ? "…" : t("transfer.verify")}
                  </Button>
                </div>
                <p className="text-[12px] text-muted-foreground">{t("transfer.phoneHelp")}</p>
                {verifiedDetails ? null : (
                  <VerifyStatusMessage
                    status={verifyStatus}
                    verifiedLabel={
                      accName
                        ? t("transfer.verifiedPhone", { name: accName })
                        : t("transfer.statusVerified")
                    }
                    unverifiedLabel={t("transfer.dontMatch")}
                    unverifiedStatusLabel={t("transfer.statusUnverified")}
                  />
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="acc">{t("transfer.destAccount")}</Label>
                <div className="flex min-w-0 gap-2">
                  <Input
                    id="acc"
                    value={accNo}
                    onChange={(e) => {
                      setAccNo(e.target.value);
                      resetVerification();
                    }}
                    placeholder={t("transfer.accountPlaceholder")}
                    className="h-12 min-w-0 flex-1 rounded-xl"
                    required
                    disabled={!transfersEnabled || !bank}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12 shrink-0 rounded-xl"
                    disabled={
                      verifying ||
                      !transfersEnabled ||
                      !bank ||
                      !accName.trim() ||
                      !accNo.trim()
                    }
                    onClick={verifyDestination}
                  >
                    {verifying ? "…" : t("transfer.verify")}
                  </Button>
                </div>
                {verifiedDetails ? null : (
                  <VerifyStatusMessage
                    status={verifyStatus}
                    verifiedLabel={
                      accName
                        ? t("transfer.verifiedAccount", { name: accName })
                        : t("transfer.statusVerified")
                    }
                    unverifiedLabel={t("transfer.dontMatch")}
                    unverifiedStatusLabel={t("transfer.statusUnverified")}
                  />
                )}
              </div>
            )}

            {verified && verifiedDetails ? (
              <div className="rounded-xl border border-success/25 bg-success/5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-success">
                      {t("transfer.verifiedPreviewTitle")}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {t("transfer.verifiedPreviewHint")}
                    </p>
                  </div>
                  <span className="rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-success">
                    {t("transfer.statusVerified")}
                  </span>
                </div>
                <dl className="mt-3 space-y-1.5 text-[14px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t("transfer.destBank")}</dt>
                    <dd className="max-w-[60%] truncate text-right font-medium">
                      {verifiedDetails.bank_name}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t("transfer.accHolder")}</dt>
                    <dd className="max-w-[60%] truncate text-right font-medium">
                      {verifiedDetails.account_name}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {verifiedDetails.is_mobile
                        ? t("transfer.destPhone")
                        : t("transfer.destAccount")}
                    </dt>
                    <dd className="tabular max-w-[60%] truncate text-right font-medium">
                      {verifiedDetails.account_number}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="tamount">{t("common.amountNpr")}</Label>
              <Input
                id="tamount"
                inputMode="decimal"
                placeholder={t("common.amountPlaceholder")}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular h-12 rounded-xl text-[22px] font-semibold"
                required
                disabled={!transfersEnabled || !verified}
              />
              <p className="text-[12px] text-muted-foreground">
                {verified
                  ? t("common.minMaxDaily", {
                      min: minTransfer,
                      max: maxTransfer,
                      daily: dailyLimit,
                    })
                  : t("transfer.unlockAmountHint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="remarks">{t("transfer.remarks")}</Label>
              <Input
                id="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="h-12 rounded-xl"
                disabled={!transfersEnabled || !verified}
              />
            </div>

            <div className="rounded-xl bg-muted p-3 text-[14px]">
              <Row label={t("common.amount")} value={formatNPR(amt)} />
              {chargeEnabled ? <Row label={t("common.charge")} value={formatNPR(charge)} /> : null}
              {cashbackEnabled ? (
                <Row label={t("common.cashback")} value={`− ${formatNPR(cashback)}`} />
              ) : null}
              <div className="mt-2 border-t border-separator pt-2">
                <Row label={t("common.totalDebited")} value={formatNPR(totalDebited)} strong />
              </div>
              {insufficient ? (
                <p className="mt-2 text-[12px] font-medium text-destructive" role="alert">
                  {t("transfer.insufficient", {
                    required: formatNPR(totalDue),
                    available: formatNPR(walletBalance),
                  })}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              disabled={
                submitMutation.isPending ||
                !transfersEnabled ||
                insufficient ||
                !verified ||
                amt < minTransfer
              }
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {submitMutation.isPending ? t("common.processing") : t("transfer.confirm")}
            </Button>
          </form>
        </section>

        <section className="min-w-0">
          {lastReceiptId ? (
            <div className="mb-3">
              <TransactionResultBanner
                tone={
                  transferItems.find(
                    (x) => activityIdForKind("transfer", x.id) === lastReceiptId,
                  )?.status === "failed"
                    ? "danger"
                    : transferItems.find(
                          (x) => activityIdForKind("transfer", x.id) === lastReceiptId,
                        )?.status === "pending"
                      ? "warning"
                      : "success"
                }
                title={t("transfer.submitted")}
                body={t("history.downloadStatement")}
                receiptLabel={t("history.downloadPdf")}
                onDownloadReceipt={() => void downloadReceipt(lastReceiptId)}
                downloading={receiptDownloading}
              />
            </div>
          ) : null}
          <div className="mb-2 mt-1 flex items-center justify-between gap-2 px-1">
            <h2 className="text-[17px] font-semibold">{t("transfer.recent")}</h2>
          </div>
          {(filters.q || filters.status !== "all" || filters.startDate || filters.endDate) ? (
            <div className="mb-3 rounded-xl border border-border/70 bg-background/95 p-2">
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium">
                  {t("list.statsTotal")}: {transferStats?.total ?? 0}
                </span>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium">
                  {t("list.statsSuccess")}: {transferStats?.success ?? 0}
                </span>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium">
                  {t("list.statsPending")}: {transferStats?.pending ?? 0}
                </span>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium">
                  {t("list.statsFailed")}: {transferStats?.failed ?? 0}
                </span>
              </div>
            </div>
          ) : null}
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !transferItems.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("transfer.empty")}
            </div>
          ) : (
            <ul className="inset-group min-w-0 divide-y divide-border overflow-hidden">
              {transferItems.map((b) => (
                <li key={b.id}>
                  <div className="flex items-stretch gap-1 px-2 py-1">
                    <Link
                      to="/app/history/$activityId"
                      params={{ activityId: activityIdForKind("transfer", b.id) }}
                      className="min-w-0 flex-1 rounded-lg px-2 py-2 transition-colors active:bg-muted/60"
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-medium">
                            {b.destination_acc_name || b.destination_acc_no}
                          </p>
                          <p className="truncate text-[13px] text-muted-foreground">
                            {b.is_destination_mobile
                              ? t("transfer.phonePrefix", { phone: b.destination_acc_no })
                              : `${b.destination_bank_name || b.destination_bank} · ${b.destination_acc_no}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="tabular text-[15px] font-semibold">
                            {displayTransferTotal(b)}
                          </p>
                          <StatusChip status={b.status} compact className="mt-1" />
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
                      </div>
                      <p className="mt-1 truncate text-[12px] text-muted-foreground">
                        {b.merchant_txn_id} · {formatDateTime(b.created_at)} ·{" "}
                        {b.status === "failed"
                          ? t("transfer.notDebited", { amount: formatNPR(b.total_debited) })
                          : b.status === "pending"
                            ? t("transfer.pendingDebit", { amount: formatNPR(b.total_debited) })
                            : t("transfer.debited", { amount: formatNPR(b.total_debited) })}
                      </p>
                    </Link>
                    <div className="flex shrink-0 flex-col items-end justify-center gap-1 self-center px-2">
                      {(b.status === "success" || b.status === "failed") && (
                        <ReceiptDownloadLink
                          label={t("list.downloadReceipt")}
                          downloading={receiptDownloading}
                          onClick={() =>
                            void downloadReceipt(activityIdForKind("transfer", b.id))
                          }
                        />
                      )}
                      {b.status === "pending" ? (
                        <button
                          type="button"
                          disabled={refreshingId === b.id}
                          onClick={() => void refreshStatus(b)}
                          className="text-[12px] font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          {refreshingId === b.id
                            ? t("common.processing")
                            : t("transfer.checkStatus")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto overscroll-y-contain rounded-t-2xl px-4 pb-[max(2rem,calc(1rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] pt-5">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>{t("transfer.searchTitle")}</SheetTitle>
          </SheetHeader>
          <ListPageToolbar
            stats={transferStats}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={async () => {
              setExporting(true);
              try {
                await downloadCsvExport("/api/bank-transfer/history/", debounced, "transfers.csv");
              } finally {
                setExporting(false);
              }
            }}
            exporting={exporting}
            searchPlaceholder={t("transfer.searchPlaceholder")}
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
        confirming={submitMutation.isPending}
        error={pinError}
        onConfirm={(pin) => {
          setPinError(null);
          submitMutation.mutate(pin);
        }}
      />
    </UserShell>
  );
}

function VerifyStatusMessage({
  status,
  verifiedLabel,
  unverifiedLabel,
  unverifiedStatusLabel,
}: {
  status: "idle" | "verified" | "unverified";
  verifiedLabel: string;
  unverifiedLabel: string;
  unverifiedStatusLabel: string;
}) {
  if (status === "idle") return null;
  if (status === "verified") {
    return <p className="text-[13px] font-medium text-success">{verifiedLabel}</p>;
  }
  return (
    <div className="space-y-0.5">
      <p className="text-[13px] font-medium text-destructive">{unverifiedLabel}</p>
      <p className="text-[12px] text-muted-foreground">{unverifiedStatusLabel}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular", strong ? "font-semibold" : "font-medium")}>{value}</span>
    </div>
  );
}
