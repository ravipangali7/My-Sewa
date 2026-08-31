import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient, ApiError } from "@/lib/api";
import { amountsFromCharges, emptyServiceAmounts, SERVICE_CHARGE_OPTIONS } from "@/lib/services";

export function UserFeesForm({ userId }: { userId: number }) {
  const queryClient = useQueryClient();
  const feesQuery = useQuery({
    queryKey: ["admin", "users", userId, "fees"],
    queryFn: () => apiClient.adminGetUserFees(userId),
    enabled: Number.isFinite(userId),
  });

  const [cashback, setCashback] = useState("");
  const [charges, setCharges] = useState<Record<string, string>>(emptyServiceAmounts);

  useEffect(() => {
    if (!feesQuery.data) return;
    setCashback(String(feesQuery.data.fees.cashback_flat ?? "0.00"));
    setCharges(amountsFromCharges(feesQuery.data.service_charges));
  }, [feesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.adminUpdateUserFees(userId, {
        cashback_flat: cashback || "0",
        service_charges: SERVICE_CHARGE_OPTIONS.map((service) => ({
          txn_type: service.id,
          amount: charges[service.id] || "0",
        })),
      }),
    onSuccess: (data) => {
      toast.success("User charges updated");
      queryClient.setQueryData(["admin", "users", userId, "fees"], data);
      queryClient.invalidateQueries({ queryKey: ["admin", "commission-setup"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not update charges");
    },
  });

  if (feesQuery.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-sm text-muted-foreground">Loading charge settings…</p>
      </div>
    );
  }

  if (feesQuery.isError) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-sm text-muted-foreground">
          {feesQuery.error instanceof ApiError
            ? feesQuery.error.message
            : "Could not load charge settings."}
        </p>
      </div>
    );
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  return (
    <form
      className="rounded-xl border border-border bg-surface p-5"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Service charges</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Independent charge for each service this user pays, plus cashback credited after a
            successful transaction. Same values are edited on Commission & Charge.
          </p>
        </div>
        <Button type="submit" size="sm" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save charges"}
        </Button>
      </div>

      <div className="mt-4 max-w-xs space-y-1.5">
        <Label htmlFor={`user-cashback-${userId}`}>Cashback (Rs)</Label>
        <Input
          id={`user-cashback-${userId}`}
          type="number"
          min="0"
          step="0.01"
          value={cashback}
          onChange={(e) => setCashback(e.target.value)}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICE_CHARGE_OPTIONS.map((service) => (
          <div key={service.id} className="space-y-1.5">
            <Label htmlFor={`user-charge-${userId}-${service.id}`}>{service.label} (Rs)</Label>
            <Input
              id={`user-charge-${userId}-${service.id}`}
              type="number"
              min="0"
              step="0.01"
              value={charges[service.id] ?? ""}
              onChange={(e) =>
                setCharges((current) => ({ ...current, [service.id]: e.target.value }))
              }
            />
          </div>
        ))}
      </div>
    </form>
  );
}
