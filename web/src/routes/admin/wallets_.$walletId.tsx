import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2, History, Unlock, Snowflake } from "lucide-react";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { WalletCard, walletDisplayName } from "@/components/admin/WalletCard";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiClient, ApiError } from "@/lib/api";
import { adminLiveQueryOptions } from "@/lib/refresh";
import { formatDateTime, formatNPR } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { canWalletAdjust } from "@/lib/account-status";

export const Route = createFileRoute("/admin/wallets_/$walletId")({
  head: () => ({
    meta: [
      { title: "Wallet Details — MySewa Admin" },
      {
        name: "description",
        content: "View complete MySewa business wallet details including balance and account owner.",
      },
      { property: "og:title", content: "Wallet Details — MySewa Admin" },
    ],
  }),
  component: WalletDetailPage,
});

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border py-3 last:border-0 md:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] md:gap-4">
      <dt className="min-w-0 break-words text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-sm font-medium">{children}</dd>
    </div>
  );
}

function WalletDetailPage() {
  const { walletId } = Route.useParams();
  const id = Number(walletId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { user } = useAuth();
  const allowAdjust = canWalletAdjust(user);
  const walletQuery = useQuery({
    queryKey: ["admin", "wallets", id],
    queryFn: () => apiClient.adminGetWallet(id),
    enabled: Number.isFinite(id),
    ...adminLiveQueryOptions(),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.adminDeleteWallet(id),
    onSuccess: () => {
      toast.success("Wallet deleted");
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
      navigate({ to: "/admin/wallets" });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not delete wallet");
    },
  });

  const unblockMutation = useMutation({
    mutationFn: () => apiClient.adminUnblockWallet(id),
    onSuccess: (res) => {
      toast.success(res.message || "Wallet unblocked");
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not unblock wallet");
    },
  });

  const freezeMutation = useMutation({
    mutationFn: () => apiClient.adminFreezeWallet(id),
    onSuccess: (res) => {
      toast.success(res.message || "Wallet frozen");
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not freeze wallet");
    },
  });

  const unfreezeMutation = useMutation({
    mutationFn: () => apiClient.adminUnfreezeWallet(id),
    onSuccess: (res) => {
      toast.success(res.message || "Wallet unfrozen");
      queryClient.invalidateQueries({ queryKey: ["admin", "wallets"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not unfreeze wallet");
    },
  });

  const w = walletQuery.data;
  const name = w ? walletDisplayName(w) : "";

  return (
    <AdminShell
      title={w ? name : "Wallet"}
      description={w ? `Wallet #${w.id}` : walletQuery.isLoading ? "Loading…" : "Not found"}
      actions={
        w ? (
          <div className="flex shrink-0 items-center gap-2 [&>*]:shrink-0">
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/wallets/$walletId/transactions" params={{ walletId }}>
                <History className="size-3.5" />
                View Transaction History
              </Link>
            </Button>
            {w.transactions_blocked ? (
              <Button
                size="sm"
                variant="outline"
                disabled={unblockMutation.isPending}
                onClick={() => unblockMutation.mutate()}
              >
                <Unlock className="size-3.5" />
                {unblockMutation.isPending ? "Unblocking…" : "Unblock wallet"}
              </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant={w.is_frozen ? "outline" : "destructive"}
                  disabled={freezeMutation.isPending || unfreezeMutation.isPending}
                >
                  <Snowflake className="size-3.5" />
                  {w.is_frozen ? "Unfreeze wallet" : "Wallet Freeze"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {w.is_frozen ? "Unfreeze this wallet?" : "Freeze this wallet?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {w.is_frozen
                      ? "Unfreezing restores remittance, fund transfer, and other wallet transactions."
                      : "A frozen wallet cannot debit or credit. Remittance and fund transfers will be blocked until you unfreeze it."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      w.is_frozen ? unfreezeMutation.mutate() : freezeMutation.mutate()
                    }
                  >
                    {w.is_frozen ? "Unfreeze" : "Freeze"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {allowAdjust ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/wallets/$walletId/edit" params={{ walletId }}>
                <Pencil className="size-3.5" />
                Add Fund / Adjust
              </Link>
            </Button>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={deleteMutation.isPending}>
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this wallet?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the wallet for {name} ({w.phone}). The balance will be
                    lost. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteMutation.mutate()}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : undefined
      }
    >
      <div className="mb-5">
        <BackButton to="/admin/wallets" label="Back to wallets" />
      </div>

      {walletQuery.isError && (
        <p className="text-sm text-muted-foreground">
          {walletQuery.error instanceof ApiError ? walletQuery.error.message : "Wallet not found."}
        </p>
      )}

      {w && (
        <div className="space-y-6">
          <WalletCard
            size="lg"
            balance={w.balance}
            title="Wallet balance"
            subtitle={`${name} · ${w.phone}`}
          />

          <div className="min-w-0 overflow-x-clip rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-1 text-sm font-semibold">Wallet information</h2>
            <p className="mb-3 text-sm text-muted-foreground">Full record for this user wallet.</p>
            <dl>
              <DetailRow label="Wallet ID">{w.id}</DetailRow>
              <DetailRow label="User ID">
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: String(w.user_id) }}
                  className="text-brand underline-offset-2 hover:underline"
                >
                  #{w.user_id}
                </Link>
              </DetailRow>
              <DetailRow label="Name">{name}</DetailRow>
              <DetailRow label="Phone">{w.phone}</DetailRow>
              <DetailRow label="First name">{w.first_name || "—"}</DetailRow>
              <DetailRow label="Last name">{w.last_name || "—"}</DetailRow>
              <DetailRow label="Balance">
                <span className="tabular">{formatNPR(w.balance)}</span>
              </DetailRow>
              <DetailRow label="Wallet status">
                <span className={w.is_frozen ? "text-destructive" : ""}>
                  {w.is_frozen ? "Frozen" : "Active / Unfrozen"}
                </span>
              </DetailRow>
              {w.freeze_reason ? (
                <DetailRow label="Freeze reason">{w.freeze_reason}</DetailRow>
              ) : null}
              <DetailRow label="Transactions">
                {w.transactions_blocked ? (
                  <span className="text-destructive">
                    Locked
                    {w.blocked_reason ? ` — ${w.blocked_reason}` : ""}
                  </span>
                ) : (
                  "Allowed"
                )}
              </DetailRow>
              {w.blocked_at ? (
                <DetailRow label="Locked at">{formatDateTime(w.blocked_at)}</DetailRow>
              ) : null}
              {w.blocked_merchant_txn_id ? (
                <DetailRow label="Lock txn">{w.blocked_merchant_txn_id}</DetailRow>
              ) : null}
              <DetailRow label="Created at">{formatDateTime(w.created_at)}</DetailRow>
              <DetailRow label="Updated at">{formatDateTime(w.updated_at)}</DetailRow>
            </dl>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
