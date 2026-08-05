import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FileImage, ImageIcon } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { ListPageToolbar } from "@/components/list/ListPageToolbar";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import type { KycSubmission } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { serialNumber } from "@/lib/serial";
import { useListFilters, DEPOSIT_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";

const LIST_PAGE = 1;
const LIST_PAGE_SIZE = 50;

export const Route = createFileRoute("/admin/kyc")({
  head: () => ({
    meta: [
      { title: "KYC Approvals — MySewa Admin" },
      {
        name: "description",
        content:
          "Review MySewa KYC submissions with identity documents and approve or reject verification.",
      },
      { property: "og:title", content: "KYC Approvals — MySewa Admin" },
      { property: "og:description", content: "Pending KYC queue with approve and reject actions." },
    ],
  }),
  component: KycPage,
});

function displayName(s: KycSubmission) {
  const name = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  return name || s.phone;
}

function docThumb(s: KycSubmission) {
  const first = s.documents?.[0];
  const url = first?.file_url || first?.file;
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-center gap-2"
        title="Open document"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={url}
          alt={`KYC #${s.id} document`}
          className="size-12 rounded-md border border-border object-cover shadow-sm transition-opacity group-hover:opacity-90"
        />
        <span className="text-xs text-brand group-hover:underline">
          {s.documents.length > 1 ? `${s.documents.length} docs` : "View"}
        </span>
      </a>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span className="flex size-12 items-center justify-center rounded-md bg-muted">
        <ImageIcon className="size-4" />
      </span>
      —
    </span>
  );
}

function KycPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { filters, setFilters, debounced } = useListFilters();
  const [exporting, setExporting] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<KycSubmission | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const kycQuery = useQuery({
    queryKey: ["admin", "kyc", debounced],
    queryFn: () => apiClient.adminKyc(debounced),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const visible = kycQuery.data?.items ?? [];
  const kycStats = kycQuery.data?.stats;

  const invalidateKycQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminApproveKyc(id),
    onSuccess: (_res, id) => {
      toast.success(`KYC #${id} approved — user verified`);
      invalidateKycQueries();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Approve failed");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, rejection_reason }: { id: number; rejection_reason: string }) =>
      apiClient.adminRejectKyc(id, { rejection_reason }),
    onSuccess: (_res, vars) => {
      toast.error(`KYC #${vars.id} rejected`);
      setRejectTarget(null);
      setRejectionReason("");
      invalidateKycQueries();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Reject failed");
    },
  });

  const openRejectDialog = (submission: KycSubmission) => {
    setRejectTarget(submission);
    setRejectionReason("");
  };

  const closeRejectDialog = (open: boolean) => {
    if (!open) {
      setRejectTarget(null);
      setRejectionReason("");
    }
  };

  const submitReject = () => {
    if (!rejectTarget) return;
    const reason = rejectionReason.trim();
    if (!reason) {
      toast.error("Please enter a rejection reason");
      return;
    }
    rejectMutation.mutate({ id: rejectTarget.id, rejection_reason: reason });
  };

  const actionPending = approveMutation.isPending || rejectMutation.isPending;

  const openKyc = (id: number) => {
    navigate({ to: "/admin/kyc/$kycId", params: { kycId: String(id) } });
  };

  const kycActions = (s: KycSubmission) =>
    s.status === "pending" ? (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={actionPending}
          onClick={(e) => {
            e.stopPropagation();
            approveMutation.mutate(s.id);
          }}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={actionPending}
          onClick={(e) => {
            e.stopPropagation();
            openRejectDialog(s);
          }}
        >
          Reject
        </Button>
      </div>
    ) : (
      <Link
        to="/admin/kyc/$kycId"
        params={{ kycId: String(s.id) }}
        className="text-sm text-brand hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        View details
      </Link>
    );

  const filterLabel = filters.status ?? "all";

  return (
    <AdminShell title="KYC" description="Identity verification requests awaiting review">
      {kycQuery.isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">Loading KYC submissions…</p>
      )}
      {kycQuery.isError && (
        <p className="mb-4 text-sm text-destructive">
          {kycQuery.error instanceof ApiError
            ? kycQuery.error.message
            : "Could not load KYC submissions."}
        </p>
      )}

      <div className="mb-4 space-y-4">
        <ListPageToolbar
          stats={kycStats}
          filters={filters}
          onFiltersChange={setFilters}
          onExport={async () => {
            setExporting(true);
            try {
              await downloadCsvExport("/api/admin/kyc/", debounced, "admin-kyc.csv");
            } finally {
              setExporting(false);
            }
          }}
          exporting={exporting}
          searchPlaceholder="Search phone, name, citizenship…"
          exportLabel="Download CSV"
          statsLabels={{
            total: "Total",
            success: "Approved",
            pending: "Pending",
            failed: "Rejected",
          }}
          statusOptions={[...DEPOSIT_STATUS_OPTIONS]}
        />
      </div>

      <AdminDataList
        isEmpty={!kycQuery.isLoading && visible.length === 0}
        empty={
          <AdminEmptyState>
            No {filterLabel === "all" ? "" : `${filterLabel} `}KYC submissions.
          </AdminEmptyState>
        }
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pr-0">S.N.</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Citizenship no.</TableHead>
                <TableHead>Documents</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((s, index) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => openKyc(s.id)}
                >
                  <TableCell className="w-10 pr-0 tabular text-sm text-muted-foreground">
                    {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}
                  </TableCell>
                  <TableCell className="text-sm">#{s.id}</TableCell>
                  <TableCell className="text-sm">
                    <p className="font-medium">{displayName(s)}</p>
                    <p className="text-xs text-muted-foreground">{s.phone}</p>
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {s.citizenship_number || "—"}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>{docThumb(s)}</TableCell>
                  <TableCell className="text-sm">
                    {formatDateTime(s.submitted_at || s.created_at)}
                  </TableCell>
                  <TableCell>
                    <StatusChip status={s.status} compact />
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {kycActions(s)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {visible.map((s, index) => (
              <AdminMobileCard key={s.id} onClick={() => openKyc(s.id)}>
                <div className="flex items-start gap-3">
                  <span className="tabular shrink-0 pt-1 text-xs text-muted-foreground">
                    {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}.
                  </span>
                  <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const first = s.documents?.[0];
                      const url = first?.file_url || first?.file;
                      return url ? (
                        <a href={url} target="_blank" rel="noreferrer" title="Open document">
                          <img
                            src={url}
                            alt={`KYC #${s.id} document`}
                            className="size-14 rounded-lg border border-border object-cover"
                          />
                        </a>
                      ) : (
                        <span className="flex size-14 items-center justify-center rounded-lg bg-muted">
                          <FileImage className="size-5 text-muted-foreground" />
                        </span>
                      );
                    })()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{displayName(s)}</p>
                        <p className="text-xs text-muted-foreground">#{s.id} · {s.phone}</p>
                      </div>
                      <StatusChip status={s.status} compact />
                    </div>
                    <p className="mt-1.5 text-sm font-medium">
                      {s.citizenship_number || "No citizenship number"}
                    </p>
                  </div>
                </div>
                <AdminMobileMeta
                  items={[
                    {
                      label: "Submitted",
                      value: formatDateTime(s.submitted_at || s.created_at),
                    },
                    {
                      label: "Docs",
                      value: String(s.documents?.length ?? 0),
                    },
                    ...(s.status === "rejected" && s.rejection_reason
                      ? [{ label: "Reason", value: s.rejection_reason }]
                      : []),
                  ]}
                />
                <div
                  className="mt-3 border-t border-border pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {kycActions(s)}
                </div>
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />

      <Dialog open={!!rejectTarget} onOpenChange={closeRejectDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject KYC #{rejectTarget?.id}</DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `${displayName(rejectTarget)} (${rejectTarget.phone}). The user will see this reason.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="kyc-rejection-reason">Rejection reason</Label>
            <Textarea
              id="kyc-rejection-reason"
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
              onClick={() => closeRejectDialog(false)}
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
