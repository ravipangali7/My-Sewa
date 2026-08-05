import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ImageIcon } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { ListPageToolbar } from "@/components/list/ListPageToolbar";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { StatsCards, amountSummaryCards } from "@/components/admin/StatsCards";
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
import type { Deposit } from "@/lib/types";
import { formatNPR, formatDateTime } from "@/lib/format";
import { serialNumber } from "@/lib/serial";
import { useListFilters, DEPOSIT_STATUS_OPTIONS } from "@/hooks/use-list-filters";
import { downloadCsvExport } from "@/lib/list-query";

const LIST_PAGE = 1;
const LIST_PAGE_SIZE = 50;

export const Route = createFileRoute("/admin/deposits")({
  head: () => ({
    meta: [
      { title: "Deposit Approvals — MySewa Admin" },
      {
        name: "description",
        content:
          "Review MySewa deposit requests with screenshot proof and approve or reject to credit user wallets.",
      },
      { property: "og:title", content: "Deposit Approvals — MySewa Admin" },
      { property: "og:description", content: "Pending deposit queue with approve and reject actions." },
    ],
  }),
  component: DepositsPage,
});

function DepositsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { filters, setFilters, debounced } = useListFilters();
  const [exporting, setExporting] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<Deposit | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const depositsQuery = useQuery({
    queryKey: ["admin", "deposits", debounced],
    queryFn: () => apiClient.adminDeposits(debounced),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const visible = depositsQuery.data?.items ?? [];
  const depositStats = depositsQuery.data?.stats;
  const amountCards = amountSummaryCards(depositsQuery.data?.summary, {
    keys: ["total_volume", "total_credit", "total_amount", "today_amount", "monthly_amount"],
    labels: {
      total_credit: "Total credit (approved)",
      total_amount: "Approved amount",
    },
  });

  const invalidateDepositQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "deposits"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminApproveDeposit(id),
    onSuccess: (_res, id) => {
      toast.success(`Deposit #${id} approved — wallet credited`);
      invalidateDepositQueries();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Approve failed");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, rejection_reason }: { id: number; rejection_reason: string }) =>
      apiClient.adminRejectDeposit(id, { rejection_reason }),
    onSuccess: (_res, vars) => {
      toast.error(`Deposit #${vars.id} rejected`);
      setRejectTarget(null);
      setRejectionReason("");
      invalidateDepositQueries();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Reject failed");
    },
  });

  const openRejectDialog = (deposit: Deposit) => {
    setRejectTarget(deposit);
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

  const openDeposit = (id: number) => {
    navigate({ to: "/admin/deposits/$depositId", params: { depositId: String(id) } });
  };

  const depositActions = (d: Deposit) =>
    d.status === "pending" ? (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={actionPending}
          onClick={(e) => {
            e.stopPropagation();
            approveMutation.mutate(d.id);
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
            openRejectDialog(d);
          }}
        >
          Reject
        </Button>
      </div>
    ) : (
      <Link
        to="/admin/deposits/$depositId"
        params={{ depositId: String(d.id) }}
        className="text-sm text-brand hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        View details
      </Link>
    );

  const proofThumb = (d: Deposit) =>
    d.screenshot_proof ? (
      <a
        href={d.screenshot_proof}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-center gap-2"
        title="Open full-size proof"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={d.screenshot_proof}
          alt={`Deposit #${d.id} proof`}
          className="size-12 rounded-md border border-border object-cover shadow-sm transition-opacity group-hover:opacity-90"
        />
        <span className="text-xs text-brand group-hover:underline">View</span>
      </a>
    ) : (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <span className="flex size-12 items-center justify-center rounded-md bg-muted">
          <ImageIcon className="size-4" />
        </span>
        —
      </span>
    );

  const filterLabel = filters.status ?? "all";

  return (
    <AdminShell
      title="Deposits"
      description="Remittance / load requests awaiting review"
    >
      {depositsQuery.isLoading && (
        <p className="mb-4 text-sm text-muted-foreground">Loading deposits…</p>
      )}
      {depositsQuery.isError && (
        <p className="mb-4 text-sm text-destructive">
          {depositsQuery.error instanceof ApiError
            ? depositsQuery.error.message
            : "Could not load deposits."}
        </p>
      )}

      <div className="mb-4 space-y-4">
        <StatsCards items={amountCards} />
        <ListPageToolbar
          stats={depositStats}
          filters={filters}
          onFiltersChange={setFilters}
          onExport={async () => {
            setExporting(true);
            try {
              await downloadCsvExport("/api/admin/deposits/", debounced, "admin-deposits.csv");
            } finally {
              setExporting(false);
            }
          }}
          exporting={exporting}
          searchPlaceholder="Search phone, note, ID…"
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
        isEmpty={!depositsQuery.isLoading && visible.length === 0}
        empty={
          <AdminEmptyState>
            No {filterLabel === "all" ? "" : `${filterLabel} `}deposits.
          </AdminEmptyState>
        }
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pr-0">S.N.</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>User phone</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Screenshot proof</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Created at</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((d, index) => (
                <TableRow
                  key={d.id}
                  className="cursor-pointer"
                  onClick={() => openDeposit(d.id)}
                >
                  <TableCell className="w-10 pr-0 tabular text-sm text-muted-foreground">
                    {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}
                  </TableCell>
                  <TableCell className="text-sm">#{d.id}</TableCell>
                  <TableCell className="text-sm font-medium">{d.phone}</TableCell>
                  <TableCell className="tabular text-right text-sm font-semibold">
                    {formatNPR(d.amount)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>{proofThumb(d)}</TableCell>
                  <TableCell className="max-w-55 text-sm text-muted-foreground">
                    {d.status === "rejected" && d.rejection_reason ? (
                      <div className="space-y-0.5">
                        <p>{d.note ?? "—"}</p>
                        <p className="text-destructive">Rejected: {d.rejection_reason}</p>
                      </div>
                    ) : (
                      (d.note ?? "—")
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{formatDateTime(d.created_at)}</TableCell>
                  <TableCell>
                    <StatusChip status={d.status} compact />
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {depositActions(d)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {visible.map((d, index) => (
              <AdminMobileCard key={d.id} onClick={() => openDeposit(d.id)}>
                <div className="flex items-start gap-3">
                  <span className="tabular shrink-0 pt-1 text-xs text-muted-foreground">
                    {serialNumber(LIST_PAGE, LIST_PAGE_SIZE, index)}.
                  </span>
                  <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    {d.screenshot_proof ? (
                      <a
                        href={d.screenshot_proof}
                        target="_blank"
                        rel="noreferrer"
                        title="Open full-size proof"
                      >
                        <img
                          src={d.screenshot_proof}
                          alt={`Deposit #${d.id} proof`}
                          className="size-14 rounded-lg border border-border object-cover"
                        />
                      </a>
                    ) : (
                      <span className="flex size-14 items-center justify-center rounded-lg bg-muted">
                        <ImageIcon className="size-5 text-muted-foreground" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{d.phone}</p>
                        <p className="text-xs text-muted-foreground">#{d.id}</p>
                      </div>
                      <StatusChip status={d.status} compact />
                    </div>
                    <p className="tabular mt-1.5 text-lg font-semibold">{formatNPR(d.amount)}</p>
                  </div>
                </div>
                <AdminMobileMeta
                  items={[
                    { label: "Created", value: formatDateTime(d.created_at) },
                    {
                      label: "Note",
                      value:
                        d.status === "rejected" && d.rejection_reason
                          ? d.rejection_reason
                          : d.note || "—",
                    },
                  ]}
                />
                <div
                  className="mt-3 border-t border-border pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {depositActions(d)}
                </div>
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />

      <Dialog open={!!rejectTarget} onOpenChange={closeRejectDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject deposit #{rejectTarget?.id}</DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `${formatNPR(rejectTarget.amount)} from ${rejectTarget.phone}. The user will see this reason.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="rejection-reason">Rejection reason</Label>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Screenshot unclear / amount mismatch"
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
              {rejectMutation.isPending ? "Rejecting…" : "Reject deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
