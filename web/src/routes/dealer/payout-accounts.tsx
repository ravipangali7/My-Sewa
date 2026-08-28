import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PortalShell } from "@/components/layout/PortalShell";
import {
  PayoutAccountForm,
  payoutAccountFormData,
} from "@/components/dealer/PayoutAccountForm";
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

export const Route = createFileRoute("/dealer/payout-accounts")({
  head: () => ({ meta: [{ title: "Payout Accounts — Dealer Portal" }] }),
  component: DealerPayoutAccountsPage,
});

function DealerPayoutAccountsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<DealerPayoutAccount | null | "new">(null);
  const query = useQuery({
    queryKey: ["dealer", "payout-accounts"],
    queryFn: () => apiClient.dealerPayoutAccounts(),
    ...adminLiveQueryOptions(),
  });
  const saveMutation = useMutation({
    mutationFn: (vars: { id?: number; form: FormData }) =>
      vars.id
        ? apiClient.dealerUpdatePayoutAccount(vars.id, vars.form)
        : apiClient.dealerCreatePayoutAccount(vars.form),
    onSuccess: () => {
      toast.success("Payout account submitted for Admin approval");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["dealer", "payout-accounts"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not save payout account"),
  });
  const items = query.data?.items ?? [];

  if (editing) {
    const initial = editing === "new" ? null : editing;
    return (
      <PortalShell
        title={initial ? "Edit payout account" : "Add payout account"}
        description="eSewa, Khalti, or bank details plus QR. Status returns to Pending until Admin approval."
      >
        <div className="max-w-xl rounded-xl border border-border bg-surface p-4">
          <PayoutAccountForm
            initial={initial}
            submitting={saveMutation.isPending}
            onSubmit={(values) =>
              saveMutation.mutate({
                id: initial?.id,
                form: payoutAccountFormData(values),
              })
            }
            onCancel={() => setEditing(null)}
          />
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      title="Payout accounts"
      description="Collection accounts for loading assigned user wallets. Admin must approve before they become active. Accounts cannot be deleted."
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add account
        </Button>
      }
    >
      <AdminDataList
        isEmpty={!query.isLoading && items.length === 0}
        empty={<AdminEmptyState>No payout accounts yet.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
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
                  <TableCell>{a.method_display}</TableCell>
                  <TableCell>{a.account_name}</TableCell>
                  <TableCell className="font-medium">{a.account_number}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "approved" ? "default" : "secondary"}>
                      {a.status === "approved" ? "Active" : a.status === "rejected" ? "Rejected" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                      Edit
                    </Button>
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
                <p className="text-sm font-semibold">{a.account_name}</p>
                <AdminMobileMeta
                  items={[
                    { label: "Type", value: a.method_display },
                    { label: "Number", value: a.account_number },
                    {
                      label: "Status",
                      value:
                        a.status === "approved"
                          ? "Active"
                          : a.status === "rejected"
                            ? "Rejected"
                            : "Pending",
                    },
                  ]}
                />
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setEditing(a)}>
                  Edit
                </Button>
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />
    </PortalShell>
  );
}
