import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PortalShell } from "@/components/layout/PortalShell";
import { NetworkPersonForm } from "@/components/dealer/NetworkPersonForm";
import {
  AdminDataList,
  AdminEmptyState,
  AdminMobileCard,
  AdminMobileCardGrid,
  AdminMobileMeta,
} from "@/components/admin/AdminDataList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR } from "@/lib/format";
import { adminLiveQueryOptions } from "@/lib/refresh";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dealer/customers")({
  head: () => ({ meta: [{ title: "My Customers — Dealer Portal" }] }),
  component: DealerCustomersPage,
});

function DealerCustomersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ["dealer", "customers", q],
    queryFn: () => apiClient.dealerCustomers({ q }),
    ...adminLiveQueryOptions(),
  });
  const createMutation = useMutation({
    mutationFn: apiClient.dealerCreateCustomer,
    onSuccess: () => {
      toast.success("Customer created");
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ["dealer", "customers"] });
      queryClient.invalidateQueries({ queryKey: ["dealer", "dashboard"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not create customer"),
  });
  const freezeMutation = useMutation({
    mutationFn: ({ id, frozen }: { id: number; frozen: boolean }) =>
      frozen ? apiClient.dealerUnfreezeUser(id) : apiClient.dealerFreezeUser(id),
    onSuccess: (_, vars) => {
      toast.success(vars.frozen ? "Wallet unfrozen" : "Wallet frozen");
      queryClient.invalidateQueries({ queryKey: ["dealer"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not update wallet"),
  });
  const items = query.data?.items ?? [];
  const canManageWallet = user?.role === "dealer";

  if (creating) {
    return (
      <PortalShell
        title="Add customer"
        description="The customer is mapped to your Dealer account automatically."
      >
        <div className="max-w-xl rounded-xl border border-border bg-surface p-4">
          <NetworkPersonForm
            title="New customer"
            submitLabel="Create customer"
            submitting={createMutation.isPending}
            onSubmit={(payload) => createMutation.mutate(payload)}
            onCancel={() => setCreating(false)}
          />
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      title="My Customers"
      description="Customers in your network"
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Add customer
        </Button>
      }
    >
      <div className="mb-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search phone, name, email"
        />
      </div>
      <AdminDataList
        isEmpty={!query.isLoading && items.length === 0}
        empty={<AdminEmptyState>No customers in your network yet.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Sub-Agent</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>Status</TableHead>
                {canManageWallet ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.phone}</TableCell>
                  <TableCell>
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell>{u.assigned_sub_agent?.phone || "—"}</TableCell>
                  <TableCell className="tabular">{formatNPR(u.wallet_balance)}</TableCell>
                  <TableCell>
                    <Badge variant={u.wallet_frozen ? "secondary" : "default"}>
                      {u.wallet_frozen
                        ? "Frozen"
                        : u.account_status === "approved"
                          ? "Active"
                          : "Pending"}
                    </Badge>
                  </TableCell>
                  {canManageWallet ? (
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          freezeMutation.mutate({ id: u.id, frozen: !!u.wallet_frozen })
                        }
                      >
                        {u.wallet_frozen ? "Unfreeze" : "Freeze"}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        mobile={
          <AdminMobileCardGrid>
            {items.map((u) => (
              <AdminMobileCard key={u.id}>
                <p className="text-sm font-semibold">{u.phone}</p>
                <AdminMobileMeta
                  items={[
                    {
                      label: "Name",
                      value: [u.first_name, u.last_name].filter(Boolean).join(" ") || "—",
                    },
                    { label: "Wallet", value: formatNPR(u.wallet_balance) },
                  ]}
                />
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />
    </PortalShell>
  );
}
