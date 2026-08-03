import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { WalletCard, walletDisplayName } from "@/components/admin/WalletCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient, ApiError } from "@/lib/api";

export const Route = createFileRoute("/admin/wallets_/$walletId_/edit")({
  head: () => ({
    meta: [
      { title: "Edit Wallet — MySewa Admin" },
      {
        name: "description",
        content: "Update a MySewa user wallet balance.",
      },
      { property: "og:title", content: "Edit Wallet — MySewa Admin" },
    ],
  }),
  component: EditWalletPage,
});

function EditWalletPage() {
  const { walletId } = Route.useParams();
  const id = Number(walletId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [balance, setBalance] = useState("");

  const walletQuery = useQuery({
    queryKey: ["admin", "wallets", id],
    queryFn: () => apiClient.adminGetWallet(id),
    enabled: Number.isFinite(id),
  });

  useEffect(() => {
    if (walletQuery.data) {
      setBalance(walletQuery.data.balance);
    }
  }, [walletQuery.data]);

  const updateMutation = useMutation({
    mutationFn: (nextBalance: string) =>
      apiClient.adminUpdateWallet(id, { balance: nextBalance }),
    onSuccess: () => {
      toast.success("Wallet updated");
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
      navigate({ to: "/admin/wallets/$walletId", params: { walletId } });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not update wallet");
    },
  });

  const w = walletQuery.data;
  const name = w ? walletDisplayName(w) : "";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = balance.trim();
    if (!trimmed || Number.isNaN(Number(trimmed)) || Number(trimmed) < 0) {
      toast.error("Enter a valid non-negative balance");
      return;
    }
    updateMutation.mutate(trimmed);
  };

  return (
    <AdminShell
      title="Edit wallet"
      description={w ? `${name} · #${w.id}` : walletQuery.isLoading ? "Loading…" : "Not found"}
    >
      <div className="mb-5">
        <BackButton
          to="/admin/wallets/$walletId"
          params={{ walletId }}
          label="Back to wallet"
        />
      </div>

      {walletQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {walletQuery.error instanceof ApiError ? walletQuery.error.message : "Wallet not found."}
        </p>
      )}

      {w && (
        <div className="space-y-6">
          <WalletCard
            balance={balance || w.balance}
            title="Preview balance"
            subtitle={`${name} · ${w.phone}`}
          />

          <form
            className="space-y-5 rounded-xl border border-border bg-surface p-5"
            onSubmit={handleSubmit}
          >
            <div className="space-y-1.5">
              <Label htmlFor="balance">Balance (NPR)</Label>
              <Input
                id="balance"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Directly sets the wallet balance. Use carefully — this does not create a deposit or
                transfer record.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
              <Button asChild type="button" variant="ghost">
                <Link to="/admin/wallets/$walletId" params={{ walletId }}>
                  Cancel
                </Link>
              </Button>
            </div>
          </form>
        </div>
      )}
    </AdminShell>
  );
}
