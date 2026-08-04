import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Signal } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastApiError } from "@/lib/api-errors";
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
import type { DataPackOption, DataPackTransaction } from "@/lib/types";

export const Route = createFileRoute("/app/data-topup")({
  head: () => ({
    meta: [
      { title: "Data Top-Up NTC & NCELL — MySewa" },
      {
        name: "description",
        content: "Buy NTC or NCELL mobile data packs from your MySewa wallet balance.",
      },
    ],
  }),
  component: DataTopUp,
});

type Step = "operator" | "packages" | "mobile" | "pay";
type Operator = "NTC" | "NCELL";

function DataTopUp() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { t } = useI18n();
  const accountPending = isAccountPending(user);

  const [step, setStep] = useState<Step>("operator");
  const [operator, setOperator] = useState<Operator>("NTC");
  const [mobile, setMobile] = useState("");
  const [touchedMobile, setTouchedMobile] = useState(false);
  const [packages, setPackages] = useState<DataPackOption[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<DataPackOption | null>(null);
  const [charge, setCharge] = useState("0.00");
  const [providerCharge, setProviderCharge] = useState("0.00");
  const [cashback, setCashback] = useState("0.00");
  const [platformCharge, setPlatformCharge] = useState("0.00");
  const [totalDebited, setTotalDebited] = useState("0.00");
  const [feeLoading, setFeeLoading] = useState(false);

  const productId = operator === "NTC" ? 1 : 2;

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });
  const enabled =
    settingsQuery.data?.config?.payment?.data_packs_enabled !== false && !accountPending;

  const walletQuery = useQuery({
    queryKey: ["wallet", "balance"],
    queryFn: () => apiClient.walletBalance(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const historyQuery = useQuery({
    queryKey: ["data-packs"],
    queryFn: () => apiClient.dataPackHistory(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const mobileError = useMemo(
    () => validateOperatorMobile(productId, mobile),
    [productId, mobile],
  );
  const showMobileError = touchedMobile && mobileError !== null;
  const normalizedMobile = normalizeNepalMobile(mobile).slice(-10);
  const mobileReady = normalizedMobile.length === 10 && mobileError === null;

  const walletBalance = Number(walletQuery.data?.balance ?? 0);
  const pkgAmount = Number(selectedPackage?.amount ?? 0);
  const totalDue = Number(totalDebited) || pkgAmount;
  const insufficient = pkgAmount > 0 && totalDue > 0 && walletBalance < totalDue;

  const payService = operator === "NTC" ? "NTC_DATA_PACK_PAY" : "NCELL_DATA_PACK_PAY";

  useEffect(() => {
    if (!selectedPackage || pkgAmount <= 0 || !enabled) {
      setCharge("0.00");
      setProviderCharge("0.00");
      setCashback("0.00");
      setPlatformCharge("0.00");
      setTotalDebited("0.00");
      return;
    }
    let cancelled = false;
    setFeeLoading(true);
    const timer = setTimeout(() => {
      apiClient
        .calculateCharge(payService, pkgAmount)
        .then((res) => {
          if (cancelled) return;
          setCharge(String(res.charge));
          setProviderCharge(String(res.provider_charge ?? res.charge));
          setCashback(String(res.cashback));
          setPlatformCharge(String(res.platform_charge ?? "0.00"));
          setTotalDebited(String(res.total_debited));
        })
        .catch(() => {
          if (!cancelled) {
            setCharge("0.00");
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
  }, [selectedPackage, pkgAmount, payService, enabled]);

  const packagesMutation = useMutation({
    mutationFn: async (op: Operator) => {
      if (accountPending) throw new Error(t("account.pending"));
      if (!enabled) throw new Error(t("dataTopup.disabledError"));
      return apiClient.dataPackInquiry({ operator: op });
    },
    onSuccess: (res, op) => {
      setOperator(op);
      setPackages(res.data.packages);
      setStep("packages");
    },
    onError: (err) => {
      toastApiError(err, {
        title: t("dataTopup.packagesFailed"),
        fallback: t("dataTopup.packagesFailed"),
      });
    },
  });

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPackage) throw new Error(t("dataTopup.selectPackage"));
      if (accountPending) throw new Error(t("account.pending"));
      if (!enabled) throw new Error(t("dataTopup.disabledError"));
      if (insufficient) {
        throw new Error(
          t("topup.insufficient", {
            required: formatNPR(totalDue),
            available: formatNPR(walletBalance),
          }),
        );
      }
      return apiClient.dataPackPay({
        operator,
        mobile_number: normalizedMobile,
        amount: Number(Number(selectedPackage.amount).toFixed(2)),
        package_name: selectedPackage.name,
        package_id: selectedPackage.package_id,
        product_code: selectedPackage.product_code,
      });
    },
    onSuccess: (res) => {
      const isPending = res.data.status === "pending";
      if (isPending) {
        toast.message(res.message || t("dataTopup.pendingTitle"), {
          description: res.pending_message || t("topup.pendingBody"),
        });
      } else {
        toast.success(res.message || t("dataTopup.success"), {
          description: t("transfer.debited", {
            amount: formatNPR(res.data.total_debited || totalDebited),
          }),
        });
      }
      resetFlow();
      queryClient.invalidateQueries({ queryKey: ["data-packs"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] });
    },
    onError: (err) => {
      toastApiError(err, { title: t("dataTopup.failed"), fallback: t("dataTopup.failed") });
    },
  });

  const resetFlow = () => {
    setStep("operator");
    setOperator("NTC");
    setMobile("");
    setTouchedMobile(false);
    setPackages([]);
    setSelectedPackage(null);
  };

  const goBack = () => {
    if (step === "pay") setStep("mobile");
    else if (step === "mobile") setStep("packages");
    else if (step === "packages") setStep("operator");
  };

  const stepTitle = useMemo(() => {
    if (step === "operator") return t("dataTopup.stepOperator");
    if (step === "packages") return t("dataTopup.stepPackages");
    if (step === "mobile") return t("dataTopup.stepMobile");
    return t("dataTopup.stepPay");
  }, [step, t]);

  const myPhone = normalizeNepalMobile(user?.phone || "").slice(-10);

  return (
    <UserShell title={t("dataTopup.title")} back="/app">
      <div className="grid gap-5 lg:grid-cols-2">
        {accountPending ? (
          <div className="lg:col-span-2">
            <AccountPendingBanner />
          </div>
        ) : null}
        {!enabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4 lg:col-span-2">
            <p className="text-[15px] font-medium text-destructive">{t("dataTopup.disabledTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("dataTopup.disabledBody")}</p>
          </section>
        ) : null}

        <section className="inset-group p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{stepTitle}</h2>
            {step !== "operator" ? (
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

          {step === "operator" ? (
            <div className="space-y-4">
              <p className="text-[13px] text-muted-foreground">{t("dataTopup.operatorHelp")}</p>
              <p className="text-[12px] text-muted-foreground">{t("dataTopup.livePackagesHint")}</p>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
                {(["NTC", "NCELL"] as const).map((op) => (
                  <button
                    key={op}
                    type="button"
                    disabled={!enabled || packagesMutation.isPending}
                    onClick={() => packagesMutation.mutate(op)}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-lg py-3 text-[15px] font-medium transition-colors",
                      operator === op
                        ? "bg-surface text-brand-dark shadow-card"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Signal className="size-4" />
                    {OPERATORS[op === "NTC" ? 1 : 2]}
                  </button>
                ))}
              </div>
              {packagesMutation.isPending ? (
                <p className="text-center text-[13px] text-muted-foreground">
                  {t("dataTopup.fetchingPackages")}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === "packages" ? (
            <div className="space-y-3">
              <p className="rounded-xl bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground">
                {operator} · {t("dataTopup.livePackagesHint")}
              </p>
              <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {packages.map((pkg) => (
                  <li key={pkg.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPackage(pkg);
                        setStep("mobile");
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold">{pkg.name}</p>
                        <p className="text-[12px] text-muted-foreground">
                          {[pkg.volume, pkg.validity].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <p className="tabular text-[16px] font-bold text-brand-dark">
                        {formatNPR(pkg.amount)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {step === "mobile" && selectedPackage ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setTouchedMobile(true);
                if (!mobileReady) return;
                setStep("pay");
              }}
            >
              <div className="rounded-xl border border-brand/15 bg-brand/5 p-3">
                <p className="text-[13px] text-muted-foreground">{operator}</p>
                <p className="text-[15px] font-semibold">{selectedPackage.name}</p>
                <p className="tabular text-[18px] font-bold">{formatNPR(selectedPackage.amount)}</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="data_mobile">{t("topup.mobileLabel")}</Label>
                  {myPhone.length === 10 ? (
                    <button
                      type="button"
                      disabled={!enabled}
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
                  id="data_mobile"
                  inputMode="tel"
                  placeholder={operator === "NTC" ? "984XXXXXXX" : "980XXXXXXX"}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  onBlur={() => setTouchedMobile(true)}
                  aria-invalid={showMobileError}
                  className={cn(
                    "h-12 rounded-xl",
                    showMobileError && "border-destructive focus-visible:ring-destructive/40",
                  )}
                  required
                  disabled={!enabled}
                />
                {showMobileError ? (
                  <p className="text-[13px] font-medium text-destructive" role="alert">
                    {t("topup.invalidNumber")}
                  </p>
                ) : (
                  <p className="text-[12px] text-muted-foreground">{t("dataTopup.mobileHelp")}</p>
                )}
              </div>
              <Button
                type="submit"
                disabled={!enabled || !mobileReady}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                {t("common.continue")}
              </Button>
            </form>
          ) : null}

          {step === "pay" && selectedPackage ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand/20 bg-brand/5 p-3">
                <p className="text-[13px] text-muted-foreground">
                  {operator} · {normalizedMobile}
                </p>
                <p className="mt-1 text-[16px] font-semibold">{selectedPackage.name}</p>
                {selectedPackage.volume ? (
                  <p className="text-[13px] text-muted-foreground">{selectedPackage.volume}</p>
                ) : null}
                <p className="mt-2 tabular text-[28px] font-bold">
                  {formatNPR(selectedPackage.amount)}
                </p>
              </div>

              <div className="rounded-xl bg-muted px-3 py-2.5">
                <p className="text-[12px] text-muted-foreground">{t("topup.walletLabel")}</p>
                <p className="tabular text-[17px] font-semibold">
                  {walletQuery.isLoading ? "…" : formatNPR(walletBalance)}
                </p>
                {insufficient ? (
                  <Link
                    to="/app/load"
                    className="mt-1 inline-block text-[13px] font-medium text-brand underline-offset-2 hover:underline"
                  >
                    {t("topup.loadWallet")}
                  </Link>
                ) : null}
              </div>

              <div className="rounded-xl bg-muted p-3 text-[14px]">
                <FeeRow label={t("common.amount")} value={formatNPR(pkgAmount)} />
                <FeeRow
                  label={t("topup.providerCharge")}
                  value={feeLoading ? "…" : formatNPR(providerCharge)}
                />
                {Number(platformCharge) > 0 ? (
                  <FeeRow
                    label={t("topup.platformCharge")}
                    value={feeLoading ? "…" : formatNPR(platformCharge)}
                  />
                ) : null}
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
              </div>

              <Button
                type="button"
                disabled={payMutation.isPending || feeLoading || insufficient || !enabled}
                className="h-12 w-full rounded-xl text-[17px]"
                onClick={() => payMutation.mutate()}
              >
                <Check className="mr-2 size-4" />
                {payMutation.isPending
                  ? t("common.processing")
                  : t("dataTopup.confirm", { amount: formatNPR(totalDebited || pkgAmount) })}
              </Button>
            </div>
          ) : null}
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[17px] font-semibold">{t("dataTopup.recent")}</h2>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !historyQuery.data?.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("dataTopup.empty")}
            </div>
          ) : (
            <ul className="inset-group divide-y divide-border">
              {historyQuery.data.map((item: DataPackTransaction) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium">
                        {item.operator} Data · {item.mobile_number}
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {item.package_name || item.merchant_txn_id} · {formatDateTime(item.created_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-[15px] font-semibold">{formatNPR(item.amount)}</p>
                      <StatusChip status={item.status} compact className="mt-1" />
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

function FeeRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular", strong ? "font-semibold" : "font-medium")}>{value}</span>
    </div>
  );
}
