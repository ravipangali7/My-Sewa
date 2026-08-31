import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastApiError, toastApiMessage } from "@/lib/api-errors";
import { apiClient, ApiError } from "@/lib/api";
import {
  OPERATORS,
  TOPUP_AMOUNT_PRESETS,
  normalizeNepalMobile,
  validateOperatorMobile,
} from "@/lib/constants";
import { formatNPR, formatDateTime, sortByLatestFirst } from "@/lib/format";
import { userFacingChargeExtra } from "@/lib/user-charge";
import { UserChargePreview } from "@/components/UserChargePreview";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { liveQueryOptions, settingsQueryOptions } from "@/lib/refresh";
import { usePendingStatusPoll } from "@/hooks/use-pending-status-poll";
import { isAccountPending, isWalletTxnLocked, walletTxnLockMessageKey } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { TransactionPinDialog } from "@/components/TransactionPinDialog";
import { useI18n } from "@/lib/i18n";
import type { TopupTransaction } from "@/lib/types";

export const Route = createFileRoute("/app/topup")({
  head: () => ({
    meta: [
      { title: "Mobile Top-Up NTC & NCELL — MySewa" },
      {
        name: "description",
        content:
          "Recharge NTC or NCELL mobile numbers from your MySewa business wallet balance with a single combined top-up charge.",
      },
      { property: "og:title", content: "Mobile Top-Up — MySewa" },
      {
        property: "og:description",
        content: "NTC and NCELL recharge straight from your wallet balance.",
      },
    ],
  }),
  component: TopUp,
});

function TopUp() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { t } = useI18n();
  const accountPending = isAccountPending(user);
  const [productId, setProductId] = useState<1 | 2>(1);
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [charge, setCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");
  const [feeLoading, setFeeLoading] = useState(false);
  const [touchedMobile, setTouchedMobile] = useState(false);
  const [providerBlocked, setProviderBlocked] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
    ...settingsQueryOptions(),
  });
  const topupsEnabled =
    settingsQuery.data?.config?.payment?.topups_enabled !== false && !accountPending;
  const depositsEnabled =
    settingsQuery.data?.config?.payment?.deposits_enabled !== false && !accountPending;
  const minTopup = settingsQuery.data?.config?.transactions?.min_topup ?? 10;
  const maxTopup = settingsQuery.data?.config?.transactions?.max_topup ?? 5000;

  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    ...liveQueryOptions(),
  });

  const historyQuery = useQuery({
    queryKey: ["topups"],
    queryFn: () => apiClient.topupHistory(),
    ...liveQueryOptions(),
  });
  const topupItems = useMemo(
    () => sortByLatestFirst(historyQuery.data?.items ?? []),
    [historyQuery.data?.items],
  );

  const servicesQuery = useQuery({
    queryKey: ["topup", "services"],
    queryFn: () => apiClient.topupServices(),
    enabled: topupsEnabled,
    staleTime: 60_000,
    retry: 1,
  });

  const amt = Number(amount) || 0;
  const serviceName = productId === 1 ? "NTC" : "NCELL";
  const walletBalance = Number(walletQuery.data?.balance ?? 0);
  const walletLocked = isWalletTxnLocked(walletQuery.data, user);
  const walletLockMessage = t(walletTxnLockMessageKey(walletQuery.data, user));
  const totalDue = Number(totalDebited) || amt;
  const insufficient =
    amt >= minTopup && totalDue > 0 && walletBalance < totalDue;
  const mobileError = useMemo(
    () => validateOperatorMobile(productId, mobile),
    [productId, mobile],
  );
  const showMobileError = touchedMobile && mobileError !== null;
  const normalizedMobile = normalizeNepalMobile(mobile).slice(-10);
  const mobileReady =
    normalizedMobile.length === 10 && mobileError === null;

  const availableOperators = useMemo(() => {
    const services = servicesQuery.data?.services ?? [];
    const names = new Set(
      services.map((s) => String(s.name || "").toUpperCase()).filter(Boolean),
    );
    if (!names.size) return [1, 2] as const;
    const ids: Array<1 | 2> = [];
    if (names.has("NTC")) ids.push(1);
    if (names.has("NCELL")) ids.push(2);
    return (ids.length ? ids : ([1, 2] as const)) as ReadonlyArray<1 | 2>;
  }, [servicesQuery.data]);

  useEffect(() => {
    if (!availableOperators.includes(productId) && availableOperators[0]) {
      setProductId(availableOperators[0]);
    }
  }, [availableOperators, productId]);

  useEffect(() => {
    if (!topupsEnabled || amt < minTopup) {
      setCharge("0.00");
      setCashback("0.00");
      setTotalDebited("0.00");
      setFeeLoading(false);
      return;
    }
    let cancelled = false;
    setFeeLoading(true);
    const timer = setTimeout(() => {
      apiClient
        .calculateCharge(serviceName, amt)
        .then((res) => {
          if (cancelled) return;
          setProviderBlocked(false);
          setCharge(String(res.charge));
          setCashback(String(res.cashback_credit ?? res.cashback));
          setTotalDebited(String(res.total_debited));
        })
        .catch((err) => {
          if (cancelled) return;
          setCharge("0.00");
          setCashback("0.00");
          setTotalDebited(amt.toFixed(2));
          if (err instanceof ApiError) {
            const msg = err.message.toLowerCase();
            if (msg.includes("ip not") || msg.includes("allowlist") || err.status === 403) {
              setProviderBlocked(true);
              toastApiError(err, {
                title: t("topup.providerError"),
                fallback: t("topup.providerError"),
              });
            }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amt, serviceName, topupsEnabled, minTopup]);

  // Auto-poll HimalPay status for pending top-ups (docs: wallet-service-reseller-status)
  usePendingStatusPoll(
    topupItems,
    async (item) => {
      const res = await apiClient.topupStatus(item.merchant_txn_id);
      return { nextStatus: res.local_topup?.status, message: res.message };
    },
    {
      invalidateKeys: [["topups"], ["wallet"]],
      onSettled: (_item, next, message) => {
        if (next === "success") {
          toast.success(t("topup.statusSuccess"));
        } else if (next === "failed") {
          if (message) {
            toastApiMessage(message, {
              title: t("topup.statusFailed"),
              fallback: t("topup.statusFailed"),
            });
          } else {
            toast.error(t("topup.statusFailed"));
          }
        }
      },
    },
  );

  const refreshStatus = async (item: TopupTransaction) => {
    setRefreshingId(item.id);
    try {
      const res = await apiClient.topupStatus(item.merchant_txn_id);
      const local = res.local_topup;
      if (local?.status === "success" || res.status === "success") {
        toast.success(t("topup.statusSuccess"));
      } else if (local?.status === "failed" || res.status === "failed") {
        if (res.message) {
          toastApiMessage(res.message, {
            title: t("topup.statusFailed"),
            fallback: t("topup.statusFailed"),
          });
        } else {
          toast.error(t("topup.statusFailed"));
        }
      } else {
        toast.message(t("topup.statusPending"));
      }
      queryClient.invalidateQueries({ queryKey: ["topups"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    } catch (err) {
      toastApiError(err, {
        title: t("topup.statusFailedTitle"),
        fallback: t("topup.statusFailedTitle"),
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const submitMutation = useMutation({
    mutationFn: async (transaction_pin: string) => {
      if (accountPending) throw new Error(t("account.pending"));
      if (walletLocked) throw new Error(walletLockMessage);
      if (!topupsEnabled) throw new Error(t("topup.disabledError"));
      setTouchedMobile(true);
      if (validateOperatorMobile(productId, mobile)) {
        throw new Error(t("topup.invalidNumber"));
      }
      if (normalizedMobile.length < 10) {
        throw new Error(t("topup.validMobile"));
      }
      if (amt < minTopup) throw new Error(t("topup.minError", { min: minTopup }));
      if (maxTopup > 0 && amt > maxTopup) throw new Error(t("topup.maxError", { max: maxTopup }));
      if (insufficient) {
        throw new Error(
          t("topup.insufficient", {
            required: formatNPR(totalDue),
            available: formatNPR(walletBalance),
          }),
        );
      }
      const body = {
        mobile_number: normalizedMobile,
        // Rupees with 2 decimals; server converts to paisa (×100) for HimalPay.
        amount: Number(amt.toFixed(2)),
        product_id: productId,
        transaction_pin,
      };
      if (productId === 1) return apiClient.topupNtc({ ...body, product_id: 1 });
      return apiClient.topupNcell({ ...body, product_id: 2 });
    },
    onSuccess: (res) => {
      setPinOpen(false);
      setPinError(null);
      const isPending = res.data.status === "pending";
      if (isPending) {
        toast.message(res.message || t("topup.pendingTitle", { operator: OPERATORS[productId] }), {
          description: res.pending_message || t("topup.pendingBody"),
        });
      } else {
        toast.success(res.message || t("topup.submitted", { operator: OPERATORS[productId] }), {
          description: t("transfer.debited", {
            amount: formatNPR(res.data.total_debited || totalDebited),
          }),
        });
      }
      setMobile("");
      setAmount("");
      setTouchedMobile(false);
      setCharge("0.00");
      setCashback("0.00");
      setTotalDebited("0.00");
      queryClient.invalidateQueries({ queryKey: ["topups"] });
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
            title: t("topup.failed"),
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
        title: t("topup.failed"),
        fallback: t("topup.failed"),
      });
    },
  });

  const myPhone = normalizeNepalMobile(user?.phone || "").slice(-10);

  return (
    <UserShell title={t("topup.title")} back="/app">
      <div className="grid min-w-0 max-w-full gap-5 lg:grid-cols-2">
        {accountPending || walletLocked ? (
          <div className="lg:col-span-2">
            <AccountPendingBanner />
          </div>
        ) : null}
        {!topupsEnabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4 lg:col-span-2">
            <p className="text-[15px] font-medium text-destructive">{t("topup.disabledTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("topup.disabledBody")}</p>
          </section>
        ) : null}
        {providerBlocked ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4 lg:col-span-2">
            <p className="text-[15px] font-medium text-destructive">{t("topup.providerBlocked")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("topup.providerBlockedBody")}</p>
          </section>
        ) : null}

        <section className="inset-group min-w-0 max-w-full p-4">
          <div className="mb-4 flex min-w-0 items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5">
            <div>
              <p className="text-[12px] text-muted-foreground">{t("topup.walletLabel")}</p>
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

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setPinError(null);
              setPinOpen(true);
            }}
          >
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
              {availableOperators.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setProductId(id);
                    setTouchedMobile(Boolean(mobile.trim()));
                  }}
                  disabled={!topupsEnabled}
                  className={cn(
                    "rounded-lg py-2 text-[15px] font-medium transition-colors",
                    productId === id
                      ? "bg-surface text-brand-dark shadow-card"
                      : "text-muted-foreground",
                  )}
                >
                  {OPERATORS[id]}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="mobile_number">{t("topup.mobileLabel")}</Label>
                {myPhone.length === 10 ? (
                  <button
                    type="button"
                    disabled={!topupsEnabled}
                    onClick={() => {
                      setMobile(myPhone);
                      setTouchedMobile(true);
                    }}
                    className="text-[12px] font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {t("topup.useMyNumber")}
                  </button>
                ) : null}
              </div>
              <Input
                id="mobile_number"
                inputMode="tel"
                autoComplete="tel"
                placeholder={productId === 1 ? "984XXXXXXX" : "980XXXXXXX"}
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                onBlur={() => setTouchedMobile(true)}
                aria-invalid={showMobileError}
                className={cn(
                  "h-12 rounded-xl",
                  showMobileError && "border-destructive focus-visible:ring-destructive/40",
                )}
                required
                disabled={!topupsEnabled}
              />
              {showMobileError ? (
                <p className="text-[13px] font-medium text-destructive" role="alert">
                  {t("topup.invalidNumber")}
                </p>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  {productId === 1 ? t("topup.ntcHelp") : t("topup.ncellHelp")}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="topup_amount">{t("common.amountNpr")}</Label>
              <Input
                id="topup_amount"
                inputMode="decimal"
                placeholder={t("common.amountPlaceholder")}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                className="tabular h-12 rounded-xl text-[22px] font-semibold"
                required
                disabled={!topupsEnabled}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {TOPUP_AMOUNT_PRESETS.filter(
                  (preset) =>
                    preset >= minTopup && (maxTopup <= 0 || preset <= maxTopup),
                ).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={!topupsEnabled}
                    onClick={() => setAmount(String(preset))}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-[13px] font-medium transition-colors",
                      Number(amount) === preset
                        ? "border-brand bg-brand/10 text-brand-dark"
                        : "border-border bg-surface text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t("common.minMax", { min: minTopup, max: maxTopup })}
              </p>
            </div>

            <UserChargePreview
              amount={amt}
              charge={charge}
              cashback={cashback}
              chargeLabel={t("topup.serviceCharge")}
              totalDebited={totalDebited || String(amt)}
              loading={feeLoading}
              insufficient={insufficient}
              insufficientText={t("topup.insufficient", {
                required: formatNPR(totalDue),
                available: formatNPR(walletBalance),
              })}
            />

            <Button
              type="submit"
              disabled={
                submitMutation.isPending ||
                feeLoading ||
                !topupsEnabled ||
                walletLocked ||
                !mobileReady ||
                amt < minTopup ||
                providerBlocked ||
                insufficient
              }
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {submitMutation.isPending ? t("common.processing") : t("topup.confirm")}
            </Button>
          </form>
        </section>

        <section className="min-w-0 max-w-full">
          <h2 className="mb-2 px-1 text-[17px] font-semibold">{t("topup.recent")}</h2>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !topupItems.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("topup.empty")}
            </div>
          ) : (
            <ul className="inset-group min-w-0 divide-y divide-border overflow-hidden">
              {topupItems.map((item) => {
                const extra = userFacingChargeExtra({
                  amount: item.amount,
                  charge: item.charge,
                  cashback: item.cashback,
                  totalDebited: item.total_debited,
                });
                return (
                  <li key={item.id} className="min-w-0 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        {item.product_name || OPERATORS[item.product_id]} · {item.mobile_number}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {item.merchant_txn_id} · {formatDateTime(item.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-[15px] font-semibold">
                        {formatNPR(
                          Number(item.total_debited) > 0 ? item.total_debited : item.amount,
                        )}
                      </p>
                      <StatusChip status={item.status} compact className="mt-1" />
                    </div>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[12px] text-muted-foreground">
                      {extra > 0
                        ? t("topup.chargeLine", {
                            charge: formatNPR(extra),
                            debited: formatNPR(item.total_debited),
                          })
                        : t("transfer.debited", {
                            amount: formatNPR(item.total_debited || item.amount),
                          })}
                    </p>
                    {item.status === "pending" ? (
                      <button
                        type="button"
                        disabled={refreshingId === item.id}
                        onClick={() => void refreshStatus(item)}
                        className="shrink-0 text-[12px] font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        {refreshingId === item.id
                          ? t("common.processing")
                          : t("topup.checkStatus")}
                      </button>
                    ) : null}
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

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
