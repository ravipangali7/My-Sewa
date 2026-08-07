import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ExternalLink, ImageIcon } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { KycDocument } from "@/lib/types";

export const Route = createFileRoute("/admin/kyc_/$kycId")({
  head: () => ({
    meta: [
      { title: "KYC Review — MySewa Admin" },
      {
        name: "description",
        content: "View KYC identity documents and approve or reject verification.",
      },
      { property: "og:title", content: "KYC Review — MySewa Admin" },
    ],
  }),
  component: KycDetailPage,
});

function StatementRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-dashed border-border/80 py-2.5 last:border-0 md:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] md:gap-3">
      <dt className="min-w-0 break-words text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="min-w-0 break-all text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function displayName(d: {
  first_name?: string;
  last_name?: string;
  phone: string;
}) {
  const name = [d.first_name, d.last_name].filter(Boolean).join(" ").trim();
  return name || d.phone;
}

function docUrl(doc: KycDocument) {
  return doc.file_url || doc.file;
}

function KycDetailPage() {
  const { kycId } = Route.useParams();
  const id = Number(kycId);
  const queryClient = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [citizenshipNumber, setCitizenshipNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  const kycQuery = useQuery({
    queryKey: ["admin", "kyc", id],
    queryFn: () => apiClient.adminGetKyc(id),
    enabled: Number.isFinite(id),
    refetchOnMount: "always",
  });

  useEffect(() => {
    const s = kycQuery.data;
    if (!s) return;
    setCitizenshipNumber(s.citizenship_number || "");
    setFirstName(s.first_name || "");
    setLastName(s.last_name || "");
    setDateOfBirth(s.date_of_birth || "");
  }, [kycQuery.data]);

  const invalidateKycQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.adminUpdateKyc(id, {
        citizenship_number: citizenshipNumber.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dateOfBirth.trim() || null,
      }),
    onSuccess: (res) => {
      toast.success(res.message || `KYC #${id} details saved`);
      invalidateKycQueries();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Save failed");
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      // Persist any pending corrections first so approve uses the fixed data.
      await apiClient.adminUpdateKyc(id, {
        citizenship_number: citizenshipNumber.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dateOfBirth.trim() || null,
      });
      return apiClient.adminApproveKyc(id);
    },
    onSuccess: () => {
      toast.success(`KYC #${id} approved — user verified`);
      invalidateKycQueries();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Approve failed");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (rejection_reason: string) =>
      apiClient.adminRejectKyc(id, { rejection_reason }),
    onSuccess: () => {
      toast.error(`KYC #${id} rejected`);
      setRejectOpen(false);
      setRejectionReason("");
      invalidateKycQueries();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Reject failed");
    },
  });

  const s = kycQuery.data;
  const canEdit = s?.status === "pending";
  const actionPending =
    saveMutation.isPending || approveMutation.isPending || rejectMutation.isPending;
  const accountName = s ? displayName(s) : "";

  const submitReject = () => {
    const reason = rejectionReason.trim();
    if (!reason) {
      toast.error("Please enter a rejection reason");
      return;
    }
    rejectMutation.mutate(reason);
  };

  const saveEdits = () => {
    if (!citizenshipNumber.trim() || citizenshipNumber.trim().length < 3) {
      toast.error("Citizenship number is required");
      return;
    }
    saveMutation.mutate();
  };

  return (
    <AdminShell
      title={s ? `KYC #${s.id}` : "KYC"}
      description={
        s
          ? "Identity verification review"
          : kycQuery.isLoading
            ? "Loading…"
            : "Not found"
      }
      actions={
        s?.status === "pending" ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:shrink-0">
            <Button
              size="sm"
              variant="outline"
              disabled={actionPending}
              onClick={saveEdits}
            >
              {saveMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button size="sm" disabled={actionPending} onClick={() => approveMutation.mutate()}>
              {approveMutation.isPending ? "Approving…" : "Save & approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={actionPending}
              onClick={() => {
                setRejectionReason("");
                setRejectOpen(true);
              }}
            >
              Reject
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="mb-5">
        <BackButton to="/admin/kyc" label="Back to KYC" />
      </div>

      {kycQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {kycQuery.error instanceof ApiError
            ? kycQuery.error.message
            : "KYC submission not found."}
        </p>
      )}

      {s && (
        <div className="space-y-6">
          <article className="min-w-0 overflow-x-clip rounded-2xl border border-border bg-surface shadow-card">
            <div className="border-b border-border bg-gradient-to-br from-muted/80 via-surface to-surface px-4 py-5 sm:px-6 sm:py-6 md:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    MySewa KYC
                  </p>
                  <h2 className="mt-1 break-words text-xl font-semibold tracking-tight sm:text-2xl">
                    Identity verification
                  </h2>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    Submission #{s.id} ·{" "}
                    {formatDateTime(s.submitted_at || s.created_at)}
                  </p>
                </div>
                <StatusChip status={s.status} />
              </div>

              {canEdit ? (
                <div className="mt-6 space-y-4 rounded-xl border border-brand/20 bg-gradient-to-br from-brand-soft/70 via-surface to-surface px-4 py-5 sm:px-5">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                      Correct missing or incorrect details
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Edit the fields below, then save or save &amp; approve without asking the
                      user to resubmit.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="kyc-citizenship">Citizenship number</Label>
                      <Input
                        id="kyc-citizenship"
                        value={citizenshipNumber}
                        onChange={(e) => setCitizenshipNumber(e.target.value)}
                        className="h-11 font-semibold tracking-tight"
                        disabled={actionPending}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="kyc-first-name">First name</Label>
                      <Input
                        id="kyc-first-name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        disabled={actionPending}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="kyc-last-name">Last name</Label>
                      <Input
                        id="kyc-last-name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        disabled={actionPending}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="kyc-dob">Date of birth (AD)</Label>
                      <Input
                        id="kyc-dob"
                        type="date"
                        value={dateOfBirth}
                        onChange={(e) => setDateOfBirth(e.target.value)}
                        disabled={actionPending}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 min-w-0 rounded-xl border border-brand/20 bg-gradient-to-br from-brand-soft/70 via-surface to-surface px-4 py-5 text-center sm:px-5 sm:text-left">
                  <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    Citizenship number
                  </p>
                  <p className="mt-2 break-all text-2xl font-black tracking-tight text-brand-dark sm:text-3xl md:text-4xl">
                    {s.citizenship_number || "—"}
                  </p>
                  <p className="mt-1.5 break-words text-sm text-muted-foreground">
                    {s.status_display} · {s.documents?.length ?? 0} document
                    {(s.documents?.length ?? 0) === 1 ? "" : "s"}
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
              <section className="border-b border-border px-4 py-5 sm:px-6 md:border-r md:px-8">
                <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Account holder
                </h3>
                <dl>
                  <StatementRow label="Name">{accountName}</StatementRow>
                  <StatementRow label="Phone">{s.phone}</StatementRow>
                  <StatementRow label="Date of birth">
                    {s.date_of_birth || "—"}
                  </StatementRow>
                  <StatementRow label="User ID">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: String(s.user_id) }}
                      className="text-brand underline-offset-2 hover:underline"
                    >
                      #{s.user_id}
                    </Link>
                  </StatementRow>
                </dl>
              </section>

              <section className="border-b border-border px-4 py-5 sm:px-6 md:px-8">
                <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Review
                </h3>
                <dl>
                  <StatementRow label="Status">{s.status_display}</StatementRow>
                  <StatementRow label="Submitted">
                    {formatDateTime(s.submitted_at || s.created_at)}
                  </StatementRow>
                  <StatementRow label="Updated">{formatDateTime(s.updated_at)}</StatementRow>
                  <StatementRow label="Reviewed by">
                    {s.reviewed_by_phone || "—"}
                  </StatementRow>
                  <StatementRow label="Reviewed at">
                    {s.reviewed_at ? formatDateTime(s.reviewed_at) : "—"}
                  </StatementRow>
                </dl>
              </section>
            </div>

            {s.status === "rejected" && (
              <section className="border-b border-border px-4 py-5 sm:px-6 md:px-8">
                <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Rejection
                </h3>
                <dl>
                  <StatementRow label="Reason">
                    <span className="break-words text-destructive">
                      {s.rejection_reason || "—"}
                    </span>
                  </StatementRow>
                </dl>
              </section>
            )}

            <section className="px-4 py-5 sm:px-6 md:px-8">
              <h3 className="mb-4 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Identity documents
              </h3>
              {s.documents?.length ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {s.documents.map((doc) => {
                    const url = docUrl(doc);
                    return (
                      <div
                        key={doc.id}
                        className="overflow-hidden rounded-xl border border-border bg-muted/30"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {doc.document_type_display}
                            </p>
                            <p className="text-xs text-muted-foreground">{doc.side_display}</p>
                          </div>
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                            >
                              Open
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </div>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block overflow-x-clip bg-muted/40"
                          >
                            <img
                              src={url}
                              alt={`${doc.document_type_display} ${doc.side_display}`}
                              className="mx-auto max-h-[min(360px,60vh)] w-full object-contain"
                            />
                          </a>
                        ) : (
                          <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
                            <ImageIcon className="size-8 opacity-50" />
                            <p className="text-sm">No file</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 text-muted-foreground">
                  <ImageIcon className="size-8 opacity-50" />
                  <p className="text-sm">No documents uploaded</p>
                </div>
              )}
            </section>

            <footer className="border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground sm:px-6 md:px-8">
              {canEdit
                ? "Correct citizenship or name fields if needed, then Save & approve. Approval verifies the user and locks identity fields. Rejection requires a reason and lets the user re-upload."
                : "Submissions stay Pending until you Approve or Reject. Approval verifies the user and locks identity fields. Rejection requires a reason and lets the user re-upload (back to Pending)."}
            </footer>
          </article>
        </div>
      )}

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open);
          if (!open) setRejectionReason("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject KYC #{s?.id}</DialogTitle>
            <DialogDescription>
              {s
                ? `${displayName(s)} (${s.phone}). The user will see this reason.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="detail-kyc-rejection-reason">Rejection reason</Label>
            <Textarea
              id="detail-kyc-rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Document blurry / citizenship number mismatch"
              rows={4}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={rejectMutation.isPending}
              onClick={() => setRejectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={rejectMutation.isPending || !rejectionReason.trim()}
              onClick={submitReject}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject KYC"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
