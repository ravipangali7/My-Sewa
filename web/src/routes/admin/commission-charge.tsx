import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Save, Search } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { useErrorPopup } from "@/components/ErrorPopup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api";
import { formatNPR } from "@/lib/format";
import {
  emptyServiceChargeValues,
  payloadFromChargeValues,
  SERVICE_CHARGE_OPTIONS,
  valuesFromCharges,
  type ChargeType,
  type ServiceChargeValue,
} from "@/lib/services";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/commission-charge")({
  head: () => ({
    meta: [
      { title: "Commission & Charge — MySewa Admin" },
      {
        name: "description",
        content:
          "Configure dealer and user per-service charges as a flat amount or a percentage.",
      },
    ],
  }),
  component: CommissionChargePage,
});

function CommissionChargePage() {
  return (
    <AdminShell
      title="Commission & Charge"
      description="Set a dealer’s default commission, then independent charges for each service. Each service can be Flat or Percentage. User charges split into dealer commission, cashback, and system charge."
    >
      <CommissionSetupPanel />
    </AdminShell>
  );
}

function splitPreview(amount: string, chargeType: ChargeType, kind: "user" | "dealer") {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (chargeType === "percent") {
    return kind === "user"
      ? `${value}% of the amount → 50% dealer commission · 25% cashback · 25% system`
      : `${value}% of the amount → 50% dealer cashback · 50% system`;
  }
  const dealerOrCashback = Math.round(value * 50) / 100;
  if (kind === "dealer") {
    const system = Math.round((value - dealerOrCashback) * 100) / 100;
    return `Rs ${value.toFixed(2)} → Dealer cashback ${formatNPR(dealerOrCashback)} · System ${formatNPR(system)}`;
  }
  const commission = Math.round(value * 50) / 100;
  const cashback = Math.round(value * 25) / 100;
  const system = Math.round((value - commission - cashback) * 100) / 100;
  return `Rs ${value.toFixed(2)} → Dealer ${formatNPR(commission)} · Cashback ${formatNPR(cashback)} · System ${formatNPR(system)}`;
}

function ServiceAmountGrid({
  values,
  onChange,
  idPrefix,
  kind,
}: {
  values: Record<string, ServiceChargeValue>;
  onChange: (txnType: string, next: ServiceChargeValue) => void;
  idPrefix: string;
  kind: "user" | "dealer";
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SERVICE_CHARGE_OPTIONS.map((service) => {
        const entry = values[service.id] ?? { amount: "", charge_type: "flat" as const };
        const unit = entry.charge_type === "percent" ? "%" : "Rs";
        const preview = splitPreview(entry.amount, entry.charge_type, kind);
        return (
          <div key={service.id} className="space-y-1.5 rounded-md border border-border/60 p-2.5">
            <Label htmlFor={`${idPrefix}-${service.id}`}>{service.label}</Label>
            <div className="flex gap-2">
              <select
                aria-label={`${service.label} charge type`}
                className="h-9 w-[7.5rem] shrink-0 rounded-md border border-input bg-transparent px-2 text-sm"
                value={entry.charge_type}
                onChange={(e) =>
                  onChange(service.id, {
                    ...entry,
                    charge_type: e.target.value === "percent" ? "percent" : "flat",
                  })
                }
              >
                <option value="flat">Flat</option>
                <option value="percent">Percentage</option>
              </select>
              <Input
                id={`${idPrefix}-${service.id}`}
                type="number"
                min="0"
                step="0.01"
                placeholder={unit}
                value={entry.amount}
                onChange={(e) => onChange(service.id, { ...entry, amount: e.target.value })}
              />
            </div>
            {preview ? (
              <p className="text-[11px] leading-snug text-muted-foreground">{preview}</p>
            ) : (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {entry.charge_type === "percent" ? "Percent of transaction amount" : "Amount in Rs"}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CommissionSetupPanel() {
  const errorPopup = useErrorPopup("Commission setup");
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const listQuery = useQuery({
    queryKey: ["admin", "commission-setup", q],
    queryFn: () => apiClient.adminCommissionSetupDealers(q),
  });
  const items = listQuery.data?.items ?? [];

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">Commission Setup</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Open a dealer to set Fund transfer, remittance, and every other service independently —
        Flat or Percentage. A User charge of Rs 200 splits into Rs 100 dealer commission, Rs 50
        cashback, and Rs 50 system charge. A Dealer charge of Rs 100 splits into Rs 50 dealer
        cashback and Rs 50 system charge.
      </p>
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search dealer by name or phone"
          className="pl-9"
        />
      </div>
      <div className="mt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Dealer name</TableHead>
              <TableHead>Phone number</TableHead>
              <TableHead className="text-right">Commission amount</TableHead>
              <TableHead className="text-right">Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  Loading dealers…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  No dealers found.
                </TableCell>
              </TableRow>
            ) : (
              items.map((dealer) => (
                <DealerSetupRow
                  key={dealer.id}
                  dealer={dealer}
                  open={openId === dealer.id}
                  onToggle={() => setOpenId((current) => (current === dealer.id ? null : dealer.id))}
                  onChanged={() => {
                    queryClient.invalidateQueries({ queryKey: ["admin", "commission-setup"] });
                  }}
                  onError={(err) => errorPopup.show(err)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DealerSetupRow({
  dealer,
  open,
  onToggle,
  onChanged,
  onError,
}: {
  dealer: {
    id: number;
    name: string;
    phone: string;
    commission_amount: string;
    user_count: number;
  };
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onError: (err: unknown) => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["admin", "commission-setup", dealer.id],
    queryFn: () => apiClient.adminCommissionSetupDealer(dealer.id),
    enabled: open,
  });
  const [commission, setCommission] = useState(dealer.commission_amount);
  const [serviceCharges, setServiceCharges] =
    useState<Record<string, ServiceChargeValue>>(emptyServiceChargeValues);
  const [userCharges, setUserCharges] = useState<Record<number, Record<string, ServiceChargeValue>>>(
    {},
  );
  const [bulkCharges, setBulkCharges] =
    useState<Record<string, ServiceChargeValue>>(emptyServiceChargeValues);

  useEffect(() => {
    if (!detailQuery.data) return;
    setCommission(detailQuery.data.commission_amount);
    setServiceCharges(valuesFromCharges(detailQuery.data.service_charges));
    const nextCharges: Record<number, Record<string, ServiceChargeValue>> = {};
    for (const user of detailQuery.data.users) {
      nextCharges[user.id] = valuesFromCharges(user.charges);
    }
    setUserCharges(nextCharges);
  }, [detailQuery.data]);

  const saveDealer = useMutation({
    mutationFn: () =>
      apiClient.adminSaveCommissionSetupDealer(dealer.id, {
        commission_amount: commission,
        service_charges: payloadFromChargeValues(serviceCharges),
      }),
    onSuccess: () => {
      toast.success("Dealer commission and service charges saved");
      onChanged();
    },
    onError,
  });

  const saveUser = useMutation({
    mutationFn: ({
      userId,
      charges,
    }: {
      userId: number;
      charges: Record<string, ServiceChargeValue>;
    }) =>
      apiClient.adminSaveCommissionSetupCashback(dealer.id, {
        user_id: userId,
        charges: Object.fromEntries(
          payloadFromChargeValues(charges).map((row) => [
            row.txn_type,
            { amount: row.amount, charge_type: row.charge_type },
          ]),
        ),
      }),
    onSuccess: () => toast.success("User service charges saved"),
    onError,
  });

  const saveAllCharges = useMutation({
    mutationFn: () =>
      apiClient.adminSaveCommissionSetupCashback(dealer.id, {
        apply_to_all: true,
        charges: Object.fromEntries(
          payloadFromChargeValues(bulkCharges, { onlyFilled: true }).map((row) => [
            row.txn_type,
            { amount: row.amount, charge_type: row.charge_type },
          ]),
        ),
      }),
    onSuccess: (res) => {
      const next: Record<number, Record<string, ServiceChargeValue>> = {};
      for (const user of res.users) next[user.id] = valuesFromCharges(user.charges);
      setUserCharges((current) => ({ ...current, ...next }));
      toast.success("Service charges applied to all users");
    },
    onError,
  });

  const users = detailQuery.data?.users ?? [];
  const hasBulkCharges = SERVICE_CHARGE_OPTIONS.some(
    (service) => (bulkCharges[service.id]?.amount ?? "").trim(),
  );

  return (
    <>
      <TableRow className={cn("cursor-pointer", open && "bg-muted/40")} onClick={onToggle}>
        <TableCell>
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </TableCell>
        <TableCell className="font-medium">{dealer.name}</TableCell>
        <TableCell className="tabular">{dealer.phone}</TableCell>
        <TableCell className="text-right tabular">{formatNPR(dealer.commission_amount)}</TableCell>
        <TableCell className="text-right tabular">{dealer.user_count}</TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/20">
            <div className="space-y-4 py-2" onClick={(e) => e.stopPropagation()}>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-medium">Dealer commission & service charges</p>
                <p className="text-xs text-muted-foreground">
                  These amounts apply when this dealer uses a service. Half is dealer cashback and
                  half is system charge. Default commission is used when a service box is left blank.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`commission-${dealer.id}`}>Dealer commission (Rs, default)</Label>
                    <Input
                      id={`commission-${dealer.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-40"
                      value={commission}
                      onChange={(e) => setCommission(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <ServiceAmountGrid
                    idPrefix={`dealer-${dealer.id}`}
                    kind="dealer"
                    values={serviceCharges}
                    onChange={(txnType, value) =>
                      setServiceCharges((current) => ({ ...current, [txnType]: value }))
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="mt-4 gap-1.5"
                  disabled={saveDealer.isPending}
                  onClick={() => saveDealer.mutate()}
                >
                  <Save className="size-3.5" />
                  {saveDealer.isPending ? "Saving…" : "Save dealer charges"}
                </Button>
              </div>

              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-medium">Referred users</p>
                <p className="text-xs text-muted-foreground">
                  Each service can be Flat or Percentage. The charge splits automatically: 50% to
                  the dealer as commission, 25% cashback to the user, 25% system charge.
                </p>

                <div className="mt-4 rounded-md border border-border/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Charges for all users</p>
                  <div className="mt-3">
                    <ServiceAmountGrid
                      idPrefix={`bulk-charges-${dealer.id}`}
                      kind="user"
                      values={bulkCharges}
                      onChange={(txnType, value) =>
                        setBulkCharges((current) => ({ ...current, [txnType]: value }))
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    disabled={saveAllCharges.isPending || !hasBulkCharges}
                    onClick={() => saveAllCharges.mutate()}
                  >
                    Apply charges to all users
                  </Button>
                </div>

                {detailQuery.isLoading ? (
                  <p className="mt-3 text-sm text-muted-foreground">Loading users…</p>
                ) : users.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">No users under this dealer.</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    <li className="text-sm font-semibold">{dealer.name}</li>
                    {users.map((user) => {
                      const charges = userCharges[user.id] ?? valuesFromCharges(user.charges);
                      return (
                        <li
                          key={user.id}
                          className="rounded-md border border-border/70 bg-muted/20 p-3 pl-4"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-muted-foreground">→</span>
                            <span className="min-w-40 text-sm">
                              {user.name}{" "}
                              <span className="text-muted-foreground">· {user.phone}</span>
                            </span>
                          </div>
                          <div className="mt-3">
                            <ServiceAmountGrid
                              idPrefix={`user-${dealer.id}-${user.id}`}
                              kind="user"
                              values={charges}
                              onChange={(txnType, value) =>
                                setUserCharges((current) => ({
                                  ...current,
                                  [user.id]: { ...(current[user.id] ?? charges), [txnType]: value },
                                }))
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-3"
                            disabled={saveUser.isPending}
                            onClick={() =>
                              saveUser.mutate({
                                userId: user.id,
                                charges,
                              })
                            }
                          >
                            Save
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
