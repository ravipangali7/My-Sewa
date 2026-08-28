import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { Badge } from "@/components/ui/badge";
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
import { adminLiveQueryOptions } from "@/lib/refresh";
import type { DealerPayoutAccount } from "@/lib/types";

export const Route = createFileRoute("/admin/payout-accounts")({
  head: () => ({
    meta: [
      { title: "Dealer Payout Accounts — MySewa Admin" },
      {
        name: "description",
        content: "Approve or reject Dealer eSewa, Khalti, and bank payout accounts.",
      },
    ],
  }),
  component: AdminPayoutAccountsPage,
});

function AdminPayoutAccountsPage() {
  const queryClient = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<DealerPayoutAccount | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const query = useQuery({
    queryKey: ["admin", "payout-accounts"],
    queryFn: () => apiClient.adminPayoutAccounts(),
    ...adminLiveQueryOptions(),
  });
  const approveMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminApprovePayoutAccount(id),
    onSuccess: () => {
      toast.success("Payout account approved");
      queryClient.invalidateQueries({ queryKey: ["admin", "payout-accounts"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not approve payout account"),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, rejection_reason }: { id: number; rejection_reason: string }) =>
      apiClient.adminRejectPayoutAccount(id, { rejection_reason }),
    onSuccess: () => {
      toast.success("Payout account rejected");
      setRejectTarget(null);
      setRejectionReason("");
      queryClient.invalidateQueries({ queryKey: ["admin", "payout-accounts"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not reject payout account"),
  });
  const items = query.data?.items ?? [];

  return (
    <AdminShell
      title="Dealer payout accounts"
      description="Approve eSewa, Khalti, and bank accounts dealers use to load assigned user wallets."
    >
      <AdminDataList
        isEmpty={!query.isLoading && items.length === 0}
        empty={<AdminEmptyState>No dealer payout accounts yet.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dealer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Number / ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{a.dealer_phone}</p>
                      <p className="text-xs text-muted-foreground">{a.dealer_name}</p>
                    </div>
                  </TableCell>
                  <TableCell>{a.method_display}</TableCell>
                  <TableCell>{a.account_name}</TableCell>
                  <TableCell>{a.account_number}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "approved" ? "default" : "secondary"}>
                      {a.status === "approved" ? "Active" : a.status === "rejected" ? "Rejected" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    {a.status !== "approved" ? (
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate(a.id)}
                        disabled={approveMutation.isPending}
                      >
                        Approve
                      </Button>
                    ) : null}
                    {a.status !== "rejected" ? (
                      <Button size="sm" variant="outline" onClick={() => setRejectTarget(a)}>
                        Reject
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {items.map((a) => (
              <AdminMobileCard key={a.id}>
                <p className="text-sm font-semibold">{a.dealer_phone}</p>
                <AdminMobileMeta
                  items={[
                    { label: "Type", value: a.method_display },
                    { label: "Account", value: a.account_name },
                    { label: "Number", value: a.account_number },
                    { label: "Status", value: a.status_display },
                  ]}
                />
                <div className="mt-3 flex gap-2">
                  {a.status !== "approved" ? (
                    <Button size="sm" onClick={() => approveMutation.mutate(a.id)}>
                      Approve
                    </Button>
                  ) : null}
                  {a.status !== "rejected" ? (
                    <Button size="sm" variant="outline" onClick={() => setRejectTarget(a)}>
                      Reject
                    </Button>
                  ) : null}
                </div>
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />

      <Dialog open={Boolean(rejectTarget)} onOpenChange={() => setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject payout account</DialogTitle>
            <DialogDescription>
              The dealer will be emailed and must edit the account to resubmit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
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
    </AdminShell>
  );
}
