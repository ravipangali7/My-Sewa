import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { BackButton } from "@/components/BackButton";
import { WalletCard, walletDisplayName } from "@/components/admin/WalletCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR } from "@/lib/format";

export const Route = createFileRoute("/admin/wallets_/$walletId_/edit")({
  head: () => ({
    meta: [
      { title: "Edit Wallet — MySewa Admin" },
      {
        name: "description",
        content: "Adjust a MySewa user wallet balance with an auditable reason.",
      },
      { property: "og:title", content: "Edit Wallet — MySewa Admin" },
    ],
  }),
  component: EditWalletPage,
});

type Mode = "set_balance" | "adjust";

type PendingBody =
  | { balance: string; reason: string }
  | { amount: string; adjustment_type: "credit" | "debit"; reason: string };

function EditWalletPage() {
  const { walletId } = Route.useParams();
  const id = Number(walletId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("adjust");
  const [balance, setBalance] = useState("");
  const [amount, setAmount] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<"credit" | "debit">("credit");
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingBody, setPendingBody] = useState<PendingBody | null>(null);

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

  const previewBalance = useMemo(() => {
    const current = Number(walletQuery.data?.balance ?? 0);
    if (mode === "set_balance") {
      const next = Number(balance);
      return Number.isFinite(next) ? next.toFixed(2) : walletQuery.data?.balance ?? "0.00";
    }
    const mag = Number(amount);
    if (!Number.isFinite(mag) || mag <= 0) {
      return walletQuery.data?.balance ?? "0.00";
    }
    const next = adjustmentType === "credit" ? current + mag : current - mag;
    return next.toFixed(2);
  }, [mode, balance, amount, adjustmentType, walletQuery.data]);

  const updateMutation = useMutation({
    mutationFn: (body: PendingBody) => apiClient.adminUpdateWallet(id, body),
    onSuccess: () => {
      toast.success("Wallet adjusted");
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
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error("Reason is required for audit trail");
      return;
    }

    if (mode === "set_balance") {
      const trimmed = balance.trim();
      if (!trimmed || Number.isNaN(Number(trimmed)) || Number(trimmed) < 0) {
        toast.error("Enter a valid non-negative balance");
        return;
      }
      setPendingBody({ balance: trimmed, reason: trimmedReason });
      setConfirmOpen(true);
      return;
    }

    const trimmedAmount = amount.trim();
    if (!trimmedAmount || Number.isNaN(Number(trimmedAmount)) || Number(trimmedAmount) <= 0) {
      toast.error("Enter a positive adjustment amount");
      return;
    }
    if (adjustmentType === "debit" && Number(previewBalance) < 0) {
      toast.error("Debit would make the wallet balance negative");
      return;
    }
    setPendingBody({
      amount: trimmedAmount,
      adjustment_type: adjustmentType,
      reason: trimmedReason,
    });
    setConfirmOpen(true);
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
            balance={previewBalance}
            title="Preview balance"
            subtitle={`${name} · ${w.phone}`}
          />

          <form
            className="min-w-0 max-w-full space-y-5 rounded-xl border border-border bg-surface p-4 sm:p-5"
            onSubmit={handleSubmit}
          >
            <div className="space-y-1.5">
              <Label>Adjustment mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adjust">Credit / debit amount</SelectItem>
                  <SelectItem value="set_balance">Set absolute balance</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "adjust" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="adjustment_type">Type</Label>
                  <Select
                    value={adjustmentType}
                    onValueChange={(v) => setAdjustmentType(v as "credit" | "debit")}
                  >
                    <SelectTrigger id="adjustment_type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit">Credit (add)</SelectItem>
                      <SelectItem value="debit">Debit (subtract)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount (NPR)</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Current balance: NPR {w.balance}. Preview after adjustment: NPR {previewBalance}.
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="balance">New balance (NPR)</Label>
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
                  Sets the wallet to this balance and records the delta as a credit or debit.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this adjustment being made?"
                required
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Required. Saved with the adjustment in the user’s transaction history.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save adjustment"}
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

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPendingBody(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm wallet adjustment?</AlertDialogTitle>
            <AlertDialogDescription>
              {w
                ? `This will change ${name} (${w.phone}) from ${formatNPR(w.balance)} to ${formatNPR(previewBalance)}. User transaction PIN is not required for admin adjustments.`
                : "Confirm this balance change."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={updateMutation.isPending || !pendingBody}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingBody) return;
                updateMutation.mutate(pendingBody, {
                  onSettled: () => {
                    setConfirmOpen(false);
                    setPendingBody(null);
                  },
                });
              }}
            >
              {updateMutation.isPending ? "Saving…" : "Confirm adjustment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}
