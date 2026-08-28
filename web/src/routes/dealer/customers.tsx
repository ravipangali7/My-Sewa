import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PortalShell } from "@/components/layout/PortalShell";
import { NetworkPersonForm } from "@/components/dealer/NetworkPersonForm";
import { TransactionPinDialog } from "@/components/TransactionPinDialog";
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
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [loadTarget, setLoadTarget] = useState<{ id: number; phone: string } | null>(null);
  const [loadAmount, setLoadAmount] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["dealer", "customers", q],
    queryFn: () => apiClient.dealerCustomers({ q }),
    ...adminLiveQueryOptions(),
  });
  const createMutation = useMutation({
    mutationFn: apiClient.dealerCreateCustomer,
    onSuccess: () => {
      toast.success("User created — credentials emailed; waiting for Admin approval");
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
  const loadMutation = useMutation({
    mutationFn: ({
      id,
      amount,
      transaction_pin,
    }: {
      id: number;
      amount: string;
      transaction_pin: string;
    }) => apiClient.dealerLoadUserWallet(id, { amount, transaction_pin }),
    onSuccess: () => {
      toast.success("Wallet loaded from your MySewa wallet");
      setLoadTarget(null);
      setLoadAmount("");
      setPinOpen(false);
      setPinError(null);
      queryClient.invalidateQueries({ queryKey: ["dealer"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const body = err.body as Record<string, unknown>;
        const errors = body["errors"] as Record<string, string[]> | undefined;
        if (errors?.["transaction_pin"]?.[0] || body["code"] === "pin_not_set") {
          setPinError(errors?.["transaction_pin"]?.[0] || "Incorrect PIN");
          return;
        }
      }
      setPinOpen(false);
      toast.error(err instanceof ApiError ? err.message : "Could not load wallet");
    },
  });
  const items = query.data?.items ?? [];
  const canManageWallet = user?.role === "dealer";

  if (creating) {
    return (
      <PortalShell
        title="Add user"
        description="The user is mapped to your Dealer account automatically. They stay Pending until Super Admin approval; the password is emailed to them."
      >
        <div className="max-w-xl rounded-xl border border-border bg-surface p-4">
          <NetworkPersonForm
            title="New user"
            submitLabel="Create user"
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
          <Plus className="size-4" /> Add user
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
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setLoadTarget({ id: u.id, phone: u.phone });
                            setLoadAmount("");
                          }}
                        >
                          Load
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            freezeMutation.mutate({ id: u.id, frozen: !!u.wallet_frozen })
                          }
                        >
                          {u.wallet_frozen ? "Unfreeze" : "Freeze"}
                        </Button>
                      </div>
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
                    {
                      label: "Status",
                      value: u.wallet_frozen
                        ? "Frozen"
                        : u.account_status === "approved"
                          ? "Active"
                          : "Pending",
                    },
                    { label: "Sub-Agent", value: u.assigned_sub_agent?.phone || "—" },
                  ]}
                />
                {canManageWallet ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setLoadTarget({ id: u.id, phone: u.phone });
                        setLoadAmount("");
                      }}
                    >
                      Load
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => freezeMutation.mutate({ id: u.id, frozen: !!u.wallet_frozen })}
                    >
                      {u.wallet_frozen ? "Unfreeze" : "Freeze"}
                    </Button>
                  </div>
                ) : null}
              </AdminMobileCard>
            ))}
          </AdminMobileCardGrid>
        }
      />

      <Dialog
        open={Boolean(loadTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setLoadTarget(null);
            setLoadAmount("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load wallet</DialogTitle>
            <DialogDescription>
              Transfer from your MySewa wallet to {loadTarget?.phone}. This is an internal
              wallet transfer, not an external payout.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="load-amount">Amount (NPR)</Label>
            <Input
              id="load-amount"
              inputMode="decimal"
              value={loadAmount}
              onChange={(e) => setLoadAmount(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!loadAmount.trim() || Number(loadAmount) <= 0}
              onClick={() => {
                setPinError(null);
                setPinOpen(true);
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TransactionPinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        hasPin={Boolean(user?.has_transaction_pin)}
        confirming={loadMutation.isPending}
        error={pinError}
        onConfirm={(pin) => {
          if (!loadTarget) return;
          loadMutation.mutate({
            id: loadTarget.id,
            amount: loadAmount,
            transaction_pin: pin,
          });
        }}
      />
    </PortalShell>
  );
}
