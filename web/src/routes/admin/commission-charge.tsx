import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Receipt, Save, Search } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { useErrorPopup } from "@/components/ErrorPopup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { ChargeType, ServiceChargeConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/commission-charge")({
  head: () => ({
    meta: [
      { title: "Commission & Charge — MySewa Admin" },
      {
        name: "description",
        content:
          "Configure per-service user and network fees, dealer commission, and user cashback.",
      },
    ],
  }),
  component: CommissionChargePage,
});

function CommissionChargePage() {
  return (
    <AdminShell
      title="Commission & Charge"
      description="Set service charges for users and network fees, then configure dealer commission and user cashback."
    >
      <Tabs defaultValue="charges" className="space-y-4">
        <TabsList>
          <TabsTrigger value="charges">Charge Setup</TabsTrigger>
          <TabsTrigger value="commission">Commission Setup</TabsTrigger>
        </TabsList>
        <TabsContent value="charges">
          <ChargeSetupPanel />
        </TabsContent>
        <TabsContent value="commission">
          <CommissionSetupPanel />
        </TabsContent>
      </Tabs>
    </AdminShell>
  );
}

function ChargeSetupPanel() {
  const errorPopup = useErrorPopup("Charge setup");
  const [rows, setRows] = useState<ServiceChargeConfig[]>([]);
  const query = useQuery({
    queryKey: ["admin", "service-charges"],
    queryFn: () => apiClient.adminGetServiceCharges(),
  });
  useEffect(() => {
    if (query.data?.data) setRows(query.data.data);
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () => apiClient.adminSaveServiceCharges(rows),
    onSuccess: (res) => {
      setRows(res.data);
      toast.success(res.message || "Charge setup saved");
    },
    onError: (err) => errorPopup.show(err),
  });

  const setRow = (txnType: string, patch: Partial<ServiceChargeConfig>) => {
    setRows((current) =>
      current.map((row) => (row.txn_type === txnType ? { ...row, ...patch } : row)),
    );
  };

  return (
    <form
      className="rounded-xl border border-border bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        saveMutation.mutate();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Charge Setup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            User charges apply to every customer. Network fees apply when the customer belongs to a
            dealer and are shown to customers only as part of applicable charges.
          </p>
        </div>
        <Button type="submit" disabled={saveMutation.isPending} className="gap-1.5">
          <Save className="size-3.5" />
          {saveMutation.isPending ? "Saving…" : "Save charges"}
        </Button>
      </div>

      {query.isLoading ? (
        <p className="mt-5 text-sm text-muted-foreground">Loading services…</p>
      ) : (
        <div className="mt-5 grid gap-4">
          {rows.map((row) => (
            <div key={row.txn_type} className="rounded-xl border border-border/80 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Receipt className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">{row.label}</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <ChargeEditor
                  title="User"
                  description="Service charge for customers using this service."
                  chargeType={row.user_charge_type || "flat"}
                  flat={row.system_charge_flat}
                  percent={row.system_charge_percent}
                  onTypeChange={(user_charge_type) => setRow(row.txn_type, { user_charge_type })}
                  onFlatChange={(system_charge_flat) => setRow(row.txn_type, { system_charge_flat })}
                  onPercentChange={(system_charge_percent) =>
                    setRow(row.txn_type, { system_charge_percent })
                  }
                />
                <ChargeEditor
                  title="Network fee"
                  description="Added for customers in a dealer network. Combined into applicable charges on the customer receipt."
                  chargeType={row.dealer_charge_type || "flat"}
                  flat={row.dealer_commission_flat}
                  percent={row.dealer_commission_percent}
                  onTypeChange={(dealer_charge_type) => setRow(row.txn_type, { dealer_charge_type })}
                  onFlatChange={(dealer_commission_flat) =>
                    setRow(row.txn_type, { dealer_commission_flat })
                  }
                  onPercentChange={(dealer_commission_percent) =>
                    setRow(row.txn_type, { dealer_commission_percent })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}

function ChargeEditor({
  title,
  description,
  chargeType,
  flat,
  percent,
  onTypeChange,
  onFlatChange,
  onPercentChange,
}: {
  title: string;
  description: string;
  chargeType: ChargeType;
  flat: string;
  percent: string;
  onTypeChange: (value: ChargeType) => void;
  onFlatChange: (value: string) => void;
  onPercentChange: (value: string) => void;
}) {
  const isPercent = chargeType === "percent";
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={chargeType} onValueChange={(v) => onTypeChange(v as ChargeType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Flat amount</SelectItem>
              <SelectItem value="percent">Percentage</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{isPercent ? "Value (%)" : "Value (Rs)"}</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={isPercent ? percent : flat}
            onChange={(e) =>
              isPercent ? onPercentChange(e.target.value) : onFlatChange(e.target.value)
            }
          />
        </div>
      </div>
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
        Flat dealer commission per transaction, plus cashback for each referred user. Opening a
        dealer shows their users in a tree so cashback can be set together or one by one.
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
  const [cashbacks, setCashbacks] = useState<Record<number, string>>({});
  const [bulkCashback, setBulkCashback] = useState("");

  useEffect(() => {
    if (detailQuery.data) {
      setCommission(detailQuery.data.commission_amount);
      const next: Record<number, string> = {};
      for (const user of detailQuery.data.users) next[user.id] = user.cashback;
      setCashbacks(next);
    }
  }, [detailQuery.data]);

  const saveCommission = useMutation({
    mutationFn: () =>
      apiClient.adminSaveCommissionSetupDealer(dealer.id, { commission_amount: commission }),
    onSuccess: () => {
      toast.success("Dealer commission saved");
      onChanged();
    },
    onError,
  });

  const saveUser = useMutation({
    mutationFn: ({ userId, cashback }: { userId: number; cashback: string }) =>
      apiClient.adminSaveCommissionSetupCashback(dealer.id, {
        user_id: userId,
        cashback,
      }),
    onSuccess: () => toast.success("Cashback saved"),
    onError,
  });

  const saveAll = useMutation({
    mutationFn: () =>
      apiClient.adminSaveCommissionSetupCashback(dealer.id, {
        apply_to_all: true,
        cashback: bulkCashback,
      }),
    onSuccess: (res) => {
      const next: Record<number, string> = {};
      for (const user of res.users) next[user.id] = user.cashback;
      setCashbacks(next);
      toast.success("Cashback applied to all users");
    },
    onError,
  });

  const users = detailQuery.data?.users ?? [];

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
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`commission-${dealer.id}`}>Dealer commission (Rs, flat)</Label>
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
                <Button
                  type="button"
                  size="sm"
                  disabled={saveCommission.isPending}
                  onClick={() => saveCommission.mutate()}
                >
                  Save commission
                </Button>
              </div>

              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-medium">Referred users</p>
                <p className="text-xs text-muted-foreground">
                  Set the same cashback for everyone, then adjust individuals as needed.
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
                    disabled={saveAll.isPending || !bulkCashback.trim()}
                    onClick={() => saveAll.mutate()}
                  >
                    Apply to all users
                  </Button>
                </div>

                {detailQuery.isLoading ? (
                  <p className="mt-3 text-sm text-muted-foreground">Loading users…</p>
                ) : users.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">No users under this dealer.</p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    <li className="text-sm font-semibold">{dealer.name}</li>
                    {users.map((user) => (
                      <li key={user.id} className="flex flex-wrap items-center gap-3 pl-6">
                        <span className="text-muted-foreground">→</span>
                        <span className="min-w-40 text-sm">
                          {user.name}{" "}
                          <span className="text-muted-foreground">· {user.phone}</span>
                        </span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="h-8 w-28"
                          value={cashbacks[user.id] ?? user.cashback}
                          onChange={(e) =>
                            setCashbacks((current) => ({ ...current, [user.id]: e.target.value }))
                          }
                          aria-label={`Cashback for ${user.name}`}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={saveUser.isPending}
                          onClick={() =>
                            saveUser.mutate({
                              userId: user.id,
                              cashback: cashbacks[user.id] ?? user.cashback,
                            })
                          }
                        >
                          Save
                        </Button>
                      </li>
                    ))}
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
