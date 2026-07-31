import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ImageIcon } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
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
import { cn } from "@/lib/utils";

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

const FILTERS: (Deposit["status"] | "all")[] = ["all", "pending", "approved", "rejected"];

function DepositsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Deposit["status"] | "all">("all");
  const [rejectTarget, setRejectTarget] = useState<Deposit | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const depositsQuery = useQuery({
    queryKey: ["admin", "deposits"],
    queryFn: () => apiClient.adminDeposits(),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const visible = (depositsQuery.data ?? []).filter(
    (d) => filter === "all" || d.status === filter,
  );

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

  return (
    <AdminShell
      title="Deposits"
      description="Remittance / load requests awaiting review"
      actions={
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize",
                filter === f ? "bg-surface text-brand-dark shadow-card" : "text-muted-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      }
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

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
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
            {visible.map((d) => (
              <TableRow
                key={d.id}
                className="cursor-pointer"
                onClick={() => openDeposit(d.id)}
              >
                <TableCell className="text-sm">#{d.id}</TableCell>
                <TableCell className="text-sm font-medium">{d.phone}</TableCell>
                <TableCell className="tabular text-right text-sm">{formatNPR(d.amount)}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {d.screenshot_proof ? (
                    <a
                      href={d.screenshot_proof}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex items-center gap-2"
                      title="Open full-size proof"
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
                  )}
                </TableCell>
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
                  {d.status === "pending" ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={actionPending}
                        onClick={() => approveMutation.mutate(d.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionPending}
                        onClick={() => openRejectDialog(d)}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <Link
                      to="/admin/deposits/$depositId"
                      params={{ depositId: String(d.id) }}
                      className="text-sm text-brand hover:underline"
                    >
                      View details
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!depositsQuery.isLoading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  No {filter === "all" ? "" : `${filter} `}deposits.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

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
