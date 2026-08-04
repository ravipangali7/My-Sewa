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
import { formatNPR, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { isAccountPending } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { useI18n } from "@/lib/i18n";
import type { TopupTransaction } from "@/lib/types";
import { ListPageToolbar, ReceiptDownloadLink, TransactionResultBanner } from "@/components/list/ListPageToolbar";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { activityIdForKind, useReceiptDownload } from "@/lib/receipt-download";
import { useSiteBranding } from "@/hooks/use-site-branding";

export const Route = createFileRoute("/app/topup")({
  head: () => ({
    meta: [
      { title: "Mobile Top-Up NTC & NCELL — MySewa" },
      {
        name: "description",
        content:
          "Recharge NTC or NCELL mobile numbers from your MySewa wallet balance with a clear charge and cashback breakdown.",
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
  const { logoUrl } = useSiteBranding();
  const { download: downloadReceipt, downloading: receiptDownloading } = useReceiptDownload(
    t,
    user?.phone,
    logoUrl,
  );
  const { filters, setFilters, debounced } = useListFilters();
  const [exporting, setExporting] = useState(false);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);
  const accountPending = isAccountPending(user);
  const [productId, setProductId] = useState<1 | 2>(1);
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [charge, setCharge] = useState("0.00");
  const [providerCharge, setProviderCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [platformCharge, setPlatformCharge] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");
  const [feeLoading, setFeeLoading] = useState(false);
  const [touchedMobile, setTouchedMobile] = useState(false);
  const [providerBlocked, setProviderBlocked] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });
  const topupsEnabled =
    settingsQuery.data?.config?.payment?.topups_enabled !== false && !accountPending;
  const minTopup = settingsQuery.data?.config?.transactions?.min_topup ?? 10;
  const maxTopup = settingsQuery.data?.config?.transactions?.max_topup ?? 5000;

  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const historyQuery = useQuery({
    queryKey: ["topups", debounced],
    queryFn: () => apiClient.topupHistory(debounced),
    refetchInterval: LIVE_REFETCH_MS,
  });
  const topupItems = historyQuery.data?.items ?? [];
  const topupStats = historyQuery.data?.stats;

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
      setProviderCharge("0.00");
      setCashback("0.00");
      setPlatformCharge("0.00");
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
          setProviderCharge(String(res.provider_charge ?? res.charge));
          setCashback(String(res.cashback));
          setPlatformCharge(String(res.platform_charge ?? "0.00"));
          setTotalDebited(String(res.total_debited));
        })
        .catch((err) => {
          if (cancelled) return;
          setCharge("0.00");
          setProviderCharge("0.00");
          setCashback("0.00");
          setPlatformCharge("0.00");
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
  useEffect(() => {
    const pending = topupItems.filter((item) => item.status === "pending");
    if (!pending.length) return;

    let cancelled = false;
    const poll = async () => {
      let changed = false;
      for (const item of pending.slice(0, 5)) {
        try {
          const res = await apiClient.topupStatus(item.merchant_txn_id);
          const next = res.local_topup?.status;
          if (next && next !== "pending" && next !== item.status) {
            changed = true;
            if (next === "success") {
              toast.success(t("topup.statusSuccess"));
              setLastReceiptId(`top-${item.id}`);
            } else if (next === "failed") {
              if (res.message) {
                toastApiMessage(res.message, {
                  title: t("topup.statusFailed"),
                  fallback: t("topup.statusFailed"),
                });
              } else {
                toast.error(t("topup.statusFailed"));
              }
            }
          }
        } catch {
          // ignore transient status errors while polling
        }
        if (cancelled) return;
      }
      if (changed && !cancelled) {
        queryClient.invalidateQueries({ queryKey: ["topups"] });
        queryClient.invalidateQueries({ queryKey: ["wallet"] });
      }
    };

    const timer = setInterval(poll, Math.max(LIVE_REFETCH_MS, 8000));
    void poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [topupItems, queryClient, t]);

  const refreshStatus = async (item: TopupTransaction) => {
    setRefreshingId(item.id);
    try {
      const res = await apiClient.topupStatus(item.merchant_txn_id);
      const local = res.local_topup;
      if (local?.status === "success" || res.status === "success") {
        toast.success(t("topup.statusSuccess"));
        setLastReceiptId(activityIdForKind("topup", item.id));
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
    mutationFn: async () => {
      if (accountPending) throw new Error(t("account.pending"));
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
      };
      if (productId === 1) return apiClient.topupNtc({ ...body, product_id: 1 });
      return apiClient.topupNcell({ ...body, product_id: 2 });
    },
    onSuccess: (res) => {
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
      setProviderCharge("0.00");
      setCashback("0.00");
      setPlatformCharge("0.00");
      setTotalDebited("0.00");
      setLastReceiptId(activityIdForKind("topup", res.data.id));
      queryClient.invalidateQueries({ queryKey: ["topups"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const body = err.body as Record<string, unknown>;
        if (body["error"] === "Insufficient balance") {
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
      toastApiError(err, {
        title: t("topup.failed"),
        fallback: t("topup.failed"),
      });
    },
  });

  const myPhone = normalizeNepalMobile(user?.phone || "").slice(-10);

  return (
    <UserShell title={t("topup.title")} back="/app">
      <div className="grid gap-5 lg:grid-cols-2">
        {accountPending ? (
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

        <section className="inset-group p-4">
          <div className="mb-4 flex items-center justify-between rounded-xl bg-muted px-3 py-2.5">
            <div>
              <p className="text-[12px] text-muted-foreground">{t("topup.walletLabel")}</p>
              <p className="tabular text-[17px] font-semibold">
                {walletQuery.isLoading ? "…" : formatNPR(walletBalance)}
              </p>
            </div>
            {insufficient ? (
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
              submitMutation.mutate();
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

            <div className="rounded-xl bg-muted p-3 text-[14px]">
              <Row label={t("common.amount")} value={formatNPR(amt)} />
              <Row
                label={t("topup.providerCharge")}
                value={feeLoading ? "…" : formatNPR(providerCharge)}
              />
              {Number(platformCharge) > 0 ? (
                <Row
                  label={t("topup.platformCharge")}
                  value={feeLoading ? "…" : formatNPR(platformCharge)}
                />
              ) : null}
              <Row
                label={t("common.cashback")}
                value={feeLoading ? "…" : `− ${formatNPR(cashback)}`}
              />
              <div className="mt-2 border-t border-separator pt-2">
                <Row
                  label={t("common.totalDebited")}
                  value={feeLoading ? "…" : formatNPR(totalDebited || charge)}
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
              type="submit"
              disabled={
                submitMutation.isPending ||
                feeLoading ||
                !topupsEnabled ||
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

        <section>
          {lastReceiptId ? (
            <div className="mb-3">
              <TransactionResultBanner
                tone={
                  topupItems.find((x) => activityIdForKind("topup", x.id) === lastReceiptId)?.status ===
                  "failed"
                    ? "danger"
                    : topupItems.find((x) => activityIdForKind("topup", x.id) === lastReceiptId)?.status ===
                        "pending"
                      ? "warning"
                      : "success"
                }
                title={t("topup.submitted", { operator: OPERATORS[productId] })}
                body={t("history.downloadStatement")}
                receiptLabel={t("history.downloadPdf")}
                onDownloadReceipt={() => void downloadReceipt(lastReceiptId)}
                downloading={receiptDownloading}
              />
            </div>
          ) : null}
          <ListPageToolbar
            stats={topupStats}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={async () => {
              setExporting(true);
              try {
                await downloadCsvExport("/api/topup/history/", debounced, "topups.csv");
              } finally {
                setExporting(false);
              }
            }}
            exporting={exporting}
            searchPlaceholder={t("list.searchPlaceholder")}
            exportLabel={t("list.exportCsv")}
            statsLabels={{
              total: t("list.statsTotal"),
              success: t("list.statsSuccess"),
              pending: t("list.statsPending"),
              failed: t("list.statsFailed"),
            }}
            statusOptions={[...TXN_STATUS_OPTIONS]}
          />
          <h2 className="mb-2 mt-4 px-1 text-[17px] font-semibold">{t("topup.recent")}</h2>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !topupItems.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("topup.empty")}
            </div>
          ) : (
            <ul className="inset-group divide-y divide-border">
              {topupItems.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium">
                        {item.product_name || OPERATORS[item.product_id]} · {item.mobile_number}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {item.merchant_txn_id} · {formatDateTime(item.created_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-[15px] font-semibold">{formatNPR(item.amount)}</p>
                      <StatusChip status={item.status} compact className="mt-1" />
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[12px] text-muted-foreground">
                      {t("topup.chargeLine", {
                        charge: formatNPR(item.charge),
                        cashback: formatNPR(item.cashback),
                        debited: formatNPR(item.total_debited),
                      })}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {(item.status === "success" || item.status === "failed") && (
                        <ReceiptDownloadLink
                          label={t("list.downloadReceipt")}
                          downloading={receiptDownloading}
                          onClick={() => void downloadReceipt(activityIdForKind("topup", item.id))}
                        />
                      )}
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
