import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { DepositAccountsPanel } from "@/components/DepositAccountsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDateTime, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { isAccountPending } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { useI18n } from "@/lib/i18n";
import type { TranslateFn } from "@/lib/i18n";
import { ListPageToolbar, ReceiptDownloadLink, TransactionResultBanner } from "@/components/list/ListPageToolbar";
import { useListFilters, DEPOSIT_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { activityIdForKind, useReceiptDownload } from "@/lib/receipt-download";
import { useSiteBranding } from "@/hooks/use-site-branding";
import type { PaymentMethod } from "@/lib/types";

const DEPOSIT_PAYMENT_METHODS: PaymentMethod[] = ["bank", "khalti", "esewa"];

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

export const Route = createFileRoute("/app/load")({
  head: () => ({
    meta: [
      { title: "Manual Wallet Load — MySewa" },
      {
        name: "description",
        content:
          "Fund your MySewa wallet: transfer to the deposit account, then submit transaction details with payment screenshot.",
      },
      { property: "og:title", content: "Manual Wallet Load — MySewa" },
      {
        property: "og:description",
        content: "Submit a manual wallet load request with proof and track approval status.",
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
  const { user } = useAuth();
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
  const [transactionId, setTransactionId] = useState("");
  const [amount, setAmount] = useState("");
  const [depositDate, setDepositDate] = useState(todayIsoDate);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [bankName, setBankName] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });

  const depositsQuery = useQuery({
    queryKey: ["deposits", debounced],
    queryFn: () => apiClient.listDeposits(debounced),
    refetchInterval: LIVE_REFETCH_MS,
  });
  const depositItems = depositsQuery.data?.items ?? [];
  const depositStats = depositsQuery.data?.stats;

  const payment = settingsQuery.data?.config?.payment;
  const security = settingsQuery.data?.config?.security;
  const depositsEnabled = payment?.deposits_enabled !== false && !accountPending;
  const requireScreenshot = security?.require_deposit_screenshot !== false;
  const minDeposit = payment?.min_deposit ?? 100;
  const maxDeposit = payment?.max_deposit ?? 100000;
  const instructions = payment?.deposit_instructions?.trim() || "";

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
      if (note.trim()) fd.append("note", note.trim());
      if (file) fd.append("screenshot_proof", file);
      return apiClient.createDeposit(fd);
    },
    onSuccess: (res) => {
      const approved = res.data?.status === "approved";
      toast.success(t("load.submitted"), {
        description: approved ? t("load.autoApproved") : t("load.pendingApproval"),
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

  return (
    <UserShell
      title={t("load.title")}
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
      <div className="grid min-w-0 max-w-full gap-5 overflow-x-clip lg:grid-cols-2">
        {accountPending ? (
          <div className="lg:col-span-2">
            <AccountPendingBanner />
          </div>
        ) : null}
        {!depositsEnabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4 lg:col-span-2">
            <p className="text-[15px] font-medium text-destructive">{t("load.disabledTitle")}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t("load.disabledBody")}</p>
          </section>
        ) : null}

        {depositsEnabled ? (
          <>
            <DepositAccountsPanel
              bankDetails={settingsQuery.data?.bank_details ?? null}
              loading={settingsQuery.isLoading}
              qrOptions={[
                {
                  id: "bank",
                  url: settingsQuery.data?.qr_code_url ?? "",
                  label: t("load.qrBank"),
                  alt: t("load.qrBankAlt"),
                },
                {
                  id: "khalti",
                  url: settingsQuery.data?.khalti_qr_code_url ?? "",
                  label: t("load.qrKhalti"),
                  alt: t("load.qrKhaltiAlt"),
                },
                {
                  id: "esewa",
                  url: settingsQuery.data?.esewa_qr_code_url ?? "",
                  label: t("load.qrEsewa"),
                  alt: t("load.qrEsewaAlt"),
                },
              ]}
              instructions={instructions}
              title={t("load.depositAccount")}
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
                    {t("load.paymentMethodHint")}
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
                  disabled={createMutation.isPending}
                  className="h-12 w-full rounded-xl text-[17px]"
                >
                  {createMutation.isPending ? t("common.submitting") : t("load.submit")}
                </Button>
              </form>
            </section>
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
                        {d.transaction_id
                          ? `${t("common.txnId")}: ${d.transaction_id}`
                          : t("common.noNote")}
                        {d.deposit_date ? ` · ${formatDate(d.deposit_date)}` : ""}
                        {" · "}
                        {formatDateTime(d.created_at)}
                      </p>
                      {d.status === "rejected" && d.rejection_reason ? (
                        <p className="mt-0.5 break-words text-[13px] text-destructive">
                          {t("common.reason", { reason: d.rejection_reason })}
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
