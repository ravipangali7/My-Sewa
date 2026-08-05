import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { FileCheck2, Upload } from "lucide-react";
import { toast } from "sonner";
import { KycDocumentsLockedNotice } from "@/components/KycDocumentsLockedNotice";
import { UserShell } from "@/components/layout/UserShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useT, type MessageKey } from "@/lib/i18n";
import { isIdentityLocked } from "@/lib/kyc-lock";
import type { KycDocumentType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/app/profile_/kyc")({
  head: () => ({
    meta: [
      { title: "KYC Verification — MySewa" },
      {
        name: "description",
        content:
          "Submit citizenship and other identity documents for MySewa KYC verification.",
      },
      { property: "og:title", content: "KYC Verification — MySewa" },
    ],
  }),
  component: KycPage,
});

type DocSlot = {
  type: KycDocumentType;
  primary?: boolean;
};

const DOC_SLOTS: DocSlot[] = [
  { type: "citizenship", primary: true },
  { type: "passport" },
  { type: "driving_license" },
  { type: "national_id" },
  { type: "other" },
];

const DOC_LABEL_KEY: Record<KycDocumentType, MessageKey> = {
  citizenship: "kyc.doc.citizenship",
  passport: "kyc.doc.passport",
  driving_license: "kyc.doc.drivingLicense",
  national_id: "kyc.doc.nationalId",
  other: "kyc.doc.other",
};

function KycPage() {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [citizenshipNumber, setCitizenshipNumber] = useState("");
  const [files, setFiles] = useState<Partial<Record<KycDocumentType, File>>>({});
  const [extraType, setExtraType] = useState<KycDocumentType>("other");
  const [extraFile, setExtraFile] = useState<File | null>(null);

  const kycQuery = useQuery({
    queryKey: ["kyc"],
    queryFn: () => apiClient.getKyc(),
  });

  const status = kycQuery.data?.kyc_status ?? user?.kyc_status ?? "not_submitted";
  const verified =
    isIdentityLocked(user) ||
    isIdentityLocked({
      kyc_status: status,
      kyc_verified: kycQuery.data?.kyc_verified,
      profile_locked: kycQuery.data?.profile_locked,
    });
  // Never allow replace/delete/re-submit after verification.
  const canSubmit = !verified && Boolean(kycQuery.data?.can_submit);
  const submission = kycQuery.data?.submission ?? null;
  const documents = submission?.documents ?? [];

  useEffect(() => {
    if (!canSubmit || citizenshipNumber) return;
    const prefill =
      kycQuery.data?.citizenship_number || submission?.citizenship_number || "";
    if (prefill) setCitizenshipNumber(prefill);
  }, [
    canSubmit,
    citizenshipNumber,
    kycQuery.data?.citizenship_number,
    submission?.citizenship_number,
  ]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const number = citizenshipNumber.trim();
      if (number.length < 3) throw new Error(t("kyc.citizenshipNumberRequired"));
      if (!files.citizenship) throw new Error(t("kyc.citizenshipFileRequired"));

      const fd = new FormData();
      fd.append("citizenship_number", number);
      for (const slot of DOC_SLOTS) {
        const file = files[slot.type];
        if (!file) continue;
        fd.append("file", file);
        fd.append("document_type", slot.type);
        fd.append("side", "single");
      }
      return apiClient.submitKyc(fd);
    },
    onSuccess: (res) => {
      toast.success(res.message || t("kyc.submitted"));
      setFiles({});
      queryClient.invalidateQueries({ queryKey: ["kyc"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError || err instanceof Error ? err.message : t("kyc.submitFailed"),
      );
    },
  });

  const uploadExtraMutation = useMutation({
    mutationFn: async () => {
      if (!extraFile) throw new Error(t("kyc.fileRequired"));
      const fd = new FormData();
      fd.append("document_type", extraType);
      fd.append("side", "single");
      fd.append("file", extraFile);
      return apiClient.uploadKycDocument(fd);
    },
    onSuccess: (res) => {
      toast.success(res.message || t("kyc.documentUploaded"));
      setExtraFile(null);
      queryClient.invalidateQueries({ queryKey: ["kyc"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError || err instanceof Error ? err.message : t("kyc.uploadFailed"),
      );
    },
  });

  const setFile = (type: KycDocumentType, file: File | null) => {
    setFiles((prev) => {
      const next = { ...prev };
      if (file) next[type] = file;
      else delete next[type];
      return next;
    });
  };

  const helpText =
    status === "approved"
      ? t("kyc.approvedHelp")
      : status === "pending"
        ? t("kyc.pendingHelp")
        : status === "rejected"
          ? t("kyc.rejectedHelp")
          : t("kyc.notSubmittedHelp");

  return (
    <UserShell title={t("kyc.title")} back="/app/profile">
      <div className="space-y-4">
        <section className="inset-group space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold">{t("kyc.statusTitle")}</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">{helpText}</p>
            </div>
            <StatusChip status={status} />
          </div>

          {submission?.rejection_reason ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5">
              <p className="text-[12px] font-medium text-destructive">{t("kyc.rejectionReason")}</p>
              <p className="mt-0.5 text-[13px] text-destructive/90">{submission.rejection_reason}</p>
            </div>
          ) : null}

          {kycQuery.data?.citizenship_number || submission?.citizenship_number ? (
            <dl className="space-y-1 text-[14px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("kyc.citizenshipNumber")}</dt>
                <dd className="font-medium tabular">
                  {kycQuery.data?.citizenship_number || submission?.citizenship_number}
                </dd>
              </div>
              {submission?.submitted_at ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t("kyc.submittedAt")}</dt>
                  <dd className="text-right text-[13px]">
                    {formatDateTime(submission.submitted_at)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>

        {verified ? <KycDocumentsLockedNotice className="px-0" /> : null}

        {documents.length > 0 ? (
          <section className="inset-group space-y-3 p-4">
            <h2 className="text-[15px] font-semibold">{t("kyc.uploadedDocs")}</h2>
            <ul className="space-y-2">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 rounded-xl border border-separator/70 px-3 py-2.5"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    <FileCheck2 className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">
                      {t(DOC_LABEL_KEY[doc.document_type] ?? "kyc.doc.other")}
                      {doc.document_type === "citizenship" ? (
                        <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
                          {t("kyc.primary")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      {formatDateTime(doc.uploaded_at)}
                    </p>
                  </div>
                  {doc.file_url ? (
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-[13px] font-semibold text-[#2563EB]"
                    >
                      {t("kyc.view")}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {canSubmit ? (
          <section className="inset-group p-4">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submitMutation.mutate();
              }}
            >
              <div>
                <h2 className="text-[15px] font-semibold">{t("kyc.submitTitle")}</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">{t("kyc.submitHelp")}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="citizenship_number">{t("kyc.citizenshipNumber")}</Label>
                <Input
                  id="citizenship_number"
                  value={citizenshipNumber}
                  onChange={(e) => setCitizenshipNumber(e.target.value)}
                  placeholder={t("kyc.citizenshipNumberPlaceholder")}
                  className="h-11 rounded-xl"
                  required
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2.5">
                <Label>{t("kyc.documents")}</Label>
                {DOC_SLOTS.map((slot) => {
                  const inputId = `kyc-file-${slot.type}`;
                  const file = files[slot.type];
                  return (
                    <div
                      key={slot.type}
                      className={cn(
                        "rounded-xl border px-3 py-3",
                        slot.primary
                          ? "border-brand/35 bg-brand/5"
                          : "border-dashed border-separator",
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[14px] font-medium">
                          {t(DOC_LABEL_KEY[slot.type])}
                          {slot.primary ? (
                            <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
                              {t("kyc.primaryRequired")}
                            </span>
                          ) : (
                            <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">
                              {t("kyc.optional")}
                            </span>
                          )}
                        </p>
                      </div>
                      <label
                        htmlFor={inputId}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-separator bg-background px-3 py-3 text-[14px] text-muted-foreground"
                      >
                        <Upload className="size-4 shrink-0" />
                        <span className="min-w-0 truncate">
                          {file?.name ?? t("kyc.chooseFile")}
                        </span>
                      </label>
                      <input
                        id={inputId}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        required={Boolean(slot.primary)}
                        onChange={(e) => setFile(slot.type, e.target.files?.[0] ?? null)}
                      />
                    </div>
                  );
                })}
              </div>

              <Button
                type="submit"
                disabled={submitMutation.isPending || kycQuery.isLoading}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                {submitMutation.isPending ? t("common.submitting") : t("kyc.submit")}
              </Button>
            </form>
          </section>
        ) : null}

        {status === "pending" ? (
          <section className="inset-group space-y-3 p-4">
            <div>
              <h2 className="text-[15px] font-semibold">{t("kyc.addSupporting")}</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">{t("kyc.addSupportingHelp")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="extra_type">{t("kyc.documentType")}</Label>
              <select
                id="extra_type"
                value={extraType}
                onChange={(e) => setExtraType(e.target.value as KycDocumentType)}
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px]"
              >
                {DOC_SLOTS.map((slot) => (
                  <option key={slot.type} value={slot.type}>
                    {t(DOC_LABEL_KEY[slot.type])}
                    {slot.primary ? ` (${t("kyc.primary")})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="extra_file">{t("kyc.file")}</Label>
              <label
                htmlFor="extra_file"
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-separator px-4 py-4 text-[15px] text-muted-foreground"
              >
                <Upload className="size-5" />
                {extraFile?.name ?? t("kyc.chooseFile")}
              </label>
              <input
                id="extra_file"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => setExtraFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={uploadExtraMutation.isPending || !extraFile}
              className="h-11 w-full rounded-xl"
              onClick={() => uploadExtraMutation.mutate()}
            >
              {uploadExtraMutation.isPending ? t("common.submitting") : t("kyc.uploadDocument")}
            </Button>
          </section>
        ) : null}

        {kycQuery.isLoading ? (
          <p className="px-1 text-sm text-muted-foreground">{t("kyc.loading")}</p>
        ) : null}
        {kycQuery.isError ? (
          <p className="px-1 text-sm text-destructive">
            {kycQuery.error instanceof ApiError
              ? kycQuery.error.message
              : t("kyc.loadFailed")}
          </p>
        ) : null}
      </div>
    </UserShell>
  );
}
