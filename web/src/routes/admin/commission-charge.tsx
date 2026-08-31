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
          "Configure dealer charges, user service charges, and user cashback as independent amounts.",
      },
    ],
  }),
  component: CommissionChargePage,
});

function CommissionChargePage() {
  return (
    <AdminShell
      title="Commission & Charge"
      description="Set the dealer’s per-service charge, each user’s service charge (Flat or Percentage), and a separate cashback amount. On a fund transfer those three amounts are added on top of the transfer."
    >
      <CommissionSetupPanel />
    </AdminShell>
  );
}

function ServiceAmountGrid({
  values,
  onChange,
  idPrefix,
}: {
  values: Record<string, ServiceChargeValue>;
  onChange: (txnType: string, next: ServiceChargeValue) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SERVICE_CHARGE_OPTIONS.map((service) => {
        const entry = values[service.id] ?? { amount: "", charge_type: "flat" as const };
        const unit = entry.charge_type === "percent" ? "%" : "Rs";
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
            <p className="text-[11px] leading-snug text-muted-foreground">
              {entry.charge_type === "percent" ? "Percent of transaction amount" : "Amount in Rs"}
            </p>
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
        Open a dealer to set Fund Transfer and every other service independently (Flat or
        Percentage). Example: transfer Rs 100 + dealer charge Rs 100 + user charge Rs 50 +
        cashback Rs 50 = Rs 300 debited. The user charge stays with the system, cashback is
        returned to the user, and the dealer charge is credited to the dealer.
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
  const [userCashbacks, setUserCashbacks] = useState<Record<number, string>>({});
  const [bulkCharges, setBulkCharges] =
    useState<Record<string, ServiceChargeValue>>(emptyServiceChargeValues);
  const [bulkCashback, setBulkCashback] = useState("");

  useEffect(() => {
    if (!detailQuery.data) return;
    setCommission(detailQuery.data.commission_amount);
    setServiceCharges(valuesFromCharges(detailQuery.data.service_charges));
    const nextCharges: Record<number, Record<string, ServiceChargeValue>> = {};
    const nextCashbacks: Record<number, string> = {};
    for (const user of detailQuery.data.users) {
      nextCharges[user.id] = valuesFromCharges(user.charges);
      nextCashbacks[user.id] = user.cashback ?? "0.00";
    }
    setUserCharges(nextCharges);
    setUserCashbacks(nextCashbacks);
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
      cashback,
    }: {
      userId: number;
      charges: Record<string, ServiceChargeValue>;
      cashback: string;
    }) =>
      apiClient.adminSaveCommissionSetupCashback(dealer.id, {
        user_id: userId,
        cashback,
        charges: Object.fromEntries(
          payloadFromChargeValues(charges).map((row) => [
            row.txn_type,
            { amount: row.amount, charge_type: row.charge_type },
          ]),
        ),
      }),
    onSuccess: () => toast.success("User charges and cashback saved"),
    onError,
  });

  const saveAllCharges = useMutation({
    mutationFn: () => {
      const filledCharges = payloadFromChargeValues(bulkCharges, { onlyFilled: true });
      return apiClient.adminSaveCommissionSetupCashback(dealer.id, {
        apply_to_all: true,
        ...(bulkCashback.trim() ? { cashback: bulkCashback } : {}),
        ...(filledCharges.length
          ? {
              charges: Object.fromEntries(
                filledCharges.map((row) => [
                  row.txn_type,
                  { amount: row.amount, charge_type: row.charge_type },
                ]),
              ),
            }
          : {}),
      });
    },
    onSuccess: (res) => {
      const nextCharges: Record<number, Record<string, ServiceChargeValue>> = {};
      const nextCashbacks: Record<number, string> = {};
      for (const user of res.users) {
        nextCharges[user.id] = valuesFromCharges(user.charges);
        nextCashbacks[user.id] = user.cashback ?? "0.00";
      }
      setUserCharges((current) => ({ ...current, ...nextCharges }));
      setUserCashbacks((current) => ({ ...current, ...nextCashbacks }));
      toast.success("Charges and cashback applied to all users");
    },
    onError,
  });

  const users = detailQuery.data?.users ?? [];
  const hasBulkCharges = SERVICE_CHARGE_OPTIONS.some(
    (service) => (bulkCharges[service.id]?.amount ?? "").trim(),
  );
  const hasBulkCashback = bulkCashback.trim() !== "";

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
                  These amounts are added when a referred user uses that service and are credited to
                  this dealer. Default commission is used when a service box is left blank. When this
                  dealer themselves uses a service, half is cashback and half is system charge.
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
                  Each service charge is collected by the system. Cashback is a separate amount held
                  in the debit and returned to the user after success. The dealer charge above is
                  added on top and paid to this dealer.
                </p>

                <div className="mt-4 rounded-md border border-border/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Charges for all users</p>
                  <div className="mt-3 space-y-1.5">
                    <Label htmlFor={`bulk-cashback-${dealer.id}`}>Cashback charge (Rs)</Label>
                    <Input
                      id={`bulk-cashback-${dealer.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-40"
                      placeholder="Rs"
                      value={bulkCashback}
                      onChange={(e) => setBulkCashback(e.target.value)}
                    />
                  </div>
                  <div className="mt-3">
                    <ServiceAmountGrid
                      idPrefix={`bulk-charges-${dealer.id}`}
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
                    disabled={saveAllCharges.isPending || (!hasBulkCharges && !hasBulkCashback)}
                    onClick={() => saveAllCharges.mutate()}
                  >
                    Apply to all users
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
                      const cashback = userCashbacks[user.id] ?? user.cashback ?? "0.00";
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
                          <div className="mt-3 space-y-1.5">
                            <Label htmlFor={`cashback-${dealer.id}-${user.id}`}>
                              Cashback charge (Rs)
                            </Label>
                            <Input
                              id={`cashback-${dealer.id}-${user.id}`}
                              type="number"
                              min="0"
                              step="0.01"
                              className="w-40"
                              placeholder="Rs"
                              value={cashback}
                              onChange={(e) =>
                                setUserCashbacks((current) => ({
                                  ...current,
                                  [user.id]: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="mt-3">
                            <ServiceAmountGrid
                              idPrefix={`user-${dealer.id}-${user.id}`}
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
                                cashback,
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
