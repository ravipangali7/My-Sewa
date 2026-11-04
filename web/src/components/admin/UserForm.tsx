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
import {
  User,
  ShieldCheck,
  KeyRound,
  Coins,
  Percent,
  Banknote,
  Send,
  Building2,
  Lock,
  Sparkles,
  Gamepad2,
  Info,
  CheckCircle2,
  GitBranch,
} from "lucide-react";

export type UserFormValues = {
  phone: string;
  email: string;
  first_name: string;
  last_name: string;
  nickname: string;
  business_name: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  account_status: AccountStatus;
  role: UserRole;
  assigned_dealer: number | null;
  parent_agent: number | null;
  assigned_sub_agent: number | null;
  share_percent: string;
  can_fund_transfer: boolean;
  can_wallet_adjust: boolean;
  can_remittance_transfer: boolean;
  can_api_payin: boolean;
  is_api_user: boolean;
  is_ggr_user: boolean;
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
    nickname: user?.nickname ?? "",
    business_name: user?.business_name ?? "",
    is_active: user?.is_active ?? true,
    is_staff: user?.is_staff ?? false,
    is_superuser: user?.is_superuser ?? false,
    account_status: user?.account_status ?? "pending",
    role: user?.role ?? "customer",
    assigned_dealer: user?.assigned_dealer_id ?? user?.assigned_dealer?.id ?? null,
    parent_agent: user?.parent_agent_id ?? user?.parent_agent?.id ?? null,
    assigned_sub_agent: user?.assigned_sub_agent_id ?? user?.assigned_sub_agent?.id ?? null,
    share_percent: user?.share_percent != null ? String(user.share_percent) : "0.00",
    can_fund_transfer: user?.can_fund_transfer ?? true,
    can_wallet_adjust: user?.can_wallet_adjust ?? true,
    can_remittance_transfer: user?.can_remittance_transfer ?? true,
    can_api_payin: user?.can_api_payin ?? false,
    is_api_user: user?.is_api_user ?? false,
    is_ggr_user: user?.is_ggr_user ?? user?.is_ggr ?? false,
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
      nickname: values.nickname.trim(),
      business_name: values.business_name.trim(),
      is_active: values.is_active,
      is_staff: values.is_staff,
      is_superuser: values.is_superuser,
      account_status: values.account_status,
      role: values.role,
      assigned_dealer: values.role === "customer" ? values.assigned_dealer : null,
      can_fund_transfer: values.can_fund_transfer,
      can_wallet_adjust: values.can_wallet_adjust,
      can_remittance_transfer: values.can_remittance_transfer,
      can_api_payin: values.can_api_payin,
      is_api_user: values.is_api_user,
      is_ggr_user: values.is_ggr_user,
      is_ggr: values.is_ggr_user,
    };

    if (values.role === "shareholder") {
      payload.share_percent = values.share_percent ? String(values.share_percent) : "0.00";
    }

    if (values.role === "dealer") {
      payload.commission_rate = values.commission_rate || "0";
      payload.tds_rate = values.tds_rate.trim() === "" ? null : values.tds_rate;
      payload.sub_agent_commission_rate = values.sub_agent_commission_rate || "0";
      payload.super_admin_rate = values.super_admin_rate || "0";
    }

    if (values.password) {
      payload.password = values.password;
      payload.password2 = values.password2;
    }
    onSubmit(payload);
  };

  return (
    <form className="min-w-0 max-w-full space-y-6" onSubmit={handleSubmit}>
      {/* GROUP 1: Personal & Business Identity */}
      <div className="rounded-md border border-slate-200 bg-white p-5 sm:p-6 shadow-xs ">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-200/90">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            <User className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Identity & Contact Profile</h3>
            <p className="text-xs text-muted-foreground">Primary account details and display identity</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-1">
            <Label htmlFor="phone" className="text-xs font-semibold">
              Phone Number <span className="text-danger">*</span>
            </Label>
            <Input
              id="phone"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              required
              autoComplete="tel"
              placeholder="e.g. 98XXXXXXXX"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">Unique login identifier and mobile number</p>
          </div>

          <div className="space-y-1.5 sm:col-span-1">
            <Label htmlFor="email" className="text-xs font-semibold">
              Email Address {mode === "create" && <span className="text-danger">*</span>}
            </Label>
            <Input
              id="email"
              type="email"
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              required={mode === "create"}
              autoComplete="email"
              placeholder="user@example.com"
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">Used for credential dispatch and notifications</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="first_name" className="text-xs font-semibold">
              First Name
            </Label>
            <Input
              id="first_name"
              value={values.first_name}
              onChange={(e) => set("first_name", e.target.value)}
              placeholder="Given name"
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="last_name" className="text-xs font-semibold">
              Last Name
            </Label>
            <Input
              id="last_name"
              value={values.last_name}
              onChange={(e) => set("last_name", e.target.value)}
              placeholder="Family / Surname"
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nickname" className="text-xs font-semibold">
              Nickname / Alias
            </Label>
            <Input
              id="nickname"
              value={values.nickname}
              onChange={(e) => set("nickname", e.target.value)}
              placeholder="Display nickname"
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="business_name" className="text-xs font-semibold">
              Business / Store Name
            </Label>
            <Input
              id="business_name"
              value={values.business_name}
              onChange={(e) => set("business_name", e.target.value)}
              placeholder="e.g. Acme Enterprises / My Store"
              className="text-sm"
            />
          </div>
        </div>
      </div>

      {/* GROUP 2: Security & Authentication */}
      <div className="rounded-md border border-slate-200 bg-white p-5 sm:p-6 shadow-xs ">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-200/90">
          <div className="flex size-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400">
            <Lock className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Security & Login Credentials</h3>
            <p className="text-xs text-muted-foreground">Password controls and authorization lifecycle</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold">
                {mode === "create" ? "Initial Password" : "New Password"}
              </Label>
              <PasswordInput
                id="password"
                value={values.password}
                onChange={(e) => set("password", e.target.value)}
                required={false}
                autoComplete="new-password"
                placeholder={mode === "create" ? "Leave blank to auto-generate" : "Leave blank to retain current"}
                minLength={values.password ? 8 : undefined}
                className="text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                {mode === "create"
                  ? "If blank, a secure random password will be auto-generated and emailed."
                  : "Only fill if you want to reset the user's password (min 8 chars)."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password2" className="text-xs font-semibold">
                Confirm Password
              </Label>
              <PasswordInput
                id="password2"
                value={values.password2}
                onChange={(e) => set("password2", e.target.value)}
                required={Boolean(values.password)}
                autoComplete="new-password"
                placeholder="Repeat password"
                minLength={values.password2 ? 8 : undefined}
                className="text-sm"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-slate-200/70">
            <div className="space-y-1.5">
              <Label htmlFor="account_status" className="text-xs font-semibold">
                Account Activation Status
              </Label>
              <Select
                value={values.account_status}
                onValueChange={(v) => set("account_status", v as AccountStatus)}
                disabled={mode === "create"}
              >
                <SelectTrigger id="account_status" className="w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Active (Approved to transact)</SelectItem>
                  <SelectItem value="pending">Pending Approval (Restricted)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {mode === "create"
                  ? "New users start as Pending until Super Admin approval."
                  : "Pending accounts can log in but cannot process outgoing transactions."}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-sm border border-slate-200/90 bg-slate-50/60 p-3 /50">
              <div className="min-w-0">
                <Label htmlFor="is_active" className="text-xs font-semibold">
                  Login Permitted
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Allow this user to sign in to mobile & web apps
                </p>
              </div>
              <Switch
                id="is_active"
                checked={values.is_active}
                onCheckedChange={(checked) => set("is_active", checked)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* GROUP 3: Role & Business Hierarchy */}
      <div className="rounded-md border border-slate-200 bg-white p-5 sm:p-6 shadow-xs ">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-200/90">
          <div className="flex size-8 items-center justify-center rounded-lg bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400">
            <GitBranch className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Role & Business Hierarchy</h3>
            <p className="text-xs text-muted-foreground">
              Define whether this account is a Regular User, Dealer Agent, or Shareholder Partner
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="role" className="text-xs font-semibold">
              Account Role
            </Label>
            <Select
              value={values.role}
              onValueChange={(v) => {
                const nextRole = v as UserRole;
                set("role", nextRole);
                if (nextRole === "shareholder" && (!values.share_percent || values.share_percent === "0")) {
                  set("share_percent", "10.00");
                }
              }}
            >
              <SelectTrigger id="role" className="w-full text-sm font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Regular User / Customer</SelectItem>
                <SelectItem value="dealer">Dealer / Agent Partner</SelectItem>
                <SelectItem value="shareholder">Shareholder Partner (Equity & Platform Dividend)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* SHAREHOLDER SPECIFIC CONFIG */}
          {values.role === "shareholder" && (
            <div className="rounded-sm border border-amber-200 bg-amber-50/50 p-4 space-y-3 dark:border-amber-900/60 dark:bg-amber-950/30">
              <div className="flex items-start gap-2.5">
                <Coins className="size-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    Shareholder Equity & Dividend Participation
                  </h4>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5 leading-relaxed">
                    Shareholders receive automated equity dividend disbursements from the monthly 10% GGR profit cut
                    and real-time Payment API service fee splits. A Shareholder equity wallet is bound automatically.
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-amber-200/80 dark:border-amber-900/60">
                <Label htmlFor="share_percent" className="text-xs font-bold text-amber-950 dark:text-amber-200">
                  Allocated Equity Share (%)
                </Label>
                <div className="relative mt-1 max-w-xs">
                  <Input
                    id="share_percent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={values.share_percent}
                    onChange={(e) => set("share_percent", e.target.value)}
                    placeholder="10.00"
                    className="pr-8 font-mono text-sm font-bold bg-white  border-amber-300 dark:border-amber-700"
                  />
                  <div className="absolute inset-y-0 right-2.5 flex items-center pointer-events-none text-muted-foreground font-bold text-xs">
                    %
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Percentage of total available platform fee pool allocated to this shareholder partner.
                </p>
              </div>
            </div>
          )}

          {/* REGULAR USER SPECIFIC CONFIG (ASSIGNED DEALER) */}
          {values.role === "customer" && (
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="assigned_dealer" className="text-xs font-semibold">
                Assigned Dealer (Optional)
              </Label>
              <Select
                value={values.assigned_dealer ? String(values.assigned_dealer) : "none"}
                onValueChange={(v) => {
                  const dealerId = v === "none" ? null : Number(v);
                  setValues((prev) => ({ ...prev, assigned_dealer: dealerId }));
                }}
              >
                <SelectTrigger id="assigned_dealer" className="w-full text-sm">
                  <SelectValue placeholder="Select dealer (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — Direct Customer</SelectItem>
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
              <p className="text-[11px] text-muted-foreground">
                If assigned, transactions made by this user yield commissions to the selected dealer.
              </p>
            </div>
          )}

          {/* DEALER SPECIFIC CONFIG */}
          {values.role === "dealer" && (
            <div className="space-y-3 rounded-sm border border-indigo-200/80 bg-indigo-50/40 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/20">
              <h4 className="text-xs font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-2">
                <Building2 className="size-4 text-indigo-600" />
                Dealer Commission & Tax Configuration
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="commission_rate" className="text-xs font-semibold">
                    Fixed Commission (Rs)
                  </Label>
                  <Input
                    id="commission_rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={values.commission_rate}
                    onChange={(e) => set("commission_rate", e.target.value)}
                    className="font-mono text-sm bg-white "
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tds_rate" className="text-xs font-semibold">
                    TDS Rate (%)
                  </Label>
                  <Input
                    id="tds_rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={values.tds_rate}
                    onChange={(e) => set("tds_rate", e.target.value)}
                    placeholder="Global default"
                    className="font-mono text-sm bg-white "
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sub_agent_commission_rate" className="text-xs font-semibold">
                    Sub-Agent Commission (Rs)
                  </Label>
                  <Input
                    id="sub_agent_commission_rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={values.sub_agent_commission_rate}
                    onChange={(e) => set("sub_agent_commission_rate", e.target.value)}
                    className="font-mono text-sm bg-white "
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="super_admin_rate" className="text-xs font-semibold">
                    Super Admin Rate (Rs)
                  </Label>
                  <Input
                    id="super_admin_rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={values.super_admin_rate}
                    onChange={(e) => set("super_admin_rate", e.target.value)}
                    className="font-mono text-sm bg-white "
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GROUP 4: Developer API & Gaming Integrations */}
      <div className="rounded-md border border-slate-200 bg-white p-5 sm:p-6 shadow-xs ">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-200/90">
          <div className="flex size-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400">
            <KeyRound className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Developer API & Gaming Capabilities</h3>
            <p className="text-xs text-muted-foreground">
              Grant API key authentication, Payin webhook permissions, and GGR gaming coin features
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {/* IS API USER SWITCH */}
          <div className="flex items-center justify-between gap-4 rounded-sm border border-slate-200/90 bg-slate-50/50 p-3.5 transition-colors hover:bg-slate-50 /40">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="is_api_user" className="text-xs font-bold text-foreground cursor-pointer">
                  Developer API Access (`is_api_user`)
                </Label>
                {values.is_api_user && (
                  <span className="rounded-full bg-teal-100 px-2 py-0.2 text-[9px] font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                    Active API Partner
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                Generates a unique API Key. Enables automated Fund Transfers, Bank Switch settlements, and external merchant API integrations.
              </p>
            </div>
            <Switch
              id="is_api_user"
              checked={values.is_api_user}
              onCheckedChange={(checked) => {
                set("is_api_user", checked);
                if (!checked) {
                  set("can_api_payin", false);
                }
              }}
            />
          </div>

          {/* CAN API PAYIN SWITCH */}
          <div
            className={`flex items-center justify-between gap-4 rounded-sm border p-3.5 transition-colors ${
              values.is_api_user
                ? "border-slate-200/90 bg-slate-50/50 hover:bg-slate-50 /40"
                : "border-slate-200/40 bg-slate-50/20 opacity-60"
            }`}
          >
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="can_api_payin"
                className={`text-xs font-bold ${values.is_api_user ? "cursor-pointer text-foreground" : "text-muted-foreground"}`}
              >
                Payin / Wallet Load API Permission (`can_api_payin`)
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                Permits this API client to initiate checkout links and deposit credits directly into other MySewa wallets.
              </p>
            </div>
            <Switch
              id="can_api_payin"
              checked={values.can_api_payin}
              onCheckedChange={(checked) => set("can_api_payin", checked)}
              disabled={!values.is_api_user}
            />
          </div>

          {/* IS GGR USER SWITCH */}
          <div className="flex items-center justify-between gap-4 rounded-sm border border-slate-200/90 bg-slate-50/50 p-3.5 transition-colors hover:bg-slate-50 /40">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="is_ggr_user" className="text-xs font-bold text-foreground cursor-pointer flex items-center gap-1.5">
                  <Gamepad2 className="size-3.5 text-emerald-600" />
                  GGR Coin Gaming Services (`is_ggr`)
                </Label>
                {values.is_ggr_user && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.2 text-[9px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    GGR Enabled
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                Permits this user/merchant to engage with GGR gaming coin balance, game event webhooks, and casino/gaming ledger systems. Automatically binds GGR coin wallet.
              </p>
            </div>
            <Switch
              id="is_ggr_user"
              checked={values.is_ggr_user}
              onCheckedChange={(checked) => set("is_ggr_user", checked)}
            />
          </div>
        </div>
      </div>

      {/* GROUP 5: Financial Operations & Feature Permissions */}
      <div className="rounded-md border border-slate-200 bg-white p-5 sm:p-6 shadow-xs ">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-200/90">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            <Banknote className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Financial Feature Permissions</h3>
            <p className="text-xs text-muted-foreground">
              Control granular financial transaction capabilities on this account
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col justify-between rounded-sm border border-slate-200/90 bg-slate-50/40 p-3.5 /40">
            <div>
              <Label htmlFor="can_fund_transfer" className="text-xs font-bold text-foreground cursor-pointer">
                Fund Transfers
              </Label>
              <p className="text-[11px] text-muted-foreground mt-1">
                Outward interbank transfers to commercial banks
              </p>
            </div>
            <div className="pt-3">
              <Switch
                id="can_fund_transfer"
                checked={values.can_fund_transfer}
                onCheckedChange={(checked) => set("can_fund_transfer", checked)}
              />
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-sm border border-slate-200/90 bg-slate-50/40 p-3.5 /40">
            <div>
              <Label htmlFor="can_remittance_transfer" className="text-xs font-bold text-foreground cursor-pointer">
                Remittances
              </Label>
              <p className="text-[11px] text-muted-foreground mt-1">
                Lookup & claim remittance cash payouts
              </p>
            </div>
            <div className="pt-3">
              <Switch
                id="can_remittance_transfer"
                checked={values.can_remittance_transfer}
                onCheckedChange={(checked) => set("can_remittance_transfer", checked)}
              />
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-sm border border-slate-200/90 bg-slate-50/40 p-3.5 /40">
            <div>
              <Label htmlFor="can_wallet_adjust" className="text-xs font-bold text-foreground cursor-pointer">
                Wallet Transfers
              </Label>
              <p className="text-[11px] text-muted-foreground mt-1">
                Send peer-to-peer balance to other MySewa wallets
              </p>
            </div>
            <div className="pt-3">
              <Switch
                id="can_wallet_adjust"
                checked={values.can_wallet_adjust}
                onCheckedChange={(checked) => set("can_wallet_adjust", checked)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* GROUP 6: System Privileges & Admin Control (Superadmin only) */}
      <div className="rounded-md border border-purple-200/80 bg-purple-50/20 p-5 sm:p-6 shadow-xs dark:border-purple-900/60 dark:bg-purple-950/10">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-purple-200/70 dark:border-purple-900/50">
          <div className="flex size-8 items-center justify-center rounded-lg bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300">
            <ShieldCheck className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-purple-950 dark:text-purple-200">
              System Administration Privileges
            </h3>
            <p className="text-xs text-purple-800/80 dark:text-purple-300/80">
              Administrative access to back-office consoles (Superadmin authorization)
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-sm border border-slate-200/90 bg-white p-3.5 shadow-2xs ">
            <div className="min-w-0">
              <Label htmlFor="is_staff" className="text-xs font-bold text-foreground cursor-pointer">
                Staff Admin Access (`is_staff`)
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Grants access to the Admin portal and operational queues
              </p>
            </div>
            <Switch
              id="is_staff"
              checked={values.is_staff}
              onCheckedChange={(checked) => set("is_staff", checked)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-sm border border-slate-200/90 bg-white p-3.5 shadow-2xs ">
            <div className="min-w-0">
              <Label htmlFor="is_superuser" className="text-xs font-bold text-foreground cursor-pointer">
                Superuser Status (`is_superuser`)
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Full unrestricted administrative root permissions
              </p>
            </div>
            <Switch
              id="is_superuser"
              checked={values.is_superuser}
              onCheckedChange={(checked) => set("is_superuser", checked)}
            />
          </div>
        </div>
      </div>

      {/* Form Action Controls */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          type="submit"
          disabled={submitting}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-6 shadow-sm"
        >
          {submitting
            ? mode === "create"
              ? "Creating Account…"
              : "Saving Changes…"
            : mode === "create"
              ? "Create User Account"
              : "Save Account Changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
          className="border-slate-200 text-foreground hover:bg-slate-50 dark:hover:bg-muted"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
