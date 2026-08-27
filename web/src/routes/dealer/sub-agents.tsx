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

export const Route = createFileRoute("/dealer/sub-agents")({
  head: () => ({ meta: [{ title: "My Sub-Agents — Dealer Portal" }] }),
  component: DealerSubAgentsPage,
});

function DealerSubAgentsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ["dealer", "sub-agents", q],
    queryFn: () => apiClient.dealerSubAgents({ q }),
    ...adminLiveQueryOptions(),
  });
  const createMutation = useMutation({
    mutationFn: apiClient.dealerCreateSubAgent,
    onSuccess: () => {
      toast.success("Sub-Agent created");
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ["dealer"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not create Sub-Agent"),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      apiClient.dealerUpdateSubAgent(id, { is_active }),
    onSuccess: () => {
      toast.success("Status updated");
      queryClient.invalidateQueries({ queryKey: ["dealer", "sub-agents"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not update Sub-Agent"),
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
  const resetMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      apiClient.dealerUpdateSubAgent(id, { password, password2: password }),
    onSuccess: () => toast.success("Password reset"),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not reset password"),
  });
  const items = query.data?.items ?? [];
  const canFreeze = user?.role === "dealer";

  if (creating) {
    return (
      <PortalShell
        title="Add Sub-Agent"
        description="The Sub-Agent is assigned to your Dealer account automatically."
      >
        <div className="max-w-xl rounded-xl border border-border bg-surface p-4">
          <NetworkPersonForm
            title="New Sub-Agent"
            submitLabel="Create Sub-Agent"
            includeCommission
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
      title="My Sub-Agents"
      description="Downline agents in your network"
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Add Sub-Agent
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
        empty={<AdminEmptyState>No Sub-Agents yet.</AdminEmptyState>}
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.phone}</TableCell>
                  <TableCell>
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell>{u.role}</TableCell>
                  <TableCell className="tabular">{formatNPR(u.wallet_balance)}</TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? "default" : "secondary"}>
                      {u.wallet_frozen ? "Frozen" : u.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => statusMutation.mutate({ id: u.id, is_active: !u.is_active })}
                    >
                      {u.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    {canFreeze ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          freezeMutation.mutate({ id: u.id, frozen: !!u.wallet_frozen })
                        }
                      >
                        {u.wallet_frozen ? "Unfreeze" : "Freeze"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const password = window.prompt("New password (min 8 characters)");
                        if (password && password.length >= 8) {
                          resetMutation.mutate({ id: u.id, password });
                        }
                      }}
                    >
                      Reset password
                    </Button>
                  </TableCell>
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
