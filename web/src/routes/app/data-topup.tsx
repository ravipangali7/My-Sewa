import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Info, Search, Signal } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { DataPackCard } from "@/components/data-packs/DataPackCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toastApiError } from "@/lib/api-errors";
import { apiClient, ApiError } from "@/lib/api";
import {
  OPERATORS,
  normalizeNepalMobile,
  validateOperatorMobile,
} from "@/lib/constants";
import {
  getCategoriesForOperator,
  matchesCategory,
  operatorDisplayName,
  operatorTheme,
  type DataPackOperator,
  type PackCategory,
} from "@/lib/data-packs";
import { formatNPR, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { isAccountPending } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { useI18n } from "@/lib/i18n";
import { ListPageToolbar, ReceiptDownloadLink, TransactionResultBanner } from "@/components/list/ListPageToolbar";
import { useListFilters, TXN_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { activityIdForKind, useReceiptDownload } from "@/lib/receipt-download";
import { useSiteBranding } from "@/hooks/use-site-branding";
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

function DataTopUp() {
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
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);
  const accountPending = isAccountPending(user);

  const [step, setStep] = useState<Step>("operator");
  const [operator, setOperator] = useState<DataPackOperator>("NTC");
  const [activeCategory, setActiveCategory] = useState<PackCategory>("ALL");
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
    queryKey: ["data-packs", debounced],
    queryFn: () => apiClient.dataPackHistory(debounced),
    refetchInterval: LIVE_REFETCH_MS,
  });
  const dataPackItems = historyQuery.data?.items ?? [];
  const dataPackStats = historyQuery.data?.stats;

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
    mutationFn: async (op: DataPackOperator) => {
      if (accountPending) throw new Error(t("account.pending"));
      if (!enabled) throw new Error(t("dataTopup.disabledError"));
      return apiClient.dataPackInquiry({ operator: op });
    },
    onSuccess: (res, op) => {
      setOperator(op);
      setActiveCategory("ALL");
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
      setLastReceiptId(activityIdForKind("data_pack", res.data.id));
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
    setActiveCategory("ALL");
    setMobile("");
    setTouchedMobile(false);
    setPackages([]);
    setSelectedPackage(null);
  };

  const theme = operatorTheme(operator);
  const categories = getCategoriesForOperator(operator);
  const filteredPackages = useMemo(
    () => packages.filter((pkg) => matchesCategory(pkg, activeCategory)),
    [packages, activeCategory],
  );

  const selectPackage = (pkg: DataPackOption) => {
    setSelectedPackage(pkg);
    setStep("mobile");
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
  const packHeaderTitle = `${operatorDisplayName(operator)} Packs`;

  const myPhone = normalizeNepalMobile(user?.phone || "").slice(-10);

  return (
    <UserShell title={step === "packages" ? packHeaderTitle : t("dataTopup.title")} back="/app">
      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
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

        <section className={cn("min-w-0", "inset-group", step === "packages" ? "overflow-hidden p-0" : "p-4")}>
          {step !== "packages" ? (
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
          ) : null}

          {step === "operator" ? (
            <div className="space-y-4">
              <p className="text-[13px] text-muted-foreground">{t("dataTopup.operatorHelp")}</p>
              <p className="text-[12px] text-muted-foreground">{t("dataTopup.livePackagesHint")}</p>
              <div className="grid grid-cols-2 gap-3">
                {(["NTC", "NCELL"] as const).map((op) => {
                  const opTheme = operatorTheme(op);
                  const isLoading = packagesMutation.isPending && operator === op;
                  return (
                    <button
                      key={op}
                      type="button"
                      disabled={!enabled || packagesMutation.isPending}
                      onClick={() => packagesMutation.mutate(op)}
                      className={cn(
                        "overflow-hidden rounded-2xl border text-left shadow-card transition-transform active:scale-[0.98]",
                        operator === op ? "border-brand/30" : "border-border",
                      )}
                    >
                      <div className={cn("px-3 py-2.5 text-center text-[14px] font-bold text-white", opTheme.header)}>
                        {operatorDisplayName(op)} Packs
                      </div>
                      <div className="flex items-center justify-center gap-2 bg-surface px-3 py-4">
                        <Signal className="size-4 text-muted-foreground" />
                        <span className="text-[15px] font-semibold">{OPERATORS[op === "NTC" ? 1 : 2]}</span>
                      </div>
                      {isLoading ? (
                        <p className="border-t border-border bg-muted/40 px-3 py-2 text-center text-[12px] text-muted-foreground">
                          {t("dataTopup.fetchingPackages")}
                        </p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === "packages" ? (
            <div className="overflow-hidden">
              <div
                className={cn(
                  "flex items-center justify-between px-4 py-3 text-white",
                  theme.header,
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 text-white hover:bg-white/15"
                  onClick={goBack}
                >
                  <ArrowLeft className="size-5" />
                </Button>
                <h3 className="text-[16px] font-semibold">
                  {packHeaderTitle}
                </h3>
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15"
                  title={t("dataTopup.livePackagesHint")}
                >
                  <Info className="size-4" />
                </span>
              </div>

              <div className="bg-surface px-3 pb-3 pt-3">
                <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex w-max min-w-full gap-1 rounded-full bg-muted p-1">
                    {categories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActiveCategory(category)}
                        className={cn(
                          "shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide transition-colors",
                          activeCategory === category
                            ? theme.tabActive
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t(`dataTopup.category.${category}` as `dataTopup.category.${PackCategory}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="mt-2 px-1 text-[12px] text-muted-foreground">
                  {t("dataTopup.livePackagesHint")} · {packages.length}{" "}
                  {packages.length === 1 ? "package" : "packages"}
                </p>

                <ul className="mt-3 max-h-[65dvh] space-y-3 overflow-y-auto pr-0.5 lg:max-h-[520px]">
                  {filteredPackages.map((pkg) => (
                    <li key={pkg.id}>
                      <DataPackCard pkg={pkg} operator={operator} onBuy={selectPackage} />
                    </li>
                  ))}
                </ul>

                {!filteredPackages.length ? (
                  <div className="rounded-xl bg-muted/60 px-4 py-8 text-center text-[14px] text-muted-foreground">
                    {t("dataTopup.noPackagesInCategory")}
                  </div>
                ) : null}
              </div>
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

        <section className="min-w-0">
          {lastReceiptId ? (
            <div className="mb-3">
              <TransactionResultBanner
                tone={
                  dataPackItems.find(
                    (x) => activityIdForKind("data_pack", x.id) === lastReceiptId,
                  )?.status === "failed"
                    ? "danger"
                    : dataPackItems.find(
                          (x) => activityIdForKind("data_pack", x.id) === lastReceiptId,
                        )?.status === "pending"
                      ? "warning"
                      : "success"
                }
                title={t("dataTopup.success")}
                body={t("history.downloadStatement")}
                receiptLabel={t("history.downloadPdf")}
                onDownloadReceipt={() => void downloadReceipt(lastReceiptId)}
                downloading={receiptDownloading}
              />
            </div>
          ) : null}
          <div className="hidden lg:block">
            <ListPageToolbar
              stats={dataPackStats}
              filters={filters}
              onFiltersChange={setFilters}
              onExport={async () => {
                setExporting(true);
                try {
                  await downloadCsvExport("/api/data-pack/history/", debounced, "data-packs.csv");
                } finally {
                  setExporting(false);
                }
              }}
              exporting={exporting}
              searchPlaceholder="Search"
              exportLabel={t("list.exportCsv")}
              statsLabels={{
                total: t("list.statsTotal"),
                success: t("list.statsSuccess"),
                pending: t("list.statsPending"),
                failed: t("list.statsFailed"),
              }}
              statusOptions={[...TXN_STATUS_OPTIONS]}
            />
          </div>
          <div className="mb-2 mt-4 flex items-center justify-between gap-2 px-1">
            <h2 className="text-[17px] font-semibold">{t("dataTopup.recent")}</h2>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 rounded-full lg:hidden"
              onClick={() => setMobileSearchOpen(true)}
              aria-label="Open search"
            >
              <Search className="size-4" />
            </Button>
          </div>
          <div className="mb-3 rounded-xl border border-border/70 bg-background/95 p-2 lg:hidden">
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium">
                {t("list.statsTotal")}: {dataPackStats?.total ?? 0}
              </span>
              <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium">
                {t("list.statsSuccess")}: {dataPackStats?.success ?? 0}
              </span>
              <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium">
                {t("list.statsPending")}: {dataPackStats?.pending ?? 0}
              </span>
              <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium">
                {t("list.statsFailed")}: {dataPackStats?.failed ?? 0}
              </span>
            </div>
          </div>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !dataPackItems.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("dataTopup.empty")}
            </div>
          ) : (
            <ul className="inset-group min-w-0 divide-y divide-border overflow-hidden">
              {dataPackItems.map((item: DataPackTransaction) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        {item.operator} Data · {item.mobile_number}
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
                          void downloadReceipt(activityIdForKind("data_pack", item.id))
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
      <Sheet open={mobileSearchOpen} onOpenChange={setMobileSearchOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-5">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>Search</SheetTitle>
          </SheetHeader>
          <ListPageToolbar
            stats={dataPackStats}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={async () => {
              setExporting(true);
              try {
                await downloadCsvExport("/api/data-pack/history/", debounced, "data-packs.csv");
              } finally {
                setExporting(false);
              }
            }}
            exporting={exporting}
            searchPlaceholder="Search"
            exportLabel={t("list.exportCsv")}
            statsLabels={{
              total: t("list.statsTotal"),
              success: t("list.statsSuccess"),
              pending: t("list.statsPending"),
              failed: t("list.statsFailed"),
            }}
            statusOptions={[...TXN_STATUS_OPTIONS]}
          />
        </SheetContent>
      </Sheet>
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
