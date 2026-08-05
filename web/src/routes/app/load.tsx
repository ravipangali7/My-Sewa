import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Upload, QrCode } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { isAccountPending } from "@/lib/account-status";
import { AccountPendingBanner } from "@/components/AccountPendingBanner";
import { useI18n } from "@/lib/i18n";
import { ListPageToolbar, ReceiptDownloadLink, TransactionResultBanner } from "@/components/list/ListPageToolbar";
import { useListFilters, DEPOSIT_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";
import { activityIdForKind, useReceiptDownload } from "@/lib/receipt-download";
import { useSiteBranding } from "@/hooks/use-site-branding";

export const Route = createFileRoute("/app/load")({
  head: () => ({
    meta: [
      { title: "Load Wallet — MySewa Remittance Deposit" },
      {
        name: "description",
        content:
          "Fund your MySewa wallet: scan the company QR or transfer to the bank account, then submit your deposit with screenshot proof.",
      },
      { property: "og:title", content: "Load Wallet — MySewa" },
      {
        property: "og:description",
        content: "Submit a remittance deposit with proof and track approval status.",
      },
    ],
  }),
  component: LoadWallet,
});

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
  const [exporting, setExporting] = useState(false);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);
  const accountPending = isAccountPending(user);
  const [amount, setAmount] = useState("");
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

  const createMutation = useMutation({
    mutationFn: async () => {
      if (accountPending) throw new Error(t("account.pending"));
      if (!depositsEnabled) throw new Error(t("load.disabledError"));
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error(t("load.validAmount"));
      if (amt < minDeposit) throw new Error(t("load.minError", { min: minDeposit }));
      if (maxDeposit > 0 && amt > maxDeposit)
        throw new Error(t("load.maxError", { max: maxDeposit }));
      if (requireScreenshot && !file) throw new Error(t("load.screenshotRequired"));
      const fd = new FormData();
      fd.append("amount", amount);
      if (note.trim()) fd.append("note", note.trim());
      if (file) fd.append("screenshot_proof", file);
      return apiClient.createDeposit(fd);
    },
    onSuccess: (res) => {
      toast.success(t("load.submitted"), { description: t("load.pendingApproval") });
      setAmount("");
      setNote("");
      setFile(null);
      setLastReceiptId(activityIdForKind("deposit", res.data.id));
      queryClient.invalidateQueries({ queryKey: ["deposits"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError || err instanceof Error ? err.message : t("load.submitFailed"),
      );
    },
  });

  const bank = settingsQuery.data?.bank_details ?? {};
  const bankEntries = Object.entries(bank).filter(([, v]) => v);

  return (
    <UserShell title={t("load.title")} back="/app">
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

        <section className="inset-group min-w-0 max-w-full p-4">
          <h2 className="text-[15px] font-semibold">{t("load.payTo")}</h2>
          {instructions ? (
            <p className="mt-2 break-words text-[13px] text-muted-foreground whitespace-pre-wrap">{instructions}</p>
          ) : null}
          <div className="mt-3 flex min-w-0 gap-4">
            <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-separator bg-muted text-muted-foreground">
              {settingsQuery.data?.qr_code_url ? (
                <img
                  src={settingsQuery.data.qr_code_url}
                  alt={t("load.qrAlt")}
                  className="size-full object-contain"
                />
              ) : (
                <QrCode className="size-12" />
              )}
            </div>
            <dl className="min-w-0 flex-1 space-y-1.5 text-[14px]">
              {settingsQuery.isLoading ? (
                <p className="text-muted-foreground">{t("load.loadingBank")}</p>
              ) : bankEntries.length === 0 ? (
                <p className="text-muted-foreground">{t("load.bankNotConfigured")}</p>
              ) : (
                bankEntries.map(([k, v]) => (
                  <div key={k} className="flex min-w-0 justify-between gap-3">
                    <dt className="shrink-0 text-muted-foreground capitalize">{k.replace(/_/g, " ")}</dt>
                    <dd className="min-w-0 break-all text-right font-medium">{v}</dd>
                  </div>
                ))
              )}
            </dl>
          </div>
        </section>

        <section className="inset-group min-w-0 max-w-full p-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="amount">{t("common.amountNpr")}</Label>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder={t("common.amountPlaceholder")}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular h-12 rounded-xl text-[22px] font-semibold"
                required
                disabled={!depositsEnabled}
              />
              <p className="text-[12px] text-muted-foreground">
                {t("common.minMax", { min: minDeposit, max: maxDeposit })}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">{t("load.noteOptional")}</Label>
              <Textarea
                id="note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="rounded-xl"
                placeholder={t("load.notePlaceholder")}
                disabled={!depositsEnabled}
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
                  disabled={!depositsEnabled}
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
                  disabled={!depositsEnabled}
                />
              </div>
            )}
            <Button
              type="submit"
              disabled={createMutation.isPending || !depositsEnabled}
              className="h-12 w-full rounded-xl text-[17px]"
            >
              {createMutation.isPending ? t("common.submitting") : t("load.submit")}
            </Button>
          </form>
        </section>

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
            searchPlaceholder="Search"
            exportLabel={t("list.exportCsv")}
            statsLabels={{
              total: t("list.statsTotal"),
              success: t("list.statsSuccess"),
              pending: t("list.statsPending"),
              failed: t("list.statsFailed"),
            }}
            statusOptions={[...DEPOSIT_STATUS_OPTIONS]}
          />
          <h2 className="mb-2 mt-4 px-1 text-[17px] font-semibold">{t("load.myDeposits")}</h2>
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
                        {d.note ?? t("common.noNote")} · {formatDateTime(d.created_at)}
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
    </UserShell>
  );
}
