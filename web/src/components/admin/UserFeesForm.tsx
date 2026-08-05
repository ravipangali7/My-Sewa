import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient, ApiError } from "@/lib/api";
import type { UserFeeConfigPayload, UserFeeDefaults } from "@/lib/types";

type FeeFormState = {
  transfer_charge_enabled_override: boolean;
  transfer_charge_enabled: boolean;
  transfer_charge_flat_override: boolean;
  transfer_charge_flat: string;
  transfer_charge_percent_override: boolean;
  transfer_charge_percent: string;
  topup_charge_percent_override: boolean;
  topup_charge_percent: string;
};

function numStr(value: string | number | null | undefined, fallback: number | string = ""): string {
  if (value === null || value === undefined || value === "") return String(fallback);
  return String(value);
}

function fromApi(
  fees: {
    transfer_charge_enabled: boolean | null;
    transfer_charge_flat: string | number | null;
    transfer_charge_percent: string | number | null;
    topup_charge_percent: string | number | null;
  },
  defaults: UserFeeDefaults,
): FeeFormState {
  return {
    transfer_charge_enabled_override: fees.transfer_charge_enabled !== null,
    transfer_charge_enabled:
      fees.transfer_charge_enabled ?? defaults.transfer_charge_enabled ?? true,
    transfer_charge_flat_override: fees.transfer_charge_flat !== null,
    transfer_charge_flat: numStr(fees.transfer_charge_flat, defaults.transfer_charge_flat ?? 0),
    transfer_charge_percent_override: fees.transfer_charge_percent !== null,
    transfer_charge_percent: numStr(
      fees.transfer_charge_percent,
      defaults.transfer_charge_percent ?? 0,
    ),
    topup_charge_percent_override: fees.topup_charge_percent !== null,
    topup_charge_percent: numStr(
      fees.topup_charge_percent,
      defaults.topup_charge_percent ?? 0,
    ),
  };
}

function toPayload(state: FeeFormState): UserFeeConfigPayload {
  return {
    transfer_charge_enabled: state.transfer_charge_enabled_override
      ? state.transfer_charge_enabled
      : null,
    transfer_charge_flat: state.transfer_charge_flat_override
      ? state.transfer_charge_flat || "0"
      : null,
    transfer_charge_percent: state.transfer_charge_percent_override
      ? state.transfer_charge_percent || "0"
      : null,
    topup_charge_percent: state.topup_charge_percent_override
      ? state.topup_charge_percent || "0"
      : null,
  };
}

function OverrideRow({
  label,
  description,
  useDefault,
  onUseDefaultChange,
  children,
}: {
  label: string;
  description?: string;
  useDefault: boolean;
  onUseDefaultChange: (useDefault: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 border-b border-border py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={useDefault}
            onCheckedChange={onUseDefaultChange}
          />
          Use default
        </label>
      </div>
      <div className={useDefault ? "pointer-events-none opacity-50" : undefined}>
        {children}
      </div>
    </div>
  );
}

export function UserFeesForm({ userId }: { userId: number }) {
  const queryClient = useQueryClient();
  const feesQuery = useQuery({
    queryKey: ["admin", "users", userId, "fees"],
    queryFn: () => apiClient.adminGetUserFees(userId),
    enabled: Number.isFinite(userId),
  });

  const [values, setValues] = useState<FeeFormState | null>(null);

  useEffect(() => {
    if (feesQuery.data) {
      setValues(fromApi(feesQuery.data.fees, feesQuery.data.defaults));
    }
  }, [feesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: UserFeeConfigPayload) =>
      apiClient.adminUpdateUserFees(userId, payload),
    onSuccess: (data) => {
      toast.success("User fees updated");
      queryClient.setQueryData(["admin", "users", userId, "fees"], data);
      setValues(fromApi(data.fees, data.defaults));
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not update fees");
    },
  });

  if (feesQuery.isLoading || !values) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-sm text-muted-foreground">Loading fee settings…</p>
      </div>
    );
  }

  if (feesQuery.isError) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <p className="text-sm text-muted-foreground">
          {feesQuery.error instanceof ApiError
            ? feesQuery.error.message
            : "Could not load fee settings."}
        </p>
      </div>
    );
  }

  const defaults = feesQuery.data!.defaults;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(toPayload(values));
  };

  return (
    <form
      className="rounded-xl border border-border bg-surface p-5"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Transaction charges</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Override global transfer and top-up charges for this user. Leave on
            &quot;Use default&quot; to inherit platform settings.
          </p>
        </div>
        <Button type="submit" size="sm" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save fees"}
        </Button>
      </div>

      <div className="mt-2">
        <OverrideRow
          label="Transfer charge enabled"
          description={`Default: ${defaults.transfer_charge_enabled ? "On" : "Off"}`}
          useDefault={!values.transfer_charge_enabled_override}
          onUseDefaultChange={(useDefault) =>
            setValues((v) =>
              v
                ? {
                    ...v,
                    transfer_charge_enabled_override: !useDefault,
                    transfer_charge_enabled: useDefault
                      ? defaults.transfer_charge_enabled
                      : v.transfer_charge_enabled,
                  }
                : v,
            )
          }
        >
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={values.transfer_charge_enabled}
              onCheckedChange={(checked) =>
                setValues((v) => (v ? { ...v, transfer_charge_enabled: checked } : v))
              }
            />
            Apply transfer charges for this user
          </label>
        </OverrideRow>

        <OverrideRow
          label="Transfer charge (flat Rs.)"
          description={`Default: Rs. ${defaults.transfer_charge_flat}`}
          useDefault={!values.transfer_charge_flat_override}
          onUseDefaultChange={(useDefault) =>
            setValues((v) =>
              v
                ? {
                    ...v,
                    transfer_charge_flat_override: !useDefault,
                    transfer_charge_flat: useDefault
                      ? numStr(defaults.transfer_charge_flat, 0)
                      : v.transfer_charge_flat,
                  }
                : v,
            )
          }
        >
          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="user_transfer_charge_flat">Flat amount (Rs.)</Label>
            <Input
              id="user_transfer_charge_flat"
              type="number"
              step="0.01"
              min="0"
              value={values.transfer_charge_flat}
              onChange={(e) =>
                setValues((v) =>
                  v ? { ...v, transfer_charge_flat: e.target.value } : v,
                )
              }
            />
          </div>
        </OverrideRow>

        <OverrideRow
          label="Transfer charge (%)"
          description={`Default: ${defaults.transfer_charge_percent}%`}
          useDefault={!values.transfer_charge_percent_override}
          onUseDefaultChange={(useDefault) =>
            setValues((v) =>
              v
                ? {
                    ...v,
                    transfer_charge_percent_override: !useDefault,
                    transfer_charge_percent: useDefault
                      ? numStr(defaults.transfer_charge_percent, 0)
                      : v.transfer_charge_percent,
                  }
                : v,
            )
          }
        >
          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="user_transfer_charge_percent">Percent of amount</Label>
            <Input
              id="user_transfer_charge_percent"
              type="number"
              step="0.01"
              min="0"
              value={values.transfer_charge_percent}
              onChange={(e) =>
                setValues((v) =>
                  v ? { ...v, transfer_charge_percent: e.target.value } : v,
                )
              }
            />
          </div>
        </OverrideRow>

        <OverrideRow
          label="Top-up charge (%)"
          description={`Default: ${defaults.topup_charge_percent}%`}
          useDefault={!values.topup_charge_percent_override}
          onUseDefaultChange={(useDefault) =>
            setValues((v) =>
              v
                ? {
                    ...v,
                    topup_charge_percent_override: !useDefault,
                    topup_charge_percent: useDefault
                      ? numStr(defaults.topup_charge_percent, 0)
                      : v.topup_charge_percent,
                  }
                : v,
            )
          }
        >
          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="user_topup_charge_percent">Percent of top-up</Label>
            <Input
              id="user_topup_charge_percent"
              type="number"
              step="0.01"
              min="0"
              value={values.topup_charge_percent}
              onChange={(e) =>
                setValues((v) =>
                  v ? { ...v, topup_charge_percent: e.target.value } : v,
                )
              }
            />
          </div>
        </OverrideRow>
      </div>
    </form>
  );
}
