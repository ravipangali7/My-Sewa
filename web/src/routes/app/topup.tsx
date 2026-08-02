import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useErrorPopup } from "@/components/ErrorPopup";
import { apiClient, ApiError } from "@/lib/api";
import {
  OPERATORS,
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
  const accountPending = isAccountPending(user);
  const errorPopup = useErrorPopup(t("topup.failed"));
  const [productId, setProductId] = useState<1 | 2>(1);
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [charge, setCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");
  const [touchedMobile, setTouchedMobile] = useState(false);
  const [providerBlocked, setProviderBlocked] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });
  const topupsEnabled =
    settingsQuery.data?.config?.payment?.topups_enabled !== false && !accountPending;
  const minTopup = settingsQuery.data?.config?.transactions?.min_topup ?? 10;
  const maxTopup = settingsQuery.data?.config?.transactions?.max_topup ?? 5000;

  const historyQuery = useQuery({
    queryKey: ["topups"],
    queryFn: () => apiClient.topupHistory(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const amt = Number(amount) || 0;
  const serviceName = productId === 1 ? "NTC" : "NCELL";
  const mobileError = useMemo(
    () => validateOperatorMobile(productId, mobile),
    [productId, mobile],
  );
  const showMobileError = touchedMobile && mobileError !== null;
  const normalizedMobile = normalizeNepalMobile(mobile).slice(-10);
  const mobileReady =
    normalizedMobile.length === 10 && mobileError === null;

  useEffect(() => {
    if (!topupsEnabled || amt < minTopup) {
      setCharge("0.00");
      setCashback("0.00");
      setTotalDebited("0.00");
      return;
    }
    const timer = setTimeout(() => {
      apiClient
        .calculateCharge(serviceName, amt)
        .then((res) => {
          setProviderBlocked(false);
          setCharge(String(res.charge));
          setCashback(String(res.cashback));
          setTotalDebited(String(res.total_debited));
        })
        .catch((err) => {
          setCharge("0.00");
          setCashback("0.00");
          setTotalDebited(amt.toFixed(2));
          if (err instanceof ApiError) {
            const msg = err.message.toLowerCase();
            if (msg.includes("ip not") || msg.includes("allowlist") || err.status === 403) {
              setProviderBlocked(true);
              errorPopup.showError(err, { title: t("topup.providerError") });
            }
          }
        });
    }, 350);
    return () => clearTimeout(timer);
    // intentionally omit errorPopup — show once per failed fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amt, serviceName, topupsEnabled, minTopup]);

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
      const body = {
        mobile_number: normalizedMobile,
        amount: amt,
        product_id: productId,
      };
      if (productId === 1) return apiClient.topupNtc({ ...body, product_id: 1 });
      return apiClient.topupNcell({ ...body, product_id: 2 });
    },
    onSuccess: (res) => {
      toast.success(res.message || t("topup.submitted", { operator: OPERATORS[productId] }), {
        description: t("transfer.debited", {
          amount: formatNPR(res.data.total_debited || totalDebited),
        }),
      });
      setMobile("");
      setAmount("");
      setTouchedMobile(false);
      queryClient.invalidateQueries({ queryKey: ["topups"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (err) => {
      errorPopup.showError(err, {
        title: t("topup.failed"),
        fallback: t("topup.failed"),
      });
    },
  });

  return (
    <UserShell title={t("topup.title")} back="/app">
      {errorPopup.popup}
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
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitMutation.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
              {([1, 2] as const).map((id) => (
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
              <Label htmlFor="mobile_number">{t("topup.mobileLabel")}</Label>
              <Input
                id="mobile_number"
                inputMode="tel"
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
                onChange={(e) => setAmount(e.target.value)}
                className="tabular h-12 rounded-xl text-[22px] font-semibold"
                required
                disabled={!topupsEnabled}
              />
              <p className="text-[12px] text-muted-foreground">
                {t("common.minMax", { min: minTopup, max: maxTopup })}
              </p>
            </div>

            <div className="rounded-xl bg-muted p-3 text-[14px]">
              <Row label={t("common.amount")} value={formatNPR(amt)} />
              <Row label={t("common.charge")} value={formatNPR(charge)} />
              <Row label={t("common.cashback")} value={`− ${formatNPR(cashback)}`} />
              <div className="mt-2 border-t border-separator pt-2">
                <Row label={t("common.totalDebited")} value={formatNPR(totalDebited)} strong />
              </div>
            </div>

            <Button
              type="submit"
              disabled={
                submitMutation.isPending ||
                !topupsEnabled ||
                !mobileReady ||
                amt < minTopup ||
                providerBlocked
              }
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {submitMutation.isPending ? t("common.processing") : t("topup.confirm")}
            </Button>
          </form>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[17px] font-semibold">{t("topup.recent")}</h2>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !historyQuery.data?.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("topup.empty")}
            </div>
          ) : (
            <ul className="inset-group divide-y divide-border">
              {historyQuery.data.map((item) => (
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
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {t("topup.chargeLine", {
                      charge: formatNPR(item.charge),
                      cashback: formatNPR(item.cashback),
                      debited: formatNPR(item.total_debited),
                    })}
                  </p>
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
