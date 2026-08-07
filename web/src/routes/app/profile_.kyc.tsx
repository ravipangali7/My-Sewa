import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { FileCheck2, Upload, X } from "lucide-react";
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
import {
  flattenDocFiles,
  requiresBothSides,
  validateDocSidesForSubmit,
  type DocFileMap,
} from "@/lib/kyc-documents";
import type { KycDocumentSide, KycDocumentType } from "@/lib/types";
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

const SIDE_LABEL_KEY: Record<KycDocumentSide, MessageKey> = {
  front: "kyc.side.front",
  back: "kyc.side.back",
  single: "kyc.side.single",
};

function KycPage() {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [citizenshipNumber, setCitizenshipNumber] = useState("");
  const [files, setFiles] = useState<DocFileMap>({});
  const [previews, setPreviews] = useState<
    Partial<Record<KycDocumentType, Partial<Record<KycDocumentSide, string>>>>
  >({});
  const [extraType, setExtraType] = useState<KycDocumentType>("other");
  const [extraSide, setExtraSide] = useState<KycDocumentSide>("single");
  const [extraFile, setExtraFile] = useState<File | null>(null);
  const [extraPreview, setExtraPreview] = useState<string | null>(null);
  const previewUrlsRef = useRef<string[]>([]);

  const trackPreview = (url: string | null | undefined) => {
    if (url) previewUrlsRef.current.push(url);
  };

  const kycQuery = useQuery({
    queryKey: ["kyc"],
    queryFn: () => apiClient.getKyc(),
  });

  const status = kycQuery.data?.kyc_status ?? user?.kyc_status ?? "not_submitted";
  const submission = kycQuery.data?.submission ?? null;
  const documents = submission?.documents ?? [];
  const locked =
    isIdentityLocked(user) ||
    isIdentityLocked({
      kyc_status: status,
      kyc_verified: kycQuery.data?.kyc_verified,
      profile_locked: kycQuery.data?.profile_locked,
    });
  // No replace / delete / re-submit after KYC verification.
  const canSubmit = !locked && Boolean(kycQuery.data?.can_submit);

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

  useEffect(() => {
    if (requiresBothSides(extraType)) {
      setExtraSide((s) => (s === "single" ? "front" : s));
    } else {
      setExtraSide("single");
    }
  }, [extraType]);

  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current = [];
    };
  }, []);

  const setSideFile = (
    type: KycDocumentType,
    side: KycDocumentSide,
    file: File | null,
  ) => {
    setFiles((prev) => {
      const slot = { ...(prev[type] ?? {}) };
      slot[side] = file;
      return { ...prev, [type]: slot };
    });
    setPreviews((prev) => {
      const prevUrl = prev[type]?.[side];
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      const nextSide = { ...(prev[type] ?? {}) };
      if (file) {
        const url = URL.createObjectURL(file);
        trackPreview(url);
        nextSide[side] = url;
      } else {
        delete nextSide[side];
      }
      return { ...prev, [type]: nextSide };
    });
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const number = citizenshipNumber.trim();
      if (number.length < 3) throw new Error(t("kyc.citizenshipNumberRequired"));
      const sideError = validateDocSidesForSubmit(files);
      if (sideError) throw new Error(t(sideError as MessageKey));

      const rows = flattenDocFiles(files);
      const fd = new FormData();
      fd.append("citizenship_number", number);
      for (const row of rows) {
        fd.append("file", row.file);
        fd.append("document_type", row.type);
        fd.append("side", row.side);
      }
      return apiClient.submitKyc(fd);
    },
    onSuccess: (res) => {
      toast.success(res.message || t("kyc.submitted"));
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current = [];
      setFiles({});
      setPreviews({});
      queryClient.invalidateQueries({ queryKey: ["kyc"] });
      // Keep profile kyc_status in sync (Pending after submit / resubmit).
      queryClient.invalidateQueries({ queryKey: ["auth", "profile"] });
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
      const side = requiresBothSides(extraType)
        ? extraSide === "back"
          ? "back"
          : "front"
        : "single";
      const fd = new FormData();
      fd.append("document_type", extraType);
      fd.append("side", side);
      fd.append("file", extraFile);
      return apiClient.uploadKycDocument(fd);
    },
    onSuccess: (res) => {
      toast.success(res.message || t("kyc.documentUploaded"));
      if (extraPreview) URL.revokeObjectURL(extraPreview);
      setExtraFile(null);
      setExtraPreview(null);
      queryClient.invalidateQueries({ queryKey: ["kyc"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError || err instanceof Error ? err.message : t("kyc.uploadFailed"),
      );
    },
  });

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

          {locked ? <KycDocumentsLockedNotice /> : null}

          {status === "rejected" && submission?.rejection_reason ? (
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

        {documents.length > 0 ? (
          <section className="inset-group space-y-3 p-4">
            <h2 className="text-[15px] font-semibold">{t("kyc.uploadedDocs")}</h2>
            <ul className="space-y-2">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 rounded-xl border border-separator/70 px-3 py-2.5"
                >
                  {doc.file_url ? (
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="size-12 shrink-0 overflow-hidden rounded-lg border border-separator/70 bg-muted"
                    >
                      <img
                        src={doc.file_url}
                        alt=""
                        className="size-full object-cover"
                      />
                    </a>
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <FileCheck2 className="size-4" />
                    </span>
                  )}
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
                      {t(SIDE_LABEL_KEY[doc.side] ?? "kyc.side.single")}
                      {" · "}
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
                  const dual = requiresBothSides(slot.type);
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
                      {dual ? (
                        <p className="mb-2 text-[12px] text-muted-foreground">
                          {t("kyc.bothSidesHint")}
                        </p>
                      ) : (
                        <p className="mb-2 text-[12px] text-muted-foreground">
                          {t("kyc.singleSideHint")}
                        </p>
                      )}
                      {dual ? (
                        <div className="grid grid-cols-2 gap-2.5">
                          <SideUploadSlot
                            id={`kyc-${slot.type}-front`}
                            label={t("kyc.side.front")}
                            required={Boolean(slot.primary)}
                            file={files[slot.type]?.front ?? null}
                            previewUrl={previews[slot.type]?.front}
                            onChange={(file) => setSideFile(slot.type, "front", file)}
                            chooseLabel={t("kyc.chooseFile")}
                            clearLabel={t("kyc.clear")}
                          />
                          <SideUploadSlot
                            id={`kyc-${slot.type}-back`}
                            label={t("kyc.side.back")}
                            required={Boolean(slot.primary)}
                            file={files[slot.type]?.back ?? null}
                            previewUrl={previews[slot.type]?.back}
                            onChange={(file) => setSideFile(slot.type, "back", file)}
                            chooseLabel={t("kyc.chooseFile")}
                            clearLabel={t("kyc.clear")}
                          />
                        </div>
                      ) : (
                        <SideUploadSlot
                          id={`kyc-${slot.type}-single`}
                          label={t("kyc.side.single")}
                          required={false}
                          file={files[slot.type]?.single ?? null}
                          previewUrl={previews[slot.type]?.single}
                          onChange={(file) => setSideFile(slot.type, "single", file)}
                          chooseLabel={t("kyc.chooseFile")}
                          clearLabel={t("kyc.clear")}
                        />
                      )}
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

        {status === "pending" && !locked ? (
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
            {requiresBothSides(extraType) ? (
              <div className="space-y-1.5">
                <Label htmlFor="extra_side">{t("kyc.sideLabel")}</Label>
                <select
                  id="extra_side"
                  value={extraSide === "back" ? "back" : "front"}
                  onChange={(e) => setExtraSide(e.target.value as KycDocumentSide)}
                  className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-[14px]"
                >
                  <option value="front">{t("kyc.side.front")}</option>
                  <option value="back">{t("kyc.side.back")}</option>
                </select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="extra_file">{t("kyc.file")}</Label>
              <SideUploadSlot
                id="extra_file"
                label={
                  requiresBothSides(extraType)
                    ? t(SIDE_LABEL_KEY[extraSide === "back" ? "back" : "front"])
                    : t("kyc.side.single")
                }
                required={false}
                file={extraFile}
                previewUrl={extraPreview ?? undefined}
                onChange={(file) => {
                  if (extraPreview) URL.revokeObjectURL(extraPreview);
                  setExtraFile(file);
                  if (!file) {
                    setExtraPreview(null);
                    return;
                  }
                  const url = URL.createObjectURL(file);
                  trackPreview(url);
                  setExtraPreview(url);
                }}
                chooseLabel={t("kyc.chooseFile")}
                clearLabel={t("kyc.clear")}
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

function SideUploadSlot({
  id,
  label,
  required,
  file,
  previewUrl,
  onChange,
  chooseLabel,
  clearLabel,
}: {
  id: string;
  label: string;
  required: boolean;
  file: File | null;
  previewUrl?: string | undefined;
  onChange: (file: File | null) => void;
  chooseLabel: string;
  clearLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </p>
      {previewUrl ? (
        <div className="relative overflow-hidden rounded-lg border border-separator bg-muted">
          <img src={previewUrl} alt="" className="aspect-[4/3] w-full object-cover" />
          <button
            type="button"
            aria-label={clearLabel}
            className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/55 text-white"
            onClick={() => onChange(null)}
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
          <p className="truncate px-2 py-1.5 text-[11px] text-muted-foreground">{file?.name}</p>
        </div>
      ) : (
        <label
          htmlFor={id}
          className="flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-separator bg-background px-2 py-3 text-center text-[13px] text-muted-foreground"
        >
          <Upload className="size-4 shrink-0" />
          <span>{chooseLabel}</span>
        </label>
      )}
      <input
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        required={required && !file}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
