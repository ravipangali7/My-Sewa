import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DealerPayoutAccount, PaymentMethod } from "@/lib/types";

export function payoutAccountFormData(values: {
  method: PaymentMethod;
  label: string;
  account_name: string;
  account_number: string;
  bank_name: string;
  branch: string;
  qrFile: File | null;
}): FormData {
  const fd = new FormData();
  fd.append("method", values.method);
  fd.append("label", values.label.trim());
  fd.append("account_name", values.account_name.trim());
  fd.append("account_number", values.account_number.trim());
  fd.append("bank_name", values.bank_name.trim());
  fd.append("branch", values.branch.trim());
  if (values.qrFile) fd.append("qr_code", values.qrFile);
  return fd;
}

export function PayoutAccountForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial?: DealerPayoutAccount | null;
  submitting?: boolean;
  onSubmit: (values: {
    method: PaymentMethod;
    label: string;
    account_name: string;
    account_number: string;
    bank_name: string;
    branch: string;
    qrFile: File | null;
  }) => void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>(initial?.method ?? "esewa");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [accountName, setAccountName] = useState(initial?.account_name ?? "");
  const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? "");
  const [bankName, setBankName] = useState(initial?.bank_name ?? "");
  const [branch, setBranch] = useState(initial?.branch ?? "");
  const [qrFile, setQrFile] = useState<File | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      method,
      label,
      account_name: accountName,
      account_number: accountNumber,
      bank_name: bankName,
      branch,
      qrFile,
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Account type</Label>
          <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="esewa">eSewa</SelectItem>
              <SelectItem value="khalti">Khalti</SelectItem>
              <SelectItem value="bank">Bank Account</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payout-label">Label</Label>
          <Input
            id="payout-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={method === "bank" ? "Nabil current" : method === "khalti" ? "Khalti" : "eSewa"}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payout-name">Account name</Label>
          <Input
            id="payout-name"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payout-number">
            {method === "bank" ? "Account number" : method === "khalti" ? "Khalti ID" : "eSewa ID"}
          </Label>
          <Input
            id="payout-number"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            required
          />
        </div>
        {method === "bank" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="payout-bank">Bank name</Label>
              <Input
                id="payout-bank"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-branch">Branch</Label>
              <Input
                id="payout-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
          </>
        ) : null}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="payout-qr">QR code {initial ? "(optional — leave empty to keep current)" : ""}</Label>
          <Input
            id="payout-qr"
            type="file"
            accept="image/*"
            onChange={(e) => setQrFile(e.target.files?.[0] ?? null)}
            required={!initial}
          />
          {initial?.qr_code_url ? (
            <img
              src={initial.qr_code_url}
              alt="Current payout QR"
              className="mt-2 size-28 rounded-lg border object-contain"
            />
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Saving sends this account for Super Admin approval. It stays Pending until approved.
        Payout accounts cannot be deleted.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save and resubmit" : "Submit for approval"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
