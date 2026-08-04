import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";
import { BsDatePicker } from "@/components/BsDatePicker";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastApiError } from "@/lib/api-errors";
import { apiClient } from "@/lib/api";
import { formatNPR, formatDateTime } from "@/lib/format";
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
import type { RemittanceLookup } from "@/lib/types";

export const Route = createFileRoute("/app/remittance")({
  head: () => ({
    meta: [
      { title: "Receive Remittance — MySewa" },
      {
        name: "description",
        content:
          "Look up a Samsara remittance by reference number and credit the payout into your MySewa wallet.",
      },
      { property: "og:title", content: "Receive Remittance — MySewa" },
      {
        property: "og:description",
        content: "Receive HimalPay Samsara remittance into your wallet.",
      },
    ],
  }),
  component: ReceiveRemittance,
});

const PURPOSES = [
  "FAMILY_SUPPORT",
  "EDUCATION",
  "MEDICAL",
  "SAVINGS",
  "BUSINESS",
  "OTHER",
] as const;

const RELATIONS = ["SELF", "SPOUSE", "PARENT", "CHILD", "SIBLING", "OTHER"] as const;
const OCCUPATIONS = [
  "STUDENT",
  "EMPLOYED",
  "SELF_EMPLOYED",
  "BUSINESS",
  "HOUSEWIFE",
  "RETIRED",
  "OTHER",
] as const;
const GENDERS = ["Male", "Female", "Other"] as const;
const ID_TYPES = ["Citizenship", "Passport", "Driving License", "National ID"] as const;

type Step = "lookup" | "details" | "kyc";

type KycForm = {
  beneficiary_gender: string;
  beneficiary_nationality: string;
  beneficiary_state: string;
  beneficiary_district: string;
  beneficiary_municipality: string;
  beneficiary_ward_number: string;
  beneficiary_city: string;
  beneficiary_address: string;
  beneficiary_relation: string;
  beneficiary_occupation: string;
  beneficiary_citizenship_number: string;
  beneficiary_citizenship_issuing_district: string;
  beneficiary_id_type: string;
  beneficiary_id_number: string;
  beneficiary_id_issue_date: string;
  beneficiary_id_issue_by: string;
  beneficiary_mobile_no: string;
  beneficiary_dob: string;
  remittance_purpose: string;
};

const emptyKyc = (phone = ""): KycForm => ({
  beneficiary_gender: "Male",
  beneficiary_nationality: "Nepali",
  beneficiary_state: "Bagmati",
  beneficiary_district: "Kathmandu",
  beneficiary_municipality: "Kathmandu Metropolitan City",
  beneficiary_ward_number: "10",
  beneficiary_city: "Kathmandu",
  beneficiary_address: "",
  beneficiary_relation: "SELF",
  beneficiary_occupation: "EMPLOYED",
  beneficiary_citizenship_number: "",
  beneficiary_citizenship_issuing_district: "Kathmandu",
  beneficiary_id_type: "Citizenship",
  beneficiary_id_number: "",
  beneficiary_id_issue_date: "",
  beneficiary_id_issue_by: "Kathmandu",
  beneficiary_mobile_no: phone,
  beneficiary_dob: "",
  remittance_purpose: "FAMILY_SUPPORT",
});

function ReceiveRemittance() {
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

  const [step, setStep] = useState<Step>("lookup");
  const [refNo, setRefNo] = useState("");
  const [lookup, setLookup] = useState<RemittanceLookup | null>(null);
  const [kyc, setKyc] = useState<KycForm>(() => emptyKyc(user?.phone ?? ""));

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
  });
  const remittancesEnabled =
    settingsQuery.data?.config?.payment?.remittances_enabled !== false && !accountPending;

  const historyQuery = useQuery({
    queryKey: ["remittances", debounced],
    queryFn: () => apiClient.remittanceHistory(debounced),
    refetchInterval: LIVE_REFETCH_MS,
  });
  const remittanceItems = historyQuery.data?.items ?? [];
  const remittanceStats = historyQuery.data?.stats;

  const setField = <K extends keyof KycForm>(key: K, value: KycForm[K]) => {
    setKyc((prev) => ({ ...prev, [key]: value }));
  };

  const lookupMutation = useMutation({
    mutationFn: async () => {
      if (accountPending) throw new Error(t("account.pending"));
      if (!remittancesEnabled) throw new Error(t("remittance.disabledError"));
      const cleaned = refNo.trim();
      if (!cleaned) throw new Error(t("remittance.refRequired"));
      return apiClient.lookupRemittance({ ref_no: cleaned });
    },
    onSuccess: (res) => {
      setLookup(res.data);
      setKyc((prev) => ({
        ...prev,
        beneficiary_mobile_no:
          prev.beneficiary_mobile_no ||
          res.data.receiver_phone?.replace(/^\+?977/, "") ||
          user?.phone ||
          "",
        beneficiary_address:
          prev.beneficiary_address || res.data.receiver_address || prev.beneficiary_address,
        beneficiary_city: prev.beneficiary_city || res.data.receiver_city || prev.beneficiary_city,
      }));
      setStep("details");
      toast.success(t("remittance.lookupSuccess"));
    },
    onError: (err) => {
      toastApiError(err, { title: t("remittance.lookupFailed"), fallback: t("remittance.lookupFailed") });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!lookup) throw new Error(t("remittance.lookupFirst"));
      if (accountPending) throw new Error(t("account.pending"));
      if (!remittancesEnabled) throw new Error(t("remittance.disabledError"));

      const required: Array<[keyof KycForm, string]> = [
        ["beneficiary_gender", t("remittance.gender")],
        ["beneficiary_state", t("remittance.state")],
        ["beneficiary_district", t("remittance.district")],
        ["beneficiary_municipality", t("remittance.municipality")],
        ["beneficiary_ward_number", t("remittance.ward")],
        ["beneficiary_address", t("remittance.address")],
        ["beneficiary_occupation", t("remittance.occupation")],
        ["beneficiary_citizenship_number", t("remittance.citizenshipNo")],
        ["beneficiary_citizenship_issuing_district", t("remittance.citizenshipDistrict")],
        ["beneficiary_id_number", t("remittance.idNumber")],
        ["beneficiary_id_issue_date", t("remittance.idIssueDate")],
        ["beneficiary_id_issue_by", t("remittance.idIssueBy")],
        ["beneficiary_mobile_no", t("remittance.mobile")],
        ["beneficiary_dob", t("remittance.dob")],
      ];
      for (const [key, label] of required) {
        if (!String(kyc[key] || "").trim()) {
          throw new Error(t("remittance.fieldRequired", { field: label }));
        }
      }

      return apiClient.receiveRemittance({
        ref_no: lookup.ref_no,
        samsara_link_id: lookup.samsara_link_id,
        // Rupees; server converts to paisa (×100) for HimalPay SAMSARA_PAY load.
        amount: Number(Number(lookup.amount).toFixed(2)),
        payout_currency: lookup.payout_currency,
        sender_name: lookup.sender_name,
        sender_address: lookup.sender_address,
        sender_city: lookup.sender_city,
        sender_country: lookup.sender_country,
        receiver_name: lookup.receiver_name,
        receiver_phone: lookup.receiver_phone,
        receiver_country: lookup.receiver_country,
        payment_type: lookup.payment_type,
        send_agent: lookup.send_agent,
        txn_date: lookup.txn_date,
        ...kyc,
        beneficiary_id_number:
          kyc.beneficiary_id_number || kyc.beneficiary_citizenship_number,
      });
    },
    onSuccess: (res) => {
      toast.success(res.message || t("remittance.credited"), {
        description: t("remittance.creditedBody", {
          amount: formatNPR(res.data.total_credited || res.data.amount),
        }),
      });
      setStep("lookup");
      setRefNo("");
      setLookup(null);
      setKyc(emptyKyc(user?.phone ?? ""));
      setLastReceiptId(activityIdForKind("remittance", res.data.id));
      queryClient.invalidateQueries({ queryKey: ["remittances"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] });
    },
    onError: (err) => {
      toastApiError(err, { title: t("remittance.failed"), fallback: t("remittance.failed") });
    },
  });

  const stepTitle = useMemo(() => {
    if (step === "lookup") return t("remittance.stepLookup");
    if (step === "details") return t("remittance.stepDetails");
    return t("remittance.stepKyc");
  }, [step, t]);

  return (
    <UserShell title={t("remittance.title")} back="/app">
      <div className="space-y-5">
        {accountPending ? <AccountPendingBanner /> : null}
        {!remittancesEnabled && !accountPending ? (
          <section className="inset-group border-destructive/20 bg-destructive/5 p-4">
            <p className="text-[15px] font-medium text-destructive">
              {t("remittance.disabledTitle")}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("remittance.disabledBody")}
            </p>
          </section>
        ) : null}

        <section className="inset-group p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">{stepTitle}</h2>
            {step !== "lookup" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-[13px]"
                onClick={() => setStep(step === "kyc" ? "details" : "lookup")}
              >
                <ArrowLeft className="size-3.5" />
                {t("common.goBack")}
              </Button>
            ) : null}
          </div>

          {step === "lookup" ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                lookupMutation.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="ref_no">{t("remittance.refNo")}</Label>
                <Input
                  id="ref_no"
                  value={refNo}
                  onChange={(e) => setRefNo(e.target.value.toUpperCase())}
                  placeholder={t("remittance.refPlaceholder")}
                  className="h-12 rounded-xl font-medium tracking-wide"
                  disabled={!remittancesEnabled}
                  autoComplete="off"
                  required
                />
                <p className="text-[12px] text-muted-foreground">{t("remittance.refHelp")}</p>
              </div>
              <Button
                type="submit"
                disabled={lookupMutation.isPending || !remittancesEnabled}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                <Search className="mr-2 size-4" />
                {lookupMutation.isPending ? t("common.loading") : t("remittance.lookup")}
              </Button>
            </form>
          ) : null}

          {step === "details" && lookup ? (
            <div className="space-y-4">
              <dl className="space-y-2 text-[14px]">
                <Row label={t("remittance.refNo")} value={lookup.ref_no} mono />
                <Row label={t("common.amount")} value={formatNPR(lookup.amount)} strong />
                <Row label={t("remittance.sender")} value={lookup.sender_name || "—"} />
                <Row
                  label={t("remittance.senderFrom")}
                  value={
                    [lookup.sender_city, lookup.sender_country].filter(Boolean).join(", ") || "—"
                  }
                />
                <Row label={t("remittance.receiver")} value={lookup.receiver_name || "—"} />
                <Row label={t("remittance.receiverPhone")} value={lookup.receiver_phone || "—"} />
                <Row label={t("remittance.paymentType")} value={lookup.payment_type || "—"} />
                <Row label={t("remittance.txnDate")} value={lookup.txn_date || "—"} />
              </dl>
              <Button
                type="button"
                className="h-12 w-full rounded-xl text-[17px]"
                onClick={() => setStep("kyc")}
                disabled={!remittancesEnabled}
              >
                {t("remittance.continueKyc")}
              </Button>
            </div>
          ) : null}

          {step === "kyc" && lookup ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                receiveMutation.mutate();
              }}
            >
              <p className="rounded-xl bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground">
                {t("remittance.kycHelp", {
                  amount: formatNPR(lookup.amount),
                  ref: lookup.ref_no,
                })}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("remittance.gender")}>
                  <Select
                    value={kyc.beneficiary_gender}
                    onValueChange={(v) => setField("beneficiary_gender", v)}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GENDERS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("remittance.nationality")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_nationality}
                    onChange={(e) => setField("beneficiary_nationality", e.target.value)}
                  />
                </Field>
                <Field label={t("remittance.dob")}>
                  <BsDatePicker
                    value={kyc.beneficiary_dob}
                    onChange={(iso) => setField("beneficiary_dob", iso)}
                    placeholder={t("remittance.dobPlaceholder")}
                    disableFuture
                    required
                  />
                </Field>
                <Field label={t("remittance.mobile")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_mobile_no}
                    onChange={(e) => setField("beneficiary_mobile_no", e.target.value)}
                    required
                  />
                </Field>
                <Field label={t("remittance.state")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_state}
                    onChange={(e) => setField("beneficiary_state", e.target.value)}
                    required
                  />
                </Field>
                <Field label={t("remittance.district")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_district}
                    onChange={(e) => setField("beneficiary_district", e.target.value)}
                    required
                  />
                </Field>
                <Field label={t("remittance.municipality")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_municipality}
                    onChange={(e) => setField("beneficiary_municipality", e.target.value)}
                    required
                  />
                </Field>
                <Field label={t("remittance.ward")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_ward_number}
                    onChange={(e) => setField("beneficiary_ward_number", e.target.value)}
                    required
                  />
                </Field>
                <Field label={t("remittance.city")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_city}
                    onChange={(e) => setField("beneficiary_city", e.target.value)}
                  />
                </Field>
                <Field label={t("remittance.address")} className="sm:col-span-2">
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_address}
                    onChange={(e) => setField("beneficiary_address", e.target.value)}
                    required
                  />
                </Field>
                <Field label={t("remittance.relation")}>
                  <Select
                    value={kyc.beneficiary_relation}
                    onValueChange={(v) => setField("beneficiary_relation", v)}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATIONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("remittance.occupation")}>
                  <Select
                    value={kyc.beneficiary_occupation}
                    onValueChange={(v) => setField("beneficiary_occupation", v)}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OCCUPATIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("remittance.citizenshipNo")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_citizenship_number}
                    onChange={(e) => {
                      setField("beneficiary_citizenship_number", e.target.value);
                      if (!kyc.beneficiary_id_number) {
                        setField("beneficiary_id_number", e.target.value);
                      }
                    }}
                    required
                  />
                </Field>
                <Field label={t("remittance.citizenshipDistrict")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_citizenship_issuing_district}
                    onChange={(e) =>
                      setField("beneficiary_citizenship_issuing_district", e.target.value)
                    }
                    required
                  />
                </Field>
                <Field label={t("remittance.idType")}>
                  <Select
                    value={kyc.beneficiary_id_type}
                    onValueChange={(v) => setField("beneficiary_id_type", v)}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ID_TYPES.map((id) => (
                        <SelectItem key={id} value={id}>
                          {id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("remittance.idNumber")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_id_number}
                    onChange={(e) => setField("beneficiary_id_number", e.target.value)}
                    required
                  />
                </Field>
                <Field label={t("remittance.idIssueDate")}>
                  <BsDatePicker
                    value={kyc.beneficiary_id_issue_date}
                    onChange={(iso) => setField("beneficiary_id_issue_date", iso)}
                    placeholder={t("remittance.idIssueDatePlaceholder")}
                    disableFuture
                    required
                  />
                </Field>
                <Field label={t("remittance.idIssueBy")}>
                  <Input
                    className="h-11 rounded-xl"
                    value={kyc.beneficiary_id_issue_by}
                    onChange={(e) => setField("beneficiary_id_issue_by", e.target.value)}
                    required
                  />
                </Field>
                <Field label={t("remittance.purpose")} className="sm:col-span-2">
                  <Select
                    value={kyc.remittance_purpose}
                    onValueChange={(v) => setField("remittance_purpose", v)}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PURPOSES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Button
                type="submit"
                disabled={receiveMutation.isPending || !remittancesEnabled}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                {receiveMutation.isPending
                  ? t("common.submitting")
                  : t("remittance.confirmReceive", { amount: formatNPR(lookup.amount) })}
              </Button>
            </form>
          ) : null}
        </section>

        <section>
          {lastReceiptId ? (
            <div className="mb-3">
              <TransactionResultBanner
                tone={
                  remittanceItems.find(
                    (x) => activityIdForKind("remittance", x.id) === lastReceiptId,
                  )?.status === "failed"
                    ? "danger"
                    : remittanceItems.find(
                          (x) => activityIdForKind("remittance", x.id) === lastReceiptId,
                        )?.status === "pending"
                      ? "warning"
                      : "success"
                }
                title={t("remittance.credited")}
                body={t("history.downloadStatement")}
                receiptLabel={t("history.downloadPdf")}
                onDownloadReceipt={() => void downloadReceipt(lastReceiptId)}
                downloading={receiptDownloading}
              />
            </div>
          ) : null}
          <ListPageToolbar
            stats={remittanceStats}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={async () => {
              setExporting(true);
              try {
                await downloadCsvExport("/api/remittance/history/", debounced, "remittances.csv");
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
          <h2 className="mb-2 mt-4 px-1 text-[17px] font-semibold">{t("remittance.history")}</h2>
          {historyQuery.isLoading ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : !remittanceItems.length ? (
            <div className="inset-group px-4 py-8 text-center text-sm text-muted-foreground">
              {t("remittance.empty")}
            </div>
          ) : (
            <ul className="inset-group divide-y divide-border">
              {remittanceItems.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium">
                        {formatNPR(r.total_credited !== "0.00" ? r.total_credited : r.amount)}{" "}
                        <span className="text-[13px] font-normal text-muted-foreground">
                          · {r.ref_no}
                        </span>
                      </p>
                      <p className="truncate text-[13px] text-muted-foreground">
                        {r.sender_name || t("remittance.sender")} · {formatDateTime(r.created_at)}
                      </p>
                    </div>
                    <StatusChip status={r.status} />
                  </div>
                  {(r.status === "success" || r.status === "failed") && (
                    <div className="mt-1 flex justify-end">
                      <ReceiptDownloadLink
                        label={t("list.downloadReceipt")}
                        downloading={receiptDownloading}
                        onClick={() =>
                          void downloadReceipt(activityIdForKind("remittance", r.id))
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

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-[13px]">{label}</Label>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`text-right ${mono ? "font-mono text-[13px]" : ""} ${
          strong ? "text-[17px] font-semibold tabular" : "font-medium"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
