import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/app/profile_/pin")({
  head: () => ({
    meta: [
      { title: "Transaction PIN — MySewa" },
      {
        name: "description",
        content: "Set your MySewa transaction PIN for payments and transfers.",
      },
      { property: "og:title", content: "Transaction PIN — MySewa" },
    ],
  }),
  component: SetTransactionPinPage,
});

function SetTransactionPinPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);

  const alreadySet = Boolean(user?.has_transaction_pin);

  return (
    <UserShell title={t("pin.setTitle")} back="/app/profile">
      {alreadySet ? (
        <div className="inset-group space-y-3 p-4">
          <p className="text-sm text-muted-foreground">{t("pin.alreadySet")}</p>
          <Button type="button" variant="secondary" className="w-full" onClick={() => navigate({ to: "/app/profile" })}>
            {t("common.back")}
          </Button>
        </div>
      ) : (
        <form
          className="inset-group space-y-4 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pin !== confirmPin) {
              toast.error(t("pin.mismatch"));
              return;
            }
            if (!/^\d{4}$/.test(pin)) {
              toast.error(t("pin.invalidFormat"));
              return;
            }
            setSaving(true);
            try {
              await apiClient.setTransactionPin({
                transaction_pin: pin,
                confirm_pin: confirmPin,
              });
              await refreshProfile();
              toast.success(t("pin.setSuccess"));
              navigate({ to: "/app/profile" });
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : t("profile.updateFailed"));
            } finally {
              setSaving(false);
            }
          }}
        >
          <p className="text-sm text-muted-foreground">{t("pin.setIntro")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="transaction_pin">{t("pin.label")}</Label>
            <PasswordInput
              id="transaction_pin"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              required
              minLength={4}
              maxLength={4}
              placeholder="••••"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm_pin">{t("pin.confirmLabel")}</Label>
            <PasswordInput
              id="confirm_pin"
              inputMode="numeric"
              autoComplete="off"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              required
              minLength={4}
              maxLength={4}
              placeholder="••••"
            />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? t("common.updating") : t("pin.setPinCta")}
          </Button>
        </form>
      )}
    </UserShell>
  );
}
