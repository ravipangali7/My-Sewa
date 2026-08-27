import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
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
import { useState } from "react";

export const Route = createFileRoute("/admin/dealers")({
  head: () => ({
    meta: [
      { title: "Dealers — MySewa Admin" },
      { name: "description", content: "Create and manage Dealers, wallets, commission and TDS." },
    ],
  }),
  component: AdminDealersPage,
});

function AdminDealersPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["admin", "users", "dealers", q],
    queryFn: () => apiClient.adminUsers({ role: "dealer", q }),
    ...adminLiveQueryOptions(),
  });
  const freezeMutation = useMutation({
    mutationFn: ({ walletId, frozen }: { walletId: number; frozen: boolean }) =>
      frozen ? apiClient.adminUnfreezeWallet(walletId) : apiClient.adminFreezeWallet(walletId),
    onSuccess: (_, vars) => {
      toast.success(vars.frozen ? "Dealer wallet unfrozen" : "Dealer wallet frozen");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not update wallet"),
  });
  const items = query.data?.items ?? [];

  return (
    <AdminShell
      title="Dealers"
      description="Super Admin dealer management"
      dense
      actions={
        <Button asChild size="sm">
          <Link to="/admin/users/new">
            <Plus className="size-4" /> Create dealer
          </Link>
        </Button>
      }
    >
      <div className="mb-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dealers" />
      </div>
      <AdminDataList
        isEmpty={!query.isLoading && items.length === 0}
        empty={
          <AdminEmptyState>
            No dealers yet. Create one from New user and set Role = Dealer.
          </AdminEmptyState>
        }
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>TDS</TableHead>
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
                  <TableCell className="tabular">{formatNPR(u.wallet_balance)}</TableCell>
                  <TableCell>{u.commission_rate ?? "0"}%</TableCell>
                  <TableCell>{u.tds_rate ?? "Global"}%</TableCell>
                  <TableCell>
                    <Badge variant={u.is_active && !u.wallet_frozen ? "default" : "secondary"}>
                      {u.wallet_frozen ? "Frozen" : u.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/users/$userId" params={{ userId: String(u.id) }}>
                        View
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/users/$userId/edit" params={{ userId: String(u.id) }}>
                        Edit
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/users/$userId/report" params={{ userId: String(u.id) }}>
                        Report
                      </Link>
                    </Button>
                    {u.wallet_id ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={freezeMutation.isPending}
                        onClick={() =>
                          freezeMutation.mutate({
                            walletId: u.wallet_id as number,
                            frozen: Boolean(u.wallet_frozen),
                          })
                        }
                      >
                        {u.wallet_frozen ? "Unfreeze" : "Freeze"}
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
            {items.map((u) => (
              <AdminMobileCard key={u.id}>
                <p className="text-sm font-semibold">{u.phone}</p>
                <AdminMobileMeta
                  items={[
                    { label: "Wallet", value: formatNPR(u.wallet_balance) },
                    { label: "Commission", value: `${u.commission_rate ?? "0"}%` },
                  ]}
                />
                <div className="mt-3">
                  <Button asChild size="sm">
                    <Link to="/admin/users/$userId" params={{ userId: String(u.id) }}>
                      Open
                    </Link>
                  </Button>
                </div>
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />
    </AdminShell>
  );
}
