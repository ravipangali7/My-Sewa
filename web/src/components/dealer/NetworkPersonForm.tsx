import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import type { AdminUserWritePayload } from "@/lib/types";

export function NetworkPersonForm({
  title,
  submitLabel,
  submitting,
  includeCommission,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  submitting?: boolean;
  includeCommission?: boolean;
  onSubmit: (payload: AdminUserWritePayload) => void;
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(true);
  const [commissionRate, setCommissionRate] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload: AdminUserWritePayload = {
      phone: phone.trim(),
      email: email.trim(),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      password,
      password2: password,
      is_active: active,
      account_status: "approved",
    };
    if (includeCommission && commissionRate.trim()) {
      payload.commission_rate = commissionRate.trim();
    }
    onSubmit(payload);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <p className="text-sm font-medium">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="np-phone">Mobile</Label>
          <Input id="np-phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="np-email">Email</Label>
          <Input
            id="np-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="np-first">First name</Label>
          <Input id="np-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="np-last">Last name</Label>
          <Input id="np-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="np-pass">Password</Label>
          <PasswordInput
            id="np-pass"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        {includeCommission ? (
          <div className="space-y-1.5">
            <Label htmlFor="np-rate">Commission rate (%)</Label>
            <Input
              id="np-rate"
              type="number"
              min="0"
              step="0.01"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
        <Label htmlFor="np-active" className="font-normal">
          Active
        </Label>
        <Switch id="np-active" checked={active} onCheckedChange={setActive} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
