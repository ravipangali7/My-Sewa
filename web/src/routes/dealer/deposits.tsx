import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { PortalShell } from "@/components/layout/PortalShell";
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
import { formatNPR, formatDateTime } from "@/lib/format";
import { adminLiveQueryOptions } from "@/lib/refresh";
import type { Deposit } from "@/lib/types";

export const Route = createFileRoute("/dealer/deposits")({
  head: () => ({ meta: [{ title: "Wallet Loads — Dealer Portal" }] }),
  component: DealerDepositsPage,
});

function DealerDepositsPage() {
  const queryClient = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<Deposit | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const query = useQuery({
    queryKey: ["dealer", "deposits"],
    queryFn: () => apiClient.dealerDeposits(),
    ...adminLiveQueryOptions(),
  });
  const approveMutation = useMutation({
    mutationFn: (id: number) => apiClient.dealerApproveDeposit(id),
    onSuccess: (_res, id) => {
      toast.success(`Deposit #${id} approved — wallet credited`);
      queryClient.invalidateQueries({ queryKey: ["dealer"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Approve failed"),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, rejection_reason }: { id: number; rejection_reason: string }) =>
      apiClient.dealerRejectDeposit(id, { rejection_reason }),
    onSuccess: () => {
      toast.success("Deposit rejected");
      setRejectTarget(null);
      setRejectionReason("");
      queryClient.invalidateQueries({ queryKey: ["dealer", "deposits"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Reject failed"),
  });
  const items = query.data?.items ?? [];

  return (
    <PortalShell
      title="Wallet loads"
      description="Approve deposit requests from users assigned to you after they pay your payout account."
    >
      <AdminDataList
        isEmpty={!query.isLoading && items.length === 0}
        empty={<AdminEmptyState>No wallet load requests yet.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Txn ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.phone}</TableCell>
                  <TableCell className="tabular">{formatNPR(d.amount)}</TableCell>
                  <TableCell>{d.transaction_id || "—"}</TableCell>
                  <TableCell>
                    <StatusChip status={d.status} />
                  </TableCell>
                  <TableCell>
                    {d.status === "pending" ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => approveMutation.mutate(d.id)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRejectTarget(d)}>
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {items.map((d) => (
              <AdminMobileCard key={d.id}>
                <p className="text-sm font-semibold">{d.phone}</p>
                <AdminMobileMeta
                  items={[
                    { label: "Amount", value: formatNPR(d.amount) },
                    { label: "Txn", value: d.transaction_id || "—" },
                    { label: "When", value: formatDateTime(d.created_at) },
                  ]}
                />
                <div className="mt-2">
                  <StatusChip status={d.status} />
                </div>
                {d.status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => approveMutation.mutate(d.id)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRejectTarget(d)}>
                      Reject
                    </Button>
                  </div>
                ) : null}
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />

      <Dialog open={Boolean(rejectTarget)} onOpenChange={() => setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject deposit</DialogTitle>
            <DialogDescription>Explain why this wallet load is rejected.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="d-reject">Reason</Label>
            <Textarea
              id="d-reject"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!rejectionReason.trim() || rejectMutation.isPending}
              onClick={() => {
                if (!rejectTarget) return;
                rejectMutation.mutate({
                  id: rejectTarget.id,
                  rejection_reason: rejectionReason.trim(),
                });
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalShell>
  );
}
