import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AccountStatus, AdminUser, AdminUserWritePayload, UserRole } from "@/lib/types";
import { apiClient } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export type UserFormValues = {
  phone: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  account_status: AccountStatus;
  role: UserRole;
  assigned_dealer: number | null;
  parent_agent: number | null;
  assigned_sub_agent: number | null;
  can_fund_transfer: boolean;
  can_wallet_adjust: boolean;
  can_remittance_transfer: boolean;
  commission_rate: string;
  tds_rate: string;
  sub_agent_commission_rate: string;
  super_admin_rate: string;
  password: string;
  password2: string;
};

function fromUser(user?: AdminUser | null): UserFormValues {
  return {
    phone: user?.phone ?? "",
    email: user?.email ?? "",
    first_name: user?.first_name ?? "",
    last_name: user?.last_name ?? "",
    is_active: user?.is_active ?? true,
    is_staff: user?.is_staff ?? false,
    is_superuser: user?.is_superuser ?? false,
    account_status: user?.account_status ?? "pending",
    role: user?.role ?? "customer",
    assigned_dealer: user?.assigned_dealer_id ?? user?.assigned_dealer?.id ?? null,
    parent_agent: user?.parent_agent_id ?? user?.parent_agent?.id ?? null,
    assigned_sub_agent: user?.assigned_sub_agent_id ?? user?.assigned_sub_agent?.id ?? null,
    can_fund_transfer: user?.can_fund_transfer ?? true,
    can_wallet_adjust: user?.can_wallet_adjust ?? true,
    can_remittance_transfer: user?.can_remittance_transfer ?? true,
    commission_rate: user?.commission_rate ?? "0",
    tds_rate: user?.tds_rate ?? "",
    sub_agent_commission_rate: user?.sub_agent_commission_rate ?? "0",
    super_admin_rate: user?.super_admin_rate ?? "0",
    password: "",
    password2: "",
  };
}

export function UserForm({
  mode,
  initialUser,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initialUser?: AdminUser | null;
  submitting?: boolean;
  onSubmit: (payload: AdminUserWritePayload) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<UserFormValues>(() => fromUser(initialUser));
  const dealersQuery = useQuery({
    queryKey: ["admin", "users", "dealers"],
    queryFn: () => apiClient.adminUsers({ role: "dealer" }),
  });
  const dealers = dealersQuery.data?.items ?? [];

  const set = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedEmail = values.email.trim();
    if (mode === "create" && !trimmedEmail) {
      return;
    }
    const payload: AdminUserWritePayload = {
      phone: values.phone.trim(),
      email: trimmedEmail,
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      is_active: values.is_active,
      is_staff: values.is_staff,
      is_superuser: values.is_superuser,
      account_status: values.account_status,
      role: values.role,
      assigned_dealer: values.role === "dealer" ? null : values.assigned_dealer,
      can_fund_transfer: values.can_fund_transfer,
      can_wallet_adjust: values.can_wallet_adjust,
      can_remittance_transfer: values.can_remittance_transfer,
    };
    if (values.role === "dealer") {
      payload.commission_rate = values.commission_rate || "0";
      payload.tds_rate = values.tds_rate.trim() === "" ? null : values.tds_rate;
    }
    if (values.password) {
      payload.password = values.password;
      payload.password2 = values.password2;
    }
    onSubmit(payload);
  };

  return (
    <form
      className="min-w-0 max-w-full space-y-5 rounded-xl border border-border bg-surface p-4 sm:p-5"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            required
            autoComplete="tel"
            placeholder="98XXXXXXXX"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="first_name">First name</Label>
          <Input
            id="first_name"
            value={values.first_name}
            onChange={(e) => set("first_name", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last_name">Last name</Label>
          <Input
            id="last_name"
            value={values.last_name}
            onChange={(e) => set("last_name", e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            required={mode === "create"}
            autoComplete="email"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">
          {mode === "create" ? "Password" : "Change password"}
        </p>
        {mode === "create" ? (
          <p className="text-xs text-muted-foreground">
            Optional. Leave blank to auto-generate. The password is emailed to the address above.
            The account starts as Pending until Super Admin approval.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Leave blank to keep the current password. Fill both fields to reset it.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="password">
              {mode === "create" ? "Password" : "New password"}
            </Label>
            <PasswordInput
              id="password"
              value={values.password}
              onChange={(e) => set("password", e.target.value)}
              required={false}
              autoComplete="new-password"
              minLength={values.password ? 8 : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password2">Confirm password</Label>
            <PasswordInput
              id="password2"
              value={values.password2}
              onChange={(e) => set("password2", e.target.value)}
              required={Boolean(values.password)}
              autoComplete="new-password"
              minLength={values.password2 ? 8 : undefined}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Account status</p>
        <div className="space-y-1.5">
          <Label htmlFor="account_status">Status</Label>
          <Select
            value={values.account_status}
            onValueChange={(v) => set("account_status", v as AccountStatus)}
            disabled={mode === "create"}
          >
            <SelectTrigger id="account_status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Active</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {mode === "create"
              ? "New users start as Pending. Super Admin must approve before they can transact. Login credentials are emailed automatically."
              : "Pending users can sign in but cannot perform remittance, top-up or transfers."}
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Hierarchy</p>
        <p className="text-xs text-muted-foreground">
          Admin → Dealer → User. A User can optionally be assigned to a Dealer for commission.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <Select
            value={values.role}
            onValueChange={(v) => set("role", v as UserRole)}
          >
            <SelectTrigger id="role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="customer">User</SelectItem>
              <SelectItem value="dealer">Dealer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {values.role !== "dealer" ? (
          <div className="space-y-1.5">
            <Label htmlFor="assigned_dealer">Assigned Dealer (optional)</Label>
            <Select
              value={values.assigned_dealer ? String(values.assigned_dealer) : "none"}
              onValueChange={(v) => {
                const dealerId = v === "none" ? null : Number(v);
                setValues((prev) => ({ ...prev, assigned_dealer: dealerId }));
              }}
            >
              <SelectTrigger id="assigned_dealer" className="w-full">
                <SelectValue placeholder="Select dealer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {dealers.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.phone}
                    {d.first_name || d.last_name
                      ? ` — ${[d.first_name, d.last_name].filter(Boolean).join(" ")}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {values.role === "dealer" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="commission_rate">Dealer commission (Rs)</Label>
              <Input
                id="commission_rate"
                type="number"
                min="0"
                step="0.01"
                value={values.commission_rate}
                onChange={(e) => set("commission_rate", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tds_rate">TDS rate (%) — blank uses global default</Label>
              <Input
                id="tds_rate"
                type="number"
                min="0"
                step="0.01"
                value={values.tds_rate}
                onChange={(e) => set("tds_rate", e.target.value)}
                placeholder="Global default"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Permissions</p>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="is_active" className="font-normal">
            Login enabled
          </Label>
          <Switch
            id="is_active"
            checked={values.is_active}
            onCheckedChange={(checked) => set("is_active", checked)}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="is_staff" className="font-normal">
            Staff (admin access)
          </Label>
          <Switch
            id="is_staff"
            checked={values.is_staff}
            onCheckedChange={(checked) => set("is_staff", checked)}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="is_superuser" className="font-normal">
            Superuser
          </Label>
          <Switch
            id="is_superuser"
            checked={values.is_superuser}
            onCheckedChange={(checked) => set("is_superuser", checked)}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">Feature access</p>
        <p className="text-xs text-muted-foreground">
          Grant or revoke this user's ability to perform fund transfers, remittance, and wallet transfers.
        </p>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="can_fund_transfer" className="font-normal">
              Fund Transfer
            </Label>
            <p className="text-xs text-muted-foreground">Send money to bank accounts</p>
          </div>
          <Switch
            id="can_fund_transfer"
            checked={values.can_fund_transfer}
            onCheckedChange={(checked) => set("can_fund_transfer", checked)}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="can_remittance_transfer" className="font-normal">
              Remittance Fund Transfer
            </Label>
            <p className="text-xs text-muted-foreground">Look up and receive remittance payouts</p>
          </div>
          <Switch
            id="can_remittance_transfer"
            checked={values.can_remittance_transfer}
            onCheckedChange={(checked) => set("can_remittance_transfer", checked)}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="can_wallet_adjust" className="font-normal">
              Wallet Transfer
            </Label>
            <p className="text-xs text-muted-foreground">
              Send wallet balance to another MySewa user. Staff with this enabled can also
              manually load or debit wallets.
            </p>
          </div>
          <Switch
            id="can_wallet_adjust"
            checked={values.can_wallet_adjust}
            onCheckedChange={(checked) => set("can_wallet_adjust", checked)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting
            ? mode === "create"
              ? "Creating…"
              : "Saving…"
            : mode === "create"
              ? "Create user"
              : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
