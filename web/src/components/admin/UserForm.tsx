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
import type { AccountStatus, AdminUser, AdminUserWritePayload } from "@/lib/types";

export type UserFormValues = {
  phone: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  account_status: AccountStatus;
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
    account_status: user?.account_status ?? "approved",
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
    };
    if (values.password || mode === "create") {
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
        {mode === "edit" && (
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
              required={mode === "create"}
              autoComplete="new-password"
              minLength={mode === "create" || values.password ? 8 : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password2">Confirm password</Label>
            <PasswordInput
              id="password2"
              value={values.password2}
              onChange={(e) => set("password2", e.target.value)}
              required={mode === "create" || Boolean(values.password)}
              autoComplete="new-password"
              minLength={mode === "create" || values.password2 ? 8 : undefined}
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
            Pending users can sign in but cannot perform remittance, top-up or transfers.
          </p>
        </div>
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
