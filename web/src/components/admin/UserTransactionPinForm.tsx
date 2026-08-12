import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { apiClient, ApiError } from "@/lib/api";

function digitsOnly(value: string, max = 4) {
  return value.replace(/\D/g, "").slice(0, max);
}

export function UserTransactionPinForm({
  userId,
  hasPin,
}: {
  userId: number;
  hasPin: boolean;
}) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.adminSetUserTransactionPin(userId, {
        transaction_pin: pin,
        confirm_pin: confirmPin,
      }),
    onSuccess: (data) => {
      toast.success(data.message || "Transaction PIN updated");
      setPin("");
      setConfirmPin("");
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "users", userId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const body =
          err.body && typeof err.body === "object"
            ? (err.body as { errors?: Record<string, string[] | string>; error?: string })
            : null;
        const fieldErrors = body?.errors;
        const firstField = (key: string) => {
          const value = fieldErrors?.[key];
          if (Array.isArray(value)) return value[0];
          return typeof value === "string" ? value : undefined;
        };
        const message =
          firstField("confirm_pin") ||
          firstField("transaction_pin") ||
          body?.error ||
          err.message;
        setFormError(message);
        toast.error(message);
        return;
      }
      setFormError("Could not update transaction PIN");
      toast.error("Could not update transaction PIN");
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (pin.length !== 4 || confirmPin.length !== 4) {
      setFormError("Transaction PIN must be exactly 4 digits.");
      return;
    }
    if (pin !== confirmPin) {
      setFormError("PIN fields did not match.");
      return;
    }
    mutation.mutate();
  };

  return (
    <form
      className="min-w-0 max-w-full space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5"
      onSubmit={handleSubmit}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {hasPin ? "Reset transaction PIN" : "Set transaction PIN"}
        </p>
        <p className="text-xs text-muted-foreground">
          Enter and confirm a new 4-digit PIN. The user&apos;s current PIN is not required.
          {hasPin ? " This replaces the existing PIN immediately." : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="admin_transaction_pin">New PIN</Label>
          <PasswordInput
            id="admin_transaction_pin"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(digitsOnly(e.target.value))}
            revealLabel="PIN"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="admin_confirm_pin">Confirm PIN</Label>
          <PasswordInput
            id="admin_confirm_pin"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={4}
            value={confirmPin}
            onChange={(e) => setConfirmPin(digitsOnly(e.target.value))}
            revealLabel="PIN"
            required
          />
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending
          ? "Saving…"
          : hasPin
            ? "Update transaction PIN"
            : "Set transaction PIN"}
      </Button>
    </form>
  );
}
