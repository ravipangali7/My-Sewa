import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Info, Pencil, Save, Search, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/layout/AdminShell";
import { useErrorPopup } from "@/components/ErrorPopup";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api";
import { SERVICE_CHARGE_OPTIONS, type ChargeType } from "@/lib/services";
import { serialNumber } from "@/lib/serial";
import { cn } from "@/lib/utils";
import type { CommissionSetupAmount, CommissionSetupRule } from "@/lib/types";

const PAGE_SIZE = 5;
const TITLE_BLUE = "text-[#2563eb]";

export const Route = createFileRoute("/admin/commission-charge")({
  head: () => ({
    meta: [
      { title: "Commission Setup — MySewa Admin" },
      {
        name: "description",
        content:
          "Configure service charge, dealer commission, and customer cashback for each dealer and service.",
      },
    ],
  }),
  component: CommissionSetupPage,
});

type AmountForm = {
  charge_type: ChargeType;
  amount: string;
};

type CustomerMode = "one" | "multiple" | "all";

const emptyAmount = (chargeType: ChargeType = "percent"): AmountForm => ({
  charge_type: chargeType,
  amount: "",
});

function trimAmount(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value || "0";
  return String(n);
}

function formatCharge(entry?: CommissionSetupAmount | AmountForm | null) {
  if (!entry || entry.amount === "" || entry.amount == null) return "—";
  const amount = trimAmount(entry.amount);
  return entry.charge_type === "percent" ? `${amount}%` : `Rs. ${amount}`;
}

function splitRemainderHint(service: AmountForm, dealer: AmountForm, customer: AmountForm): string | null {
  if (
    service.charge_type !== dealer.charge_type ||
    service.charge_type !== customer.charge_type
  ) {
    return null;
  }
  const total = Number(service.amount);
  const dealerAmt = Number(dealer.amount);
  const customerAmt = Number(customer.amount);
  if (![total, dealerAmt, customerAmt].every((n) => Number.isFinite(n))) return null;
  const system = total - dealerAmt - customerAmt;
  if (system < -0.0001) {
    return "Dealer commission plus customer commission cannot exceed the service charge.";
  }
  const unit = service.charge_type === "percent" ? "%" : "Rs.";
  return `From ${trimAmount(service.amount)} ${unit}: dealer ${trimAmount(dealer.amount)} ${unit}, customer ${trimAmount(customer.amount)} ${unit}, Super Admin System Charge ${trimAmount(String(system))} ${unit}.`;
}

function toAmountForm(entry?: CommissionSetupAmount | null): AmountForm {
  if (!entry) return emptyAmount();
  return {
    charge_type: entry.charge_type === "percent" ? "percent" : "flat",
    amount: trimAmount(entry.amount),
  };
}

function RequiredLabel({
  htmlFor,
  index,
  children,
}: {
  htmlFor?: string;
  index: number;
  children: string;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-semibold text-foreground">
      {index}. {children} <span className="text-red-500">*</span>
    </Label>
  );
}

function NativeSelect({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  children,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder: string;
  children: ReactNode;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        !value && "text-muted-foreground",
      )}
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  );
}

function ChargeField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: AmountForm;
  onChange: (next: AmountForm) => void;
}) {
  const suffix = value.charge_type === "percent" ? "%" : "Rs.";
  return (
    <div className="space-y-2.5">
      <RadioGroup
        value={value.charge_type}
        onValueChange={(next) =>
          onChange({
            ...value,
            charge_type: next === "percent" ? "percent" : "flat",
          })
        }
        className="flex flex-wrap items-center gap-x-6 gap-y-2"
      >
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <RadioGroupItem value="percent" id={`${id}-percent`} />
          Percentage (%)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <RadioGroupItem value="flat" id={`${id}-flat`} />
          Flat Amount (Rs.)
        </label>
      </RadioGroup>
      <div className="relative max-w-xs">
        <Input
          id={id}
          type="number"
          min="0"
          step="0.01"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          className="h-10 pr-12"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-muted-foreground">
          {suffix}
        </span>
      </div>
    </div>
  );
}

function CommissionSetupPage() {
  const [editingRule, setEditingRule] = useState<CommissionSetupRule | null>(null);
  const errorPopup = useErrorPopup("Commission setup");
  return (
    <AdminShell title="Commission Setup" dense>
      {errorPopup.popup}
      <p className="-mt-1 mb-5 text-sm text-[#3b82f6]">
        <Link to="/admin" className="hover:underline">
          Dashboard
        </Link>
        <span className="px-1">/</span>
        <span>Commission Setup</span>
      </p>
      <div className="space-y-5">
        <CommissionSetupFormCard
          editingRule={editingRule}
          onCancelEdit={() => setEditingRule(null)}
          onError={(err) => errorPopup.showError(err)}
        />
        <CommissionSetupListCard
          onEdit={setEditingRule}
          onError={(err) => errorPopup.showError(err)}
        />
      </div>
    </AdminShell>
  );
}

function CommissionSetupFormCard({
  editingRule,
  onCancelEdit,
  onError,
}: {
  editingRule: CommissionSetupRule | null;
  onCancelEdit: () => void;
  onError: (err: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dealerId, setDealerId] = useState("");
  const [txnType, setTxnType] = useState("");
  const [userId, setUserId] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("one");
  const [serviceCharge, setServiceCharge] = useState<AmountForm>(emptyAmount());
  const [dealerCommission, setDealerCommission] = useState<AmountForm>(emptyAmount());
  const [customerCommission, setCustomerCommission] = useState<AmountForm>(emptyAmount());
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!editingRule) return;
    setEditingId(editingRule.id);
    setDealerId(editingRule.dealer_id ? String(editingRule.dealer_id) : "");
    setTxnType(editingRule.txn_type);
    setUserId(String(editingRule.user_id));
    setUserIds([String(editingRule.user_id)]);
    setCustomerMode("one");
    setServiceCharge(toAmountForm(editingRule.service_charge));
    setDealerCommission(toAmountForm(editingRule.dealer_commission));
    setCustomerCommission(toAmountForm(editingRule.customer_commission));
    setIsActive(editingRule.is_active);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [editingRule]);

  const dealersQuery = useQuery({
    queryKey: ["admin", "commission-setup", "dealers"],
    queryFn: () => apiClient.adminCommissionSetupDealers(),
  });
  const dealerDetailQuery = useQuery({
    queryKey: ["admin", "commission-setup", "dealer", dealerId],
    queryFn: () => apiClient.adminCommissionSetupDealer(Number(dealerId)),
    enabled: Boolean(dealerId),
  });

  const customers = dealerDetailQuery.data?.users ?? [];

  useEffect(() => {
    if (editingId) return;
    if (dealerDetailQuery.isFetching) return;
    const valid = new Set(customers.map((user) => String(user.id)));
    if (userId && !valid.has(userId)) setUserId("");
    setUserIds((current) => current.filter((id) => valid.has(id)));
  }, [customers, dealerDetailQuery.isFetching, editingId, userId]);

  const resetForm = () => {
    setEditingId(null);
    setDealerId("");
    setTxnType("");
    setUserId("");
    setUserIds([]);
    setCustomerMode("one");
    setServiceCharge(emptyAmount());
    setDealerCommission(emptyAmount());
    setCustomerCommission(emptyAmount());
    setIsActive(true);
    onCancelEdit();
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof apiClient.adminSaveCommissionSetupRule>[0] = {
        ...(editingId ? { id: editingId } : {}),
        dealer_id: Number(dealerId),
        txn_type: txnType,
        service_charge: {
          amount: serviceCharge.amount,
          charge_type: serviceCharge.charge_type,
        },
        dealer_commission: {
          amount: dealerCommission.amount,
          charge_type: dealerCommission.charge_type,
        },
        customer_commission: {
          amount: customerCommission.amount,
          charge_type: customerCommission.charge_type,
        },
        is_active: isActive,
      };
      if (editingId || customerMode === "one") {
        payload.user_id = Number(userId);
      } else if (customerMode === "all") {
        payload.apply_to_all = true;
      } else {
        payload.user_ids = userIds.map((id) => Number(id));
      }
      return apiClient.adminSaveCommissionSetupRule(payload);
    },
    onSuccess: (res) => {
      const count = res.items?.length ?? 1;
      toast.success(
        editingId
          ? "Commission setup updated"
          : count > 1
            ? `${count} commission setups saved`
            : "Commission setup saved",
      );
      queryClient.invalidateQueries({ queryKey: ["admin", "commission-setup"] });
      resetForm();
    },
    onError,
  });

  const customersSelected =
    editingId || customerMode === "one"
      ? Boolean(userId)
      : customerMode === "all"
        ? customers.length > 0
        : userIds.length > 0;

  const splitHint = splitRemainderHint(serviceCharge, dealerCommission, customerCommission);
  const canSave =
    Boolean(dealerId) &&
    Boolean(txnType) &&
    customersSelected &&
    serviceCharge.amount.trim() !== "" &&
    dealerCommission.amount.trim() !== "" &&
    customerCommission.amount.trim() !== "" &&
    (splitHint == null || !splitHint.startsWith("Dealer commission plus"));

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm sm:p-6">
      <h2 className={cn("text-lg font-semibold", TITLE_BLUE)}>
        {editingId ? "Edit Commission Setup" : "Add Commission Setup"}
      </h2>
      <form
        className="mt-5 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSave) {
            toast.error("Fill every required field before saving.");
            return;
          }
          saveMutation.mutate();
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <RequiredLabel htmlFor="cs-dealer" index={1}>
              Select Dealer
            </RequiredLabel>
            <NativeSelect
              id="cs-dealer"
              value={dealerId}
              onChange={(value) => {
                setDealerId(value);
                setUserId("");
                setUserIds([]);
              }}
              placeholder="Select dealer"
            >
              {(dealersQuery.data?.items ?? []).map((dealer) => (
                <option key={dealer.id} value={dealer.id}>
                  {dealer.name} · {dealer.phone}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <RequiredLabel htmlFor="cs-service" index={2}>
              Select Service
            </RequiredLabel>
            <NativeSelect
              id="cs-service"
              value={txnType}
              onChange={setTxnType}
              placeholder="Select service"
            >
              {SERVICE_CHARGE_OPTIONS.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,18rem)] lg:items-start">
          <div className="space-y-2">
            <RequiredLabel htmlFor="cs-service-charge" index={3}>
              Service Charge
            </RequiredLabel>
            <ChargeField id="cs-service-charge" value={serviceCharge} onChange={setServiceCharge} />
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-3.5 py-3 text-sm text-[#1e40af]">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Service Charge is the extra amount collected on each transaction for this dealer
              and the selected customer(s). Dealer and customer commissions come out of this
              amount; any leftover is credited to Super Admin as a System Charge.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <RequiredLabel htmlFor="cs-dealer-commission" index={4}>
            Dealer Commission
          </RequiredLabel>
          <ChargeField
            id="cs-dealer-commission"
            value={dealerCommission}
            onChange={setDealerCommission}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <RequiredLabel htmlFor="cs-customer" index={5}>
              Select Customer
            </RequiredLabel>
            {!editingId ? (
              <RadioGroup
                value={customerMode}
                onValueChange={(next) => {
                  const mode = next === "multiple" || next === "all" ? next : "one";
                  setCustomerMode(mode);
                  if (mode === "one" && userIds.length === 1) setUserId(userIds[0]);
                }}
                className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="one" id="cs-customer-one" />
                  One customer
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="multiple" id="cs-customer-multiple" />
                  Multiple customers
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="all" id="cs-customer-all" />
                  All customers
                </label>
              </RadioGroup>
            ) : null}
            {editingId || customerMode === "one" ? (
              <NativeSelect
                id="cs-customer"
                value={userId}
                onChange={(value) => {
                  setUserId(value);
                  setUserIds(value ? [value] : []);
                }}
                disabled={!dealerId}
                placeholder={dealerId ? "Select customer" : "Select a dealer first"}
              >
                {customers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.phone}
                  </option>
                ))}
              </NativeSelect>
            ) : customerMode === "all" ? (
              <p className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {dealerId
                  ? customers.length
                    ? `Will save ${customers.length} customer setup${customers.length === 1 ? "" : "s"} for this dealer.`
                    : "This dealer has no customers yet."
                  : "Select a dealer first"}
              </p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-input p-2">
                {!dealerId ? (
                  <p className="px-1 py-1.5 text-sm text-muted-foreground">Select a dealer first</p>
                ) : customers.length === 0 ? (
                  <p className="px-1 py-1.5 text-sm text-muted-foreground">No customers under this dealer.</p>
                ) : (
                  customers.map((user) => {
                    const id = String(user.id);
                    const checked = userIds.includes(id);
                    return (
                      <label
                        key={user.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => {
                            setUserIds((current) =>
                              next === true
                                ? current.includes(id)
                                  ? current
                                  : [...current, id]
                                : current.filter((value) => value !== id),
                            );
                          }}
                        />
                        <span>
                          {user.name} · {user.phone}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <RequiredLabel htmlFor="cs-customer-commission" index={6}>
              Customer Commission
            </RequiredLabel>
            <ChargeField
              id="cs-customer-commission"
              value={customerCommission}
              onChange={setCustomerCommission}
            />
            <p className="text-xs text-muted-foreground">
              Credited back to the customer as cashback after a successful transaction.
              Internal dealer commission and Super Admin system-charge rows are not shown to the user.
            </p>
            {splitHint ? <p className="text-xs font-medium text-[#1e40af]">{splitHint}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            className="h-11 w-full bg-[#16a34a] text-base font-semibold text-white hover:bg-[#15803d] sm:max-w-md"
          >
            <Save className="size-4" />
            {saveMutation.isPending ? "Saving…" : "Save Commission"}
          </Button>
          {editingId ? (
            <Button type="button" variant="outline" className="h-11" onClick={resetForm}>
              Cancel edit
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function CommissionSetupListCard({
  onEdit,
  onError,
}: {
  onEdit: (rule: CommissionSetupRule) => void;
  onError: (err: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const listQuery = useQuery({
    queryKey: ["admin", "commission-setup", "rules", debouncedQ, page],
    queryFn: () =>
      apiClient.adminCommissionSetupRules({
        q: debouncedQ,
        page,
        page_size: PAGE_SIZE,
      }),
  });

  const items = listQuery.data?.items ?? [];
  const count = listQuery.data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const from = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, count);

  const statusMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      apiClient.adminUpdateCommissionSetupRule(id, { is_active }),
    onSuccess: (res) => {
      toast.success(res.item.is_active ? "Setup activated" : "Setup deactivated");
      queryClient.invalidateQueries({ queryKey: ["admin", "commission-setup"] });
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.adminDeleteCommissionSetupRule(id),
    onSuccess: () => {
      toast.success("Commission setup deleted");
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "commission-setup"] });
    },
    onError,
  });

  const pages = useMemo(() => {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }, [pageCount]);

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className={cn("text-lg font-semibold", TITLE_BLUE)}>Commission Setup List</h2>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search..."
            className="h-10 pl-9"
          />
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <Table className="min-w-[56rem]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-12">#</TableHead>
              <TableHead>Dealer</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Service Charge</TableHead>
              <TableHead>Dealer Commission</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Customer Commission</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  Loading commission setups…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  No commission setups yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell className="tabular">{serialNumber(page, PAGE_SIZE, index)}</TableCell>
                  <TableCell className="font-medium">{row.dealer_name}</TableCell>
                  <TableCell>{row.service_label}</TableCell>
                  <TableCell>{formatCharge(row.service_charge)}</TableCell>
                  <TableCell>{formatCharge(row.dealer_commission)}</TableCell>
                  <TableCell>{row.user_name}</TableCell>
                  <TableCell>{formatCharge(row.customer_commission)}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      disabled={statusMutation.isPending}
                      onClick={() =>
                        statusMutation.mutate({ id: row.id, is_active: !row.is_active })
                      }
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        row.is_active
                          ? "bg-[#dcfce7] text-[#15803d]"
                          : "bg-[#fee2e2] text-[#dc2626]",
                      )}
                    >
                      {row.is_active ? "Active" : "Inactive"}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="Edit commission setup"
                        className="inline-flex size-8 items-center justify-center rounded-md bg-[#dbeafe] text-[#2563eb] hover:bg-[#bfdbfe]"
                        onClick={() => onEdit(row)}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete commission setup"
                        className="inline-flex size-8 items-center justify-center rounded-md bg-[#fee2e2] text-[#dc2626] hover:bg-[#fecaca]"
                        onClick={() => setDeleteId(row.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {from} to {to} of {count} entries.
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          {pages.map((pageNumber) => (
            <Button
              key={pageNumber}
              type="button"
              size="sm"
              variant={pageNumber === page ? "default" : "outline"}
              className={cn(
                pageNumber === page && "bg-[#2563eb] text-white hover:bg-[#1d4ed8]",
              )}
              onClick={() => setPage(pageNumber)}
            >
              {pageNumber}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      <AlertDialog open={deleteId != null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this commission setup?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the service charge and customer cashback for this customer and service.
              Dealer commission for the service is kept if other customers still use it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId != null && deleteMutation.mutate(deleteId)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
