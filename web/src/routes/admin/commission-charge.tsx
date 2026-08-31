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
import { amountsFromCharges, emptyServiceAmounts, SERVICE_CHARGE_OPTIONS } from "@/lib/services";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/commission-charge")({
  head: () => ({
    meta: [
      { title: "Commission & Charge — MySewa Admin" },
      {
        name: "description",
        content:
          "Configure dealer commission and per-service charges for dealers and users, plus user cashback.",
      },
    ],
  }),
  component: CommissionChargePage,
});

function CommissionChargePage() {
  return (
    <AdminShell
      title="Commission & Charge"
      description="Set a dealer’s default commission, then independent charges for each service. Users under a dealer get their own per-service charges and cashback."
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
  values: Record<string, string>;
  onChange: (txnType: string, value: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SERVICE_CHARGE_OPTIONS.map((service) => (
        <div key={service.id} className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-${service.id}`}>{service.label} (Rs)</Label>
          <Input
            id={`${idPrefix}-${service.id}`}
            type="number"
            min="0"
            step="0.01"
            value={values[service.id] ?? ""}
            onChange={(e) => onChange(service.id, e.target.value)}
          />
        </div>
      ))}
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
        Default dealer commission applies when a service has no amount of its own. Open a dealer to
        set Fund transfer, top-up, and every other service independently — for the dealer and for
        each referred user, the same way cashback is set.
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
  const [serviceCharges, setServiceCharges] = useState<Record<string, string>>(emptyServiceAmounts);
  const [cashbacks, setCashbacks] = useState<Record<number, string>>({});
  const [userCharges, setUserCharges] = useState<Record<number, Record<string, string>>>({});
  const [bulkCashback, setBulkCashback] = useState("");
  const [bulkCharges, setBulkCharges] = useState<Record<string, string>>(emptyServiceAmounts);

  useEffect(() => {
    if (!detailQuery.data) return;
    setCommission(detailQuery.data.commission_amount);
    setServiceCharges(amountsFromCharges(detailQuery.data.service_charges));
    const nextCashback: Record<number, string> = {};
    const nextCharges: Record<number, Record<string, string>> = {};
    for (const user of detailQuery.data.users) {
      nextCashback[user.id] = user.cashback;
      nextCharges[user.id] = amountsFromCharges(user.charges);
    }
    setCashbacks(nextCashback);
    setUserCharges(nextCharges);
  }, [detailQuery.data]);

  const saveDealer = useMutation({
    mutationFn: () =>
      apiClient.adminSaveCommissionSetupDealer(dealer.id, {
        commission_amount: commission,
        service_charges: SERVICE_CHARGE_OPTIONS.map((service) => ({
          txn_type: service.id,
          amount: serviceCharges[service.id] ?? "",
        })),
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
      cashback,
      charges,
    }: {
      userId: number;
      cashback: string;
      charges: Record<string, string>;
    }) =>
      apiClient.adminSaveCommissionSetupCashback(dealer.id, {
        user_id: userId,
        cashback,
        charges,
      }),
    onSuccess: () => toast.success("User cashback and charges saved"),
    onError,
  });

  const saveAllCashback = useMutation({
    mutationFn: () =>
      apiClient.adminSaveCommissionSetupCashback(dealer.id, {
        apply_to_all: true,
        cashback: bulkCashback,
      }),
    onSuccess: (res) => {
      const next: Record<number, string> = {};
      for (const user of res.users) next[user.id] = user.cashback;
      setCashbacks((current) => ({ ...current, ...next }));
      toast.success("Cashback applied to all users");
    },
    onError,
  });

  const saveAllCharges = useMutation({
    mutationFn: () =>
      apiClient.adminSaveCommissionSetupCashback(dealer.id, {
        apply_to_all: true,
        charges: Object.fromEntries(
          SERVICE_CHARGE_OPTIONS.filter((service) => (bulkCharges[service.id] ?? "").trim()).map(
            (service) => [service.id, bulkCharges[service.id]],
          ),
        ),
      }),
    onSuccess: (res) => {
      const next: Record<number, Record<string, string>> = {};
      for (const user of res.users) next[user.id] = amountsFromCharges(user.charges);
      setUserCharges((current) => ({ ...current, ...next }));
      toast.success("Service charges applied to all users");
    },
    onError,
  });

  const users = detailQuery.data?.users ?? [];
  const hasBulkCharges = SERVICE_CHARGE_OPTIONS.some((service) =>
    (bulkCharges[service.id] ?? "").trim(),
  );

  return (
    <>
      <TableRow
        className={cn("cursor-pointer", open && "bg-muted/40")}
        onClick={onToggle}
      >
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
                  Default commission is used when a service box is left blank. Set Fund transfer and
                  every other service independently.
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
                  Each user has cashback plus a separate charge for every service. Apply the same
                  values to everyone, then adjust individuals.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`bulk-${dealer.id}`}>Cashback for all (Rs)</Label>
                    <Input
                      id={`bulk-${dealer.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-40"
                      value={bulkCashback}
                      onChange={(e) => setBulkCashback(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={saveAllCashback.isPending || !bulkCashback.trim()}
                    onClick={() => saveAllCashback.mutate()}
                  >
                    Apply cashback to all
                  </Button>
                </div>

                <div className="mt-4 rounded-md border border-border/70 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Charges for all users</p>
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
                      const charges = userCharges[user.id] ?? amountsFromCharges(user.charges);
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
                            <div className="flex flex-wrap items-center gap-2">
                              <Label
                                htmlFor={`cb-${dealer.id}-${user.id}`}
                                className="text-xs text-muted-foreground"
                              >
                                Cashback
                              </Label>
                              <Input
                                id={`cb-${dealer.id}-${user.id}`}
                                type="number"
                                min="0"
                                step="0.01"
                                className="h-8 w-28"
                                value={cashbacks[user.id] ?? user.cashback}
                                onChange={(e) =>
                                  setCashbacks((current) => ({
                                    ...current,
                                    [user.id]: e.target.value,
                                  }))
                                }
                                aria-label={`Cashback for ${user.name}`}
                              />
                            </div>
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
                                cashback: cashbacks[user.id] ?? user.cashback,
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
