import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ImageIcon } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import type { DepositStatus } from "@/lib/types";
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

const FILTERS: (DepositStatus | "all")[] = ["pending", "approved", "rejected", "all"];

function DepositsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<DepositStatus | "all">("pending");

  const depositsQuery = useQuery({
    queryKey: ["admin", "deposits"],
    queryFn: () => apiClient.adminDeposits(),
  });

  const visible = (depositsQuery.data ?? []).filter(
    (d) => filter === "all" || d.status === filter,
  );

  const decideMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: DepositStatus }) => {
      if (status === "approved") return apiClient.adminApproveDeposit(id);
      return apiClient.adminRejectDeposit(id);
    },
    onSuccess: (_res, vars) => {
      toast[vars.status === "approved" ? "success" : "error"](
        vars.status === "approved"
          ? `Deposit #${vars.id} approved — wallet credited`
          : `Deposit #${vars.id} rejected`,
      );
      queryClient.invalidateQueries({ queryKey: ["admin", "deposits"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Action failed");
    },
  });

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
              <TableRow key={d.id}>
                <TableCell className="text-sm">#{d.id}</TableCell>
                <TableCell className="text-sm font-medium">{d.phone}</TableCell>
                <TableCell className="tabular text-right text-sm">{formatNPR(d.amount)}</TableCell>
                <TableCell>
                  {d.screenshot_proof ? (
                    <a
                      href={d.screenshot_proof}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-brand hover:underline"
                    >
                      <span className="flex size-9 items-center justify-center rounded-md bg-muted">
                        <ImageIcon className="size-4" />
                      </span>
                      View proof
                    </a>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{d.note ?? "—"}</TableCell>
                <TableCell className="text-sm">{formatDateTime(d.created_at)}</TableCell>
                <TableCell>
                  <StatusChip status={d.status} compact />
                </TableCell>
                <TableCell className="text-right">
                  {d.status === "pending" ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: d.id, status: "approved" })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: d.id, status: "rejected" })}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {formatDateTime(d.updated_at)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!depositsQuery.isLoading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  No {filter} deposits.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AdminShell>
  );
}
