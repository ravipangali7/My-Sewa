import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient, ApiError } from "@/lib/api";
import {
  emptyServiceChargeValues,
  payloadFromChargeValues,
  SERVICE_CHARGE_OPTIONS,
  valuesFromCharges,
  type ServiceChargeValue,
} from "@/lib/services";

export function UserFeesForm({ userId }: { userId: number }) {
  const queryClient = useQueryClient();
  const feesQuery = useQuery({
    queryKey: ["admin", "users", userId, "fees"],
    queryFn: () => apiClient.adminGetUserFees(userId),
    enabled: Number.isFinite(userId),
  });

  const [charges, setCharges] = useState<Record<string, ServiceChargeValue>>(emptyServiceChargeValues);
  const [cashback, setCashback] = useState("");

  useEffect(() => {
    if (!feesQuery.data) return;
    setCharges(valuesFromCharges(feesQuery.data.service_charges));
    setCashback(String(feesQuery.data.fees?.cashback_flat ?? "0.00"));
  }, [feesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.adminUpdateUserFees(userId, {
        cashback_flat: cashback,
        service_charges: payloadFromChargeValues(charges),
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
            Independent charge for each service (Flat or Percentage), plus a separate cashback
            amount. The dealer’s per-service charge is added on top when this user transacts.
          </p>
        </div>
        <Button type="submit" size="sm" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save charges"}
        </Button>
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor={`user-cashback-${userId}`}>Cashback charge (Rs)</Label>
        <Input
          id={`user-cashback-${userId}`}
          type="number"
          min="0"
          step="0.01"
          className="w-40"
          placeholder="Rs"
          value={cashback}
          onChange={(e) => setCashback(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Held in the debit and credited back to this user after a successful transaction.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICE_CHARGE_OPTIONS.map((service) => {
          const entry = charges[service.id] ?? { amount: "", charge_type: "flat" as const };
          const unit = entry.charge_type === "percent" ? "%" : "Rs";
          return (
            <div key={service.id} className="space-y-1.5 rounded-md border border-border/60 p-2.5">
              <Label htmlFor={`user-charge-${userId}-${service.id}`}>{service.label}</Label>
              <div className="flex gap-2">
                <select
                  aria-label={`${service.label} charge type`}
                  className="h-9 w-[7.5rem] shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={entry.charge_type}
                  onChange={(e) =>
                    setCharges((current) => ({
                      ...current,
                      [service.id]: {
                        ...entry,
                        charge_type: e.target.value === "percent" ? "percent" : "flat",
                      },
                    }))
                  }
                >
                  <option value="flat">Flat</option>
                  <option value="percent">Percentage</option>
                </select>
                <Input
                  id={`user-charge-${userId}-${service.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={unit}
                  value={entry.amount}
                  onChange={(e) =>
                    setCharges((current) => ({
                      ...current,
                      [service.id]: { ...entry, amount: e.target.value },
                    }))
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </form>
  );
}
