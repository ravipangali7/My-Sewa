import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { BankCombobox } from "@/components/BankCombobox";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useErrorPopup } from "@/components/ErrorPopup";
import { apiClient, ApiError } from "@/lib/api";
import { mergeBankLists } from "@/lib/nepali-banks";
import type { BankOption, BankTransferTransaction } from "@/lib/types";
import { formatNPR, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { isAccountPending } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/app/transfer")({
  head: () => ({
    meta: [
      { title: "Fund Transfer — Send Money in Nepal | MySewa" },
      {
        name: "description",
        content:
          "Send money from your MySewa wallet to any Nepali bank account or mobile number: verify, review charges and confirm.",
      },
      { property: "og:title", content: "Fund Transfer — MySewa" },
      {
        property: "og:description",
        content: "Bank account or phone number transfers from your MySewa wallet.",
      },
    ],
  }),
  component: Transfer,
});

type TransferMethod = "bank" | "phone";

function Transfer() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const accountPending = isAccountPending(user);
  const errorPopup = useErrorPopup(t("transfer.failed"));
  const [method, setMethod] = useState<TransferMethod>("bank");
  const [bank, setBank] = useState("");
  const [accNo, setAccNo] = useState("");
  const [accName, setAccName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState(() => t("transfer.defaultRemarks"));
  const [verified, setVerified] = useState(false);
  const [charge, setCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");
  const [verifying, setVerifying] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [showAllRecent, setShowAllRecent] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });
  const transfersEnabled =
    settingsQuery.data?.config?.payment?.transfers_enabled !== false && !accountPending;
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
    errorPopup.showError(banksQuery.error, {
      title: t("transfer.banksFailed"),
      fallback: t("transfer.banksFailedFallback"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banksQuery.isError, banksQuery.error]);

  const historyQuery = useQuery({
    queryKey: ["transfers"],
    queryFn: () => apiClient.transferHistory(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  // Auto-poll HimalPay status for pending transfers (wallet-service-reseller-status)
  useEffect(() => {
    const pending = (historyQuery.data ?? []).filter((item) => item.status === "pending");
    if (!pending.length) return;

    let cancelled = false;
    const poll = async () => {
      let changed = false;
      for (const item of pending.slice(0, 5)) {
        try {
          const res = await apiClient.transferStatus(item.merchant_txn_id);
          if (
            res.local_transfer &&
            res.local_transfer.status !== "pending" &&
            res.local_transfer.status !== item.status
          ) {
            changed = true;
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
  }, [historyQuery.data, queryClient]);

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
    if (!banks.length) return;
    if (bank && banks.some((b) => b.bank_code === bank)) return;
    // Remap stale short codes (e.g. CTZN → CTZNNPKA) when provider list loads
    const remapped =
      (bank && banks.find((b) => b.bank_code.startsWith(bank))) || banks[0];
    setBank(remapped.bank_code);
  }, [banks, bank]);

  useEffect(() => {
    setVerified(false);
  }, [method]);

  useEffect(() => {
    setRemarks((prev) =>
      prev === "Fund Transfer" || prev === "फन्ड ट्रान्सफर" ? t("transfer.defaultRemarks") : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    if (!transfersEnabled || amt < minTransfer) {
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
              errorPopup.showError(err, { title: t("transfer.providerError") });
            }
          }
        });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amt, transfersEnabled, minTransfer]);

  const selectedBank = banks.find((b) => b.bank_code === bank);

  const refreshStatus = async (item: BankTransferTransaction) => {
    setRefreshingId(item.id);
    try {
      const res = await apiClient.transferStatus(item.merchant_txn_id);
      const local = res.local_transfer;
      if (local?.status === "success") {
        toast.success(t("transfer.statusSuccess"));
      } else if (local?.status === "failed") {
        toast.error(t("transfer.statusFailed"));
      } else {
        toast.message(t("transfer.statusPending"));
      }
      queryClient.invalidateQueries({ queryKey: ["transfers"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    } catch (err) {
      errorPopup.showError(err, {
        title: t("transfer.failed"),
        fallback: t("transfer.statusPending"),
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const submitMutation = useMutation({
    mutationFn: () => {
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
      });
    },
    onSuccess: (res) => {
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
      queryClient.invalidateQueries({ queryKey: ["transfers"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const body = err.body as Record<string, unknown>;
        if (body["error"] === "Insufficient balance") {
          errorPopup.showError(err, {
            title: t("transfer.failed"),
            fallback: t("transfer.insufficient", {
              required: formatNPR(String(body["required"] ?? totalDue)),
              available: formatNPR(String(body["available"] ?? walletBalance)),
            }),
          });
          return;
        }
      }
      errorPopup.showError(err, { title: t("transfer.failed"), fallback: t("transfer.failed") });
    },
  });

  async function verifyDestination() {
    if (accountPending) {
      errorPopup.showMessage(t("account.pending"), { title: t("transfer.accountPendingTitle") });
      return;
    }
    if (!bank || !accName.trim()) {
      errorPopup.showMessage(t("transfer.enterBankAndName"), {
        title: t("transfer.missingDetails"),
      });
      return;
    }
    if (isMobile) {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10) {
        errorPopup.showMessage(t("transfer.invalidNepaliMobile"), {
          title: t("transfer.invalidPhone"),
        });
        return;
      }
    } else if (accNo.trim().length < 5) {
      errorPopup.showMessage(t("transfer.enterValidAccount"), {
        title: t("transfer.invalidAccount"),
      });
      return;
    }
    setVerifying(true);
    try {
      const res = await apiClient.verifyBank({
        bank_code: bank,
        account_name: accName.trim(),
        account_number: destinationNumber,
        is_mobile: isMobile,
      });
      if (!res.data?.verified) {
        setVerified(false);
        errorPopup.showMessage(t("transfer.couldNotVerify"), {
          title: t("transfer.verifyFailed"),
        });
        return;
      }
      // Use the bank-returned original account holder name for the transfer
      const originalName = (res.data.account_name || accName).trim();
      setAccName(originalName);
      if (res.data.bank_code && res.data.bank_code !== bank) {
        setBank(res.data.bank_code);
      }
      setVerified(true);
      toast.success(
        originalName !== accName.trim()
          ? t("transfer.verifiedAs", { name: originalName })
          : res.message || t("transfer.accountVerified"),
      );
    } catch (err) {
      setVerified(false);
      errorPopup.showError(err, {
        title: t("transfer.verifyFailed"),
        fallback: t("transfer.verifyFailed"),
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <UserShell title={t("transfer.title")} back="/app">
      {errorPopup.popup}
      <div className="grid gap-5 lg:grid-cols-2">
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
        <section className="inset-group p-4">
          <p className="mb-3 text-[12px] text-muted-foreground">{t("transfer.workflowHint")}</p>
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
                errorPopup.showMessage(t("transfer.verifyFirst"), {
                  title: t("transfer.verifyRequired"),
                });
                return;
              }
              submitMutation.mutate();
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
                  setVerified(false);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="accName">{t("transfer.accHolder")}</Label>
              <Input
                id="accName"
                value={accName}
                onChange={(e) => {
                  setAccName(e.target.value);
                  setVerified(false);
                }}
                className="h-12 rounded-xl"
                required
                disabled={!transfersEnabled}
              />
            </div>

            {isMobile ? (
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("transfer.destPhone")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="phone"
                    inputMode="tel"
                    placeholder={t("transfer.phonePlaceholder")}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setVerified(false);
                    }}
                    className="h-12 rounded-xl"
                    required
                    disabled={!transfersEnabled}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12 rounded-xl"
                    disabled={verifying || !transfersEnabled}
                    onClick={verifyDestination}
                  >
                    {verifying ? "…" : t("transfer.verify")}
                  </Button>
                </div>
                <p className="text-[12px] text-muted-foreground">{t("transfer.phoneHelp")}</p>
                {verified && (
                  <p className="text-[13px] text-success">
                    {t("transfer.verifiedAccount", { name: accName })}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="acc">{t("transfer.destAccount")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="acc"
                    value={accNo}
                    onChange={(e) => {
                      setAccNo(e.target.value);
                      setVerified(false);
                    }}
                    className="h-12 rounded-xl"
                    required
                    disabled={!transfersEnabled}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-12 rounded-xl"
                    disabled={verifying || !transfersEnabled}
                    onClick={verifyDestination}
                  >
                    {verifying ? "…" : t("transfer.verify")}
                  </Button>
                </div>
                {verified && (
                  <p className="text-[13px] text-success">
                    {t("transfer.verifiedAccount", { name: accName })}
                  </p>
                )}
              </div>
            )}

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
                disabled={!transfersEnabled}
              />
              <p className="text-[12px] text-muted-foreground">
                {t("common.minMaxDaily", {
                  min: minTransfer,
                  max: maxTransfer,
                  daily: dailyLimit,
                })}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="remarks">{t("transfer.remarks")}</Label>
              <Input
                id="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="h-12 rounded-xl"
                disabled={!transfersEnabled}
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
              disabled={submitMutation.isPending || !transfersEnabled || insufficient}
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {submitMutation.isPending ? t("common.processing") : t("transfer.confirm")}
            </Button>
          </form>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <h2 className="text-[17px] font-semibold">{t("transfer.recent")}</h2>
            {(historyQuery.data?.length ?? 0) > 5 ? (
              <button
                type="button"
                onClick={() => setShowAllRecent((v) => !v)}
                className="text-[13px] font-medium text-brand underline-offset-2 hover:underline"
              >
                {showAllRecent ? t("transfer.showLess") : t("transfer.viewAll")}
              </button>
            ) : null}
          </div>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !historyQuery.data?.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("transfer.empty")}
            </div>
          ) : (
            <ul className="inset-group divide-y divide-border">
              {(showAllRecent ? historyQuery.data : historyQuery.data.slice(0, 5)).map((b) => (
                <li key={b.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{b.destination_acc_name}</p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {b.is_destination_mobile
                          ? t("transfer.phonePrefix", { phone: b.destination_acc_no })
                          : `${b.destination_bank_name || b.destination_bank} · ${b.destination_acc_no}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-[15px] font-semibold">
                        {formatNPR(b.amount)}
                        {Number(b.charge) > 0 ? (
                          <span className="font-bold">
                            {" "}
                            + {formatNPR(b.charge)}
                          </span>
                        ) : null}
                      </p>
                      <StatusChip status={b.status} compact className="mt-1" />
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[12px] text-muted-foreground">
                      {b.merchant_txn_id} · {formatDateTime(b.created_at)} ·{" "}
                      {b.status === "failed"
                        ? t("transfer.notDebited", { amount: formatNPR(b.total_debited) })
                        : b.status === "pending"
                          ? t("transfer.pendingDebit", { amount: formatNPR(b.total_debited) })
                          : t("transfer.debited", { amount: formatNPR(b.total_debited) })}
                    </p>
                    {b.status === "pending" ? (
                      <button
                        type="button"
                        disabled={refreshingId === b.id}
                        onClick={() => void refreshStatus(b)}
                        className="shrink-0 text-[12px] font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        {refreshingId === b.id
                          ? t("common.processing")
                          : t("transfer.checkStatus")}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </UserShell>
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
