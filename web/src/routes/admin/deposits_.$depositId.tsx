import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, ApiError } from "@/lib/api";
import { formatDateTime, formatNPR } from "@/lib/format";

export const Route = createFileRoute("/admin/deposits_/$depositId")({
  head: () => ({
    meta: [
      { title: "Deposit Statement — MySewa Admin" },
      {
        name: "description",
        content: "View full deposit remittance details, proof screenshot, and approval status.",
      },
      { property: "og:title", content: "Deposit Statement — MySewa Admin" },
    ],
  }),
  component: DepositDetailPage,
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

function depositDisplayName(d: {
  first_name?: string;
  last_name?: string;
  phone: string;
}) {
  const name = [d.first_name, d.last_name].filter(Boolean).join(" ").trim();
  return name || d.phone;
}

function DepositDetailPage() {
  const { depositId } = Route.useParams();
  const id = Number(depositId);
  const queryClient = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const depositQuery = useQuery({
    queryKey: ["admin", "deposits", id],
    queryFn: () => apiClient.adminGetDeposit(id),
    enabled: Number.isFinite(id),
    refetchOnMount: "always",
  });

  const invalidateDepositQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "deposits"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
  };

  const approveMutation = useMutation({
    mutationFn: () => apiClient.adminApproveDeposit(id),
    onSuccess: () => {
      toast.success(`Deposit #${id} approved — wallet credited`);
      invalidateDepositQueries();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Approve failed");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (rejection_reason: string) =>
      apiClient.adminRejectDeposit(id, { rejection_reason }),
    onSuccess: () => {
      toast.error(`Deposit #${id} rejected`);
      setRejectOpen(false);
      setRejectionReason("");
      invalidateDepositQueries();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Reject failed");
    },
  });

  const d = depositQuery.data;
  const actionPending = approveMutation.isPending || rejectMutation.isPending;
  const accountName = d ? depositDisplayName(d) : "";

  const submitReject = () => {
    const reason = rejectionReason.trim();
    if (!reason) {
      toast.error("Please enter a rejection reason");
      return;
    }
    rejectMutation.mutate(reason);
  };

  return (
    <AdminShell
      title={d ? `Deposit #${d.id}` : "Deposit"}
      description={
        d
          ? "Remittance statement"
          : depositQuery.isLoading
            ? "Loading…"
            : "Not found"
      }
      actions={
        d?.status === "pending" ? (
          <div className="flex shrink-0 items-center gap-2 [&>*]:shrink-0">
            <Button size="sm" disabled={actionPending} onClick={() => approveMutation.mutate()}>
              Approve
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
        <BackButton to="/admin/deposits" label="Back to deposits" />
      </div>

      {depositQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {depositQuery.error instanceof ApiError
            ? depositQuery.error.message
            : "Deposit not found."}
        </p>
      )}

      {d && (
        <div className="space-y-6">
          <article className="min-w-0 overflow-x-clip rounded-2xl border border-border bg-surface shadow-card">
            <div className="border-b border-border bg-gradient-to-br from-muted/80 via-surface to-surface px-4 py-5 sm:px-6 sm:py-6 md:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    MySewa Remittance
                  </p>
                  <h2 className="mt-1 break-words text-xl font-semibold tracking-tight sm:text-2xl">
                    Deposit statement
                  </h2>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    Reference #{d.id} · Issued {formatDateTime(d.created_at)}
                  </p>
                </div>
                <StatusChip status={d.status} />
              </div>

              <div className="mt-6 min-w-0 rounded-xl border border-brand/20 bg-gradient-to-br from-brand-soft/70 via-surface to-surface px-4 py-5 text-center sm:px-5 sm:text-left">
                <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Transaction amount
                </p>
                <p className="mt-2 break-all tabular-nums text-3xl font-black tracking-tight text-brand-dark sm:text-4xl md:text-5xl">
                  {formatNPR(d.amount)}
                </p>
                <p className="mt-1.5 break-words text-sm text-muted-foreground">
                  Wallet load · {d.status_display}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
              <section className="border-b border-border px-4 py-5 sm:px-6 md:border-r md:px-8">
                <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Account holder
                </h3>
                <dl>
                  <StatementRow label="Name">{accountName}</StatementRow>
                  <StatementRow label="Phone">{d.phone}</StatementRow>
                  <StatementRow label="User ID">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: String(d.user_id) }}
                      className="text-brand underline-offset-2 hover:underline"
                    >
                      #{d.user_id}
                    </Link>
                  </StatementRow>
                </dl>
              </section>

              <section className="border-b border-border px-4 py-5 sm:px-6 md:px-8">
                <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Transaction
                </h3>
                <dl>
                  <StatementRow label="Type">Wallet remittance / load</StatementRow>
                  <StatementRow label="Status">{d.status_display}</StatementRow>
                  <StatementRow label="Submitted">{formatDateTime(d.created_at)}</StatementRow>
                  <StatementRow label="Updated">{formatDateTime(d.updated_at)}</StatementRow>
                  <StatementRow label="Balance before">
                    {d.balance_before != null ? formatNPR(d.balance_before) : "—"}
                  </StatementRow>
                  <StatementRow label="Balance after">
                    {d.balance_after != null ? formatNPR(d.balance_after) : "—"}
                  </StatementRow>
                </dl>
              </section>
            </div>

            <section className="border-b border-border px-4 py-5 sm:px-6 md:px-8">
              <h3 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Narrative
              </h3>
              <dl>
                <StatementRow label="User note">{d.note?.trim() || "—"}</StatementRow>
                {d.status === "rejected" && (
                  <StatementRow label="Rejection">
                    <span className="break-words text-destructive">{d.rejection_reason || "—"}</span>
                  </StatementRow>
                )}
              </dl>
            </section>

            <section className="px-4 py-5 sm:px-6 md:px-8">
              <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
                <h3 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  Payment proof
                </h3>
                {d.screenshot_proof && (
                  <a
                    href={d.screenshot_proof}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                  >
                    Open full size
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
              {d.screenshot_proof ? (
                <a
                  href={d.screenshot_proof}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-x-clip rounded-xl border border-border bg-muted/40"
                >
                  <img
                    src={d.screenshot_proof}
                    alt={`Deposit #${d.id} payment screenshot`}
                    className="mx-auto max-h-[min(420px,70vh)] w-full object-contain"
                  />
                </a>
              ) : (
                <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 text-muted-foreground">
                  <ImageIcon className="size-8 opacity-50" />
                  <p className="text-sm">No screenshot uploaded</p>
                </div>
              )}
            </section>

            <footer className="border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground sm:px-6 md:px-8">
              This statement summarizes the deposit request recorded in MySewa. Approval credits the
              user wallet; rejection leaves the balance unchanged.
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
            <DialogTitle>Reject deposit #{d?.id}</DialogTitle>
            <DialogDescription>
              {d ? `${formatNPR(d.amount)} from ${d.phone}. The user will see this reason.` : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="detail-rejection-reason">Rejection reason</Label>
            <Textarea
              id="detail-rejection-reason"
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
              {rejectMutation.isPending ? "Rejecting…" : "Reject deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
