import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, QrCode, Search } from "lucide-react";
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
import { parseBankQr, phonesMatch } from "@/lib/bank-qr";
import { mergeBankLists, matchBank, normalizeBankCode } from "@/lib/nepali-banks";
import type { BankOption, BankTransferTransaction } from "@/lib/types";
import { formatNPR, formatDateTime, sortByLatestFirst } from "@/lib/format";
import { userFacingChargeExtra } from "@/lib/user-charge";
import { UserChargePreview } from "@/components/UserChargePreview";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { liveQueryOptions, settingsQueryOptions } from "@/lib/refresh";
import { usePendingStatusPoll } from "@/hooks/use-pending-status-poll";
import { isAccountPending, canFundTransfer, canWalletAdjust, isWalletTxnLocked, walletTxnLockMessageKey } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { TransactionPinDialog } from "@/components/TransactionPinDialog";
import { useI18n } from "@/lib/i18n";
import { ListPageToolbar, ReceiptDownloadLink, TransactionResultBanner } from "@/components/list/ListPageToolbar";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { activityIdForKind, useReceiptDownload } from "@/lib/receipt-download";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { peekStashedQr, takeStashedQr } from "@/lib/scanned-qr";

function displayTransferTotal(item: BankTransferTransaction) {
  const total = Number(item.total_debited);
  if (Number.isFinite(total) && total > 0) return formatNPR(item.total_debited);
  const extra = userFacingChargeExtra({
    amount: item.amount,
    charge: item.charge,
    cashback: item.cashback,
    totalDebited: item.total_debited,
  });
  return formatNPR((Number(item.amount) || 0) + extra);
}

function previewCashback(payload?: { cashback?: string; cashback_credit?: string }) {
  const credit = Number(payload?.cashback_credit);
  if (Number.isFinite(credit) && credit > 0) return String(payload?.cashback_credit);
  return String(payload?.cashback ?? "0.00");
}

export const Route = createFileRoute("/app/transfer")({
  head: () => ({
    meta: [
      { title: "Fund Transfer — Send Money in Nepal | MySewa" },
      {
        name: "description",
        content:
          "Send money from your MySewa business wallet to any Nepali bank account or mobile number: scan a bank QR or enter details, verify, review charges and confirm.",
      },
      { property: "og:title", content: "Fund Transfer — MySewa" },
      {
        property: "og:description",
        content: "Bank account, phone number, or bank QR transfers from your MySewa business wallet.",
      },
    ],
  }),
  component: Transfer,
});

type TransferMethod = "bank" | "phone" | "wallet";

type VerifiedDestination = {
  bank_code: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  is_mobile: boolean;
};

type VerifyResult = "verified" | "failed" | "abort";

function Transfer() {
  const navigate = useNavigate();
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
  const skipMethodResetRef = useRef(false);
  const pendingQrAmountRef = useRef("");
  const appliedStashRef = useRef(false);
  const [walletPhone, setWalletPhone] = useState("");
  const [walletRecipient, setWalletRecipient] = useState<{
    phone: string;
    name: string;
    business_name?: string;
  } | null>(null);
  const [walletLooking, setWalletLooking] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
    ...settingsQueryOptions(),
  });
  const transfersEnabled =
    settingsQuery.data?.config?.payment?.transfers_enabled !== false &&
    !accountPending &&
    canFundTransfer(user);
  const walletTransfersEnabled = !accountPending && canWalletAdjust(user);
  const anyTransferEnabled = transfersEnabled || walletTransfersEnabled;
  const depositsEnabled =
    settingsQuery.data?.config?.payment?.deposits_enabled !== false && !accountPending;
  const minTransfer = settingsQuery.data?.config?.transactions?.min_transfer ?? 10;
  const maxTransfer = settingsQuery.data?.config?.transactions?.max_transfer ?? 100000;
  const dailyLimit = settingsQuery.data?.config?.transactions?.daily_transfer_limit ?? 200000;
  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    ...liveQueryOptions(),
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
    ...liveQueryOptions(),
  });
  const walletHistoryQuery = useQuery({
    queryKey: ["wallet-transfers", debounced],
    queryFn: () => apiClient.walletTransferHistory(debounced),
    ...liveQueryOptions(),
  });
  const transferItems = useMemo(
    () => sortByLatestFirst(historyQuery.data?.items ?? []),
    [historyQuery.data?.items],
  );
  const walletTransferItems = useMemo(
    () => sortByLatestFirst(walletHistoryQuery.data?.items ?? []),
    [walletHistoryQuery.data?.items],
  );
  const recentRows = useMemo(() => {
    const bank = transferItems.map((item) => ({
      kind: "bank" as const,
      at: item.created_at,
      id: `bt-${item.id}`,
      item,
    }));
    const wallet = walletTransferItems.map((item) => ({
      kind: "wallet" as const,
      at: item.created_at,
      id: `wt-${item.id}`,
      item,
    }));
    return [...bank, ...wallet].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
  }, [transferItems, walletTransferItems]);
  const transferStats = historyQuery.data?.stats;

  // Auto-poll HimalPay status for pending transfers (wallet-service-reseller-status)
  usePendingStatusPoll(
    transferItems,
    async (item) => {
      const res = await apiClient.transferStatus(item.merchant_txn_id);
      return { nextStatus: res.local_transfer?.status, message: res.message };
    },
    {
      invalidateKeys: [["transfers"], ["wallet"]],
      onSettled: (item, next, message) => {
        if (next === "success") {
          toast.success(t("transfer.statusSuccess"));
          setLastReceiptId(activityIdForKind("transfer", item.id));
        } else if (next === "failed") {
          if (message) {
            toastApiMessage(message, {
              title: t("transfer.statusFailed"),
              fallback: t("transfer.statusFailed"),
            });
          } else {
            toast.error(t("transfer.statusFailed"));
          }
        }
      },
    },
  );

  const banks = useMemo(
    () => mergeBankLists(banksQuery.data ?? []),
    [banksQuery.data],
  );
  const amt = Number(amount) || 0;
  const walletBalance = Number(walletQuery.data?.balance ?? 0);
  const walletLocked = isWalletTxnLocked(walletQuery.data, user);
  const walletLockMessage = t(walletTxnLockMessageKey(walletQuery.data, user));
  const totalDue = Number(totalDebited) || amt;
  const insufficient =
    method === "wallet"
      ? amt >= minTransfer && walletBalance < amt
      : amt >= minTransfer && totalDue > 0 && walletBalance < totalDue;
  const isMobile = method === "phone";
  const destinationNumber = isMobile ? phone.trim() : accNo.trim();

  function resolveBankCode(code: string, name = "") {
    const matched = matchBank(banks, code) || matchBank(banks, name);
    if (matched?.bank_code) return matched.bank_code;
    const normalized = normalizeBankCode(code);
    if (normalized && banks.some((b) => b.bank_code === normalized)) return normalized;
    const prefix = banks.find(
      (b) =>
        (normalized && b.bank_code.startsWith(normalized)) ||
        (normalized && normalized.startsWith(b.bank_code)),
    );
    return prefix?.bank_code || normalized || code.trim().toUpperCase();
  }

  useEffect(() => {
    if (!banks.length || !bank) return;
    if (banks.some((b) => b.bank_code === bank)) return;
    // Remap stale short codes (e.g. CTZN → CTZNNPKA) when provider list loads
    const remapped = banks.find((b) => b.bank_code.startsWith(bank));
    setBank(remapped?.bank_code ?? "");
  }, [banks, bank]);

  useEffect(() => {
    if (!transfersEnabled && walletTransfersEnabled && method !== "wallet") {
      setMethod("wallet");
    }
  }, [transfersEnabled, walletTransfersEnabled, method]);

  useEffect(() => {
    if (skipMethodResetRef.current) {
      skipMethodResetRef.current = false;
      return;
    }
    setVerifying(false);
    setVerified(false);
    setVerifyStatus("idle");
    setVerifiedDetails(null);
    setAmount("");
    setCharge("0.00");
    setCashback("0.00");
    setTotalDebited("0.00");
    if (method === "phone") setAccName("");
    if (method !== "wallet") {
      setWalletRecipient(null);
    }
  }, [method]);

  function resetVerification() {
    setVerifying(false);
    setVerified(false);
    setVerifyStatus("idle");
    setVerifiedDetails(null);
    setAmount("");
    setCharge("0.00");
    setCashback("0.00");
    setTotalDebited("0.00");
  }

  async function lookupWalletUser(phoneOverride?: string) {
    const source = phoneOverride ?? walletPhone;
    const raw = source.replace(/\D/g, "");
    if (raw.length < 10) {
      toast.error(t("transfer.invalidNepaliMobile"));
      return;
    }
    if (phoneOverride) setWalletPhone(phoneOverride);
    setWalletLooking(true);
    try {
      const res = await apiClient.lookupWalletTransfer({ phone: source.trim() });
      setWalletRecipient(res);
      toast.success(t("transfer.verifiedAs", { name: res.name || res.phone }));
    } catch (err) {
      setWalletRecipient(null);
      toastApiError(err, {
        title: t("transfer.walletNotFound"),
        fallback: t("transfer.walletNotFound"),
      });
    } finally {
      setWalletLooking(false);
    }
  }

  useEffect(() => {
    setRemarks((prev) =>
      prev === "Fund Transfer" || prev === "फन्ड ट्रान्सफर" ? t("transfer.defaultRemarks") : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    if (method === "wallet") {
      const next = Number(amount) || 0;
      if (next <= 0) {
        setCharge("0.00");
        setCashback("0.00");
        setTotalDebited("0.00");
        return;
      }
      const timer = setTimeout(() => {
        apiClient
          .calculateCharge("WALLET_TRANSFER", next)
          .then((res) => {
            setCharge(String(res.charge));
            setCashback(previewCashback(res));
            setTotalDebited(String(res.total_debited));
          })
          .catch(() => {
            setCharge("0.00");
            setCashback("0.00");
            setTotalDebited(next.toFixed(2));
          });
      }, 350);
      return () => clearTimeout(timer);
    }
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
          setCashback(previewCashback(res.data));
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
  }, [amt, amount, transfersEnabled, minTransfer, verified, method]);

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
      if (walletLocked) throw new Error(walletLockMessage);
      if (method === "wallet") {
        if (!walletTransfersEnabled) throw new Error(t("transfer.walletDisabledError"));
        if (!walletRecipient) throw new Error(t("transfer.walletFindFirst"));
        if (amt < minTransfer) throw new Error(t("transfer.minError", { min: minTransfer }));
        if (maxTransfer > 0 && amt > maxTransfer) {
          throw new Error(t("transfer.maxError", { max: maxTransfer }));
        }
        if (walletBalance < amt) {
          throw new Error(
            t("transfer.insufficient", {
              required: formatNPR(amt),
              available: formatNPR(walletBalance),
            }),
          );
        }
        return apiClient.createWalletTransfer({
          recipient_phone: walletRecipient.phone,
          amount: Number(amt.toFixed(2)),
          remarks: remarks || t("transfer.defaultRemarks"),
          transaction_pin,
        });
      }
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
      if (method === "wallet" && "direction" in res.data) {
        toast.success(res.message || t("transfer.walletSuccess"), {
          description: t("transfer.debited", {
            amount: formatNPR(res.data.amount),
          }),
        });
        setWalletPhone("");
        setWalletRecipient(null);
        setAmount("");
        setLastReceiptId(activityIdForKind("wallet_transfer", res.data.id));
        queryClient.invalidateQueries({ queryKey: ["transfers"] });
        queryClient.invalidateQueries({ queryKey: ["wallet-transfers"] });
        queryClient.invalidateQueries({ queryKey: ["wallet"] });
        return;
      }
      const bankRes = res as {
        message?: string;
        pending_message?: string;
        data: BankTransferTransaction;
      };
      const isPending = bankRes.data.status === "pending";
      if (isPending) {
        toast.message(bankRes.message || t("transfer.pendingTitle"), {
          description: bankRes.pending_message || t("transfer.pendingBody"),
        });
      } else {
        toast.success(bankRes.message || t("transfer.submitted"), {
          description: t("transfer.debited", {
            amount: formatNPR(bankRes.data.total_debited || totalDebited),
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
      pendingQrAmountRef.current = "";
      queryClient.invalidateQueries({ queryKey: ["transfers"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-transfers"] });
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

  function applyScannedQr(raw: string): boolean {
    const parsed = parseBankQr(raw, banks);
    if (!parsed.ok) {
      toast.error(
        parsed.reason === "not_bank" ? t("transfer.qrNotBank") : t("transfer.qrInvalid"),
      );
      return false;
    }
    const data = parsed.data;
    if (data.isMySewaWallet) {
      if (user?.phone && phonesMatch(data.accountNumber, user.phone)) {
        toast.message(t("scan.ownQr"));
        return false;
      }
      if (method !== "wallet") {
        skipMethodResetRef.current = true;
        setMethod("wallet");
      }
      setWalletPhone(data.accountNumber);
      setWalletRecipient(null);
      void lookupWalletUser(data.accountNumber);
      return true;
    }
    const resolvedBank = resolveBankCode(data.bankCode, data.bankName);
    const nextMethod: TransferMethod = data.isMobile ? "phone" : "bank";
    if (nextMethod !== method) {
      skipMethodResetRef.current = true;
      setMethod(nextMethod);
    }
    resetVerification();
    setBank(resolvedBank);
    if (data.isMobile) {
      setPhone(data.accountNumber);
      setAccNo("");
    } else {
      setAccNo(data.accountNumber);
      setPhone("");
    }
    setAccName(data.accountName);
    pendingQrAmountRef.current = data.amount;
    if (!resolvedBank) {
      toast.message(t("transfer.qrSelectBank"));
    } else {
      toast.message(t("transfer.qrFilled"));
    }
    return true;
  }

  useEffect(() => {
    if (appliedStashRef.current) return;
    const raw = peekStashedQr();
    if (!raw) return;
    const parsed = parseBankQr(raw, banks);
    if (!parsed.ok) {
      if (banksQuery.isLoading) return;
      takeStashedQr();
      appliedStashRef.current = true;
      toast.error(
        parsed.reason === "not_bank" ? t("transfer.qrNotBank") : t("transfer.qrInvalid"),
      );
      return;
    }
    if (!parsed.data.isMySewaWallet && !parsed.data.isMobile && banksQuery.isLoading) {
      return;
    }
    takeStashedQr();
    appliedStashRef.current = true;
    applyScannedQr(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks, banksQuery.isLoading]);

  async function verifyDestination(overrides?: {
    bankCode?: string;
    accountNumber?: string;
    accountName?: string;
    isMobile?: boolean;
    allowMissingName?: boolean;
  }): Promise<VerifyResult> {
    const useMobile = overrides?.isMobile ?? isMobile;
    const useBank = resolveBankCode(
      overrides?.bankCode ?? bank,
      overrides?.accountName ?? "",
    );
    const useName = (overrides?.accountName ?? accName).trim();
    const useNumber = (
      overrides?.accountNumber ?? (useMobile ? phone : accNo)
    ).trim();
    const useBankMeta = banks.find((b) => b.bank_code === useBank) || selectedBank;

    if (accountPending) {
      toast.error(t("account.pending"));
      return "abort";
    }
    if (walletLocked) {
      toast.error(walletLockMessage);
      return "abort";
    }
    if (!useBank) {
      toast.error(
        useMobile ? t("transfer.enterBankAndPhone") : t("transfer.enterBankAndName"),
      );
      return "abort";
    }
    if (useMobile) {
      const digits = useNumber.replace(/\D/g, "");
      if (digits.length < 10) {
        toast.error(t("transfer.invalidNepaliMobile"));
        return "abort";
      }
    } else {
      if (!useName && !overrides?.allowMissingName) {
        toast.error(t("transfer.enterBankAndName"));
        return "abort";
      }
      if (useNumber.length < 5) {
        toast.error(t("transfer.enterValidAccount"));
        return "abort";
      }
    }
    setVerifying(true);
    try {
      const res = await apiClient.verifyBank({
        bank_code: useBank,
        bank_name: useBankMeta?.bank_name || "",
        // Phone / QR: do not send a printed name — provider returns the registered holder.
        ...(useMobile || overrides?.allowMissingName || !useName ? {} : { account_name: useName }),
        account_number: useNumber,
        is_mobile: useMobile,
      });
      if (!res.data?.verified) {
        setVerified(false);
        setVerifyStatus("unverified");
        setVerifiedDetails(null);
        toast.error(t("transfer.dontMatch"));
        return "failed";
      }
      const originalName = (res.data.account_name || "").trim();
      if (!originalName) {
        setVerified(false);
        setVerifyStatus("unverified");
        setVerifiedDetails(null);
        toast.error(t("transfer.dontMatch"));
        return "failed";
      }
      const confirmedBankCode = res.data.bank_code || useBank;
      const confirmedNumber = (res.data.account_number || useNumber).trim();
      if (res.data.bank_code && res.data.bank_code !== useBank) {
        setBank(res.data.bank_code);
      } else if (useBank && useBank !== bank) {
        setBank(useBank);
      }
      if (useMobile) {
        setPhone(confirmedNumber);
      } else {
        setAccNo(confirmedNumber);
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
        is_mobile: useMobile,
      });
      setVerified(true);
      setVerifyStatus("verified");
      if (pendingQrAmountRef.current) {
        setAmount(pendingQrAmountRef.current);
        pendingQrAmountRef.current = "";
      }
      toast.success(
        useMobile
          ? t("transfer.verifiedPhone", { name: originalName })
          : res.message || t("transfer.accountVerified"),
      );
      return "verified";
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
      return "failed";
    } finally {
      setVerifying(false);
    }
  }

  const transferMain = (
      <div className="grid min-w-0 max-w-full gap-5 lg:grid-cols-2">
        {accountPending || walletLocked ? (
          <div className="lg:col-span-2">
            <AccountPendingBanner />
          </div>
        ) : null}
        {!anyTransferEnabled && !accountPending ? (
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
            className="mb-3"
          >
            <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl">
              <TabsTrigger value="bank" className="rounded-lg" disabled={!transfersEnabled}>
                {t("transfer.tabBank")}
              </TabsTrigger>
              <TabsTrigger value="phone" className="rounded-lg" disabled={!transfersEnabled}>
                {t("transfer.tabPhone")}
              </TabsTrigger>
              <TabsTrigger value="wallet" className="rounded-lg" disabled={!walletTransfersEnabled}>
                {t("transfer.tabWallet")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {method === "wallet" ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!walletRecipient) {
                  toast.error(t("transfer.walletFindFirst"));
                  return;
                }
                setPinError(null);
                setPinOpen(true);
              }}
            >
              {walletTransfersEnabled ? null : (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {t("transfer.walletDisabledBody")}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="walletPhone">{t("transfer.walletPhone")}</Label>
                <div className="flex min-w-0 gap-2">
                  <Input
                    id="walletPhone"
                    inputMode="tel"
                    placeholder={t("transfer.phonePlaceholder")}
                    value={walletPhone}
                    onChange={(e) => {
                      setWalletPhone(e.target.value);
                      setWalletRecipient(null);
                    }}
                    className="h-12 rounded-xl"
                    disabled={!walletTransfersEnabled}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12 shrink-0 rounded-xl"
                    disabled={!walletTransfersEnabled || walletLooking}
                    onClick={() => void lookupWalletUser()}
                  >
                    {walletLooking ? t("transfer.walletLooking") : t("transfer.walletLookup")}
                  </Button>
                </div>
                <p className="text-[12px] text-muted-foreground">{t("transfer.walletPhoneHelp")}</p>
              </div>

              {walletRecipient ? (
                <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2.5">
                  <p className="text-[12px] text-muted-foreground">{t("transfer.statusVerified")}</p>
                  <p className="text-[15px] font-medium">
                    {walletRecipient.name || walletRecipient.phone}
                  </p>
                  <p className="text-[13px] text-muted-foreground">{walletRecipient.phone}</p>
                  {walletRecipient.business_name ? (
                    <p className="text-[12px] text-muted-foreground">{walletRecipient.business_name}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="walletAmount">{t("common.amount")}</Label>
                <Input
                  id="walletAmount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={t("transfer.minError", { min: minTransfer })}
                  className="h-12 rounded-xl"
                  required
                  disabled={!walletTransfersEnabled || !walletRecipient}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="walletRemarks">{t("transfer.remarks")}</Label>
                <Input
                  id="walletRemarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="h-12 rounded-xl"
                  disabled={!walletTransfersEnabled || !walletRecipient}
                />
              </div>

              <UserChargePreview
                amount={amt}
                charge={charge}
                cashback={cashback}
                chargeLabel={t("transfer.walletCharge")}
                totalDebited={totalDebited || amt.toFixed(2)}
                insufficient={insufficient}
                insufficientText={t("transfer.insufficient", {
                  required: formatNPR(totalDue),
                  available: formatNPR(walletBalance),
                })}
              />

              <Button
                type="submit"
              disabled={
                submitMutation.isPending ||
                !walletTransfersEnabled ||
                walletLocked ||
                insufficient ||
                !walletRecipient ||
                amt < minTransfer
                }
                className="h-12 w-full rounded-xl text-[17px]"
              >
                {submitMutation.isPending ? t("common.processing") : t("transfer.walletConfirm")}
              </Button>
            </form>
          ) : (
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
                    className="h-12 shrink-0 whitespace-nowrap rounded-xl px-3"
                    disabled={
                      verifying ||
                      !transfersEnabled ||
                      !bank ||
                      phone.replace(/\D/g, "").length < 10
                    }
                    onClick={() => void verifyDestination()}
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
                    className="h-12 shrink-0 whitespace-nowrap rounded-xl px-3"
                    disabled={
                      verifying ||
                      !transfersEnabled ||
                      !bank ||
                      !accNo.trim()
                    }
                    onClick={() =>
                      void verifyDestination({ allowMissingName: !accName.trim() })
                    }
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

            <UserChargePreview
              amount={amt}
              charge={charge}
              cashback={cashback}
              chargeLabel={t("transfer.charge")}
              totalDebited={totalDebited}
              insufficient={insufficient}
              insufficientText={t("transfer.insufficient", {
                required: formatNPR(totalDue),
                available: formatNPR(walletBalance),
              })}
            />

            <Button
              type="submit"
              disabled={
                submitMutation.isPending ||
                !transfersEnabled ||
                walletLocked ||
                insufficient ||
                !verified ||
                amt < minTransfer
              }
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {submitMutation.isPending ? t("common.processing") : t("transfer.confirm")}
            </Button>
          </form>
          )}
        </section>

        <section className="min-w-0">
          {lastReceiptId ? (
            <div className="mb-3">
              <TransactionResultBanner
                tone={
                  lastReceiptId.startsWith("wt-")
                    ? "success"
                    : transferItems.find(
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
          {historyQuery.isLoading && walletHistoryQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !recentRows.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("transfer.empty")}
            </div>
          ) : (
            <ul className="inset-group min-w-0 divide-y divide-border overflow-hidden">
              {recentRows.map((row) => {
                if (row.kind === "wallet") {
                  const wt = row.item;
                  const received = wt.direction === "received";
                  return (
                    <li key={row.id}>
                      <div className="flex items-stretch gap-1 px-2 py-1">
                        <Link
                          to="/app/history/$activityId"
                          params={{ activityId: activityIdForKind("wallet_transfer", wt.id) }}
                          className="min-w-0 flex-1 rounded-lg px-2 py-2 transition-colors active:bg-muted/60"
                        >
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[15px] font-medium">
                                {received
                                  ? t("activity.walletTransferReceived")
                                  : t("activity.walletTransferSent")}
                              </p>
                              <p className="truncate text-[13px] text-muted-foreground">
                                {wt.counterparty_name
                                  ? `${wt.counterparty_name} · ${wt.counterparty_phone}`
                                  : wt.counterparty_phone}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="tabular text-[15px] font-semibold">
                                {received
                                  ? `+ ${formatNPR(wt.amount)}`
                                  : formatNPR(
                                      Number(wt.total_debited) > 0
                                        ? wt.total_debited!
                                        : wt.amount,
                                    )}
                              </p>
                              <StatusChip status={wt.status} compact className="mt-1" />
                            </div>
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
                          </div>
                          <p className="mt-1 truncate text-[12px] text-muted-foreground">
                            {wt.reference} · {formatDateTime(wt.created_at)}
                          </p>
                        </Link>
                        <div className="flex shrink-0 flex-col items-end justify-center gap-1 self-center px-2">
                          <ReceiptDownloadLink
                            label={t("list.downloadReceipt")}
                            downloading={receiptDownloading}
                            onClick={() =>
                              void downloadReceipt(activityIdForKind("wallet_transfer", wt.id))
                            }
                          />
                        </div>
                      </div>
                    </li>
                  );
                }
                const b = row.item;
                return (
                <li key={row.id}>
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
                );
              })}
            </ul>
          )}
        </section>
      </div>
  );

  return (
    <UserShell
      title={t("transfer.title")}
      back="/app"
      headerTrailing={
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-10 shrink-0 rounded-xl border border-white/25 bg-white/15 text-primary-foreground shadow-sm backdrop-blur",
              "hover:bg-white/25",
              "lg:border-border lg:bg-surface lg:text-foreground lg:hover:border-brand/35 lg:hover:bg-brand-soft lg:hover:text-brand-dark",
            )}
            onClick={() => navigate({ to: "/app/scan" })}
            aria-label={t("transfer.scanQr")}
          >
            <QrCode className="size-4" />
          </Button>
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
        </div>
      }
    >
      {transferMain}
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
