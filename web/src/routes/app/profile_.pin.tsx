import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
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
        content: "Set or change your MySewa transaction PIN for payments and transfers.",
      },
      { property: "og:title", content: "Transaction PIN — MySewa" },
    ],
  }),
  component: TransactionPinPage,
});

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

function TransactionPinPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const changing = Boolean(user?.has_transaction_pin);

  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const title = changing ? t("pin.changeTitle") : t("pin.setTitle");
  const intro = changing ? t("pin.changeIntro") : t("pin.setIntro");
  const cta = changing ? t("pin.changePinCta") : t("pin.setPinCta");

  const validate = () => {
    if (changing && !/^\d{4}$/.test(currentPin)) {
      return t("pin.invalidFormat");
    }
    if (!/^\d{4}$/.test(pin)) {
      return t("pin.invalidFormat");
    }
    if (pin !== confirmPin) {
      return t("pin.mismatch");
    }
    if (changing && currentPin === pin) {
      return t("pin.sameAsCurrent");
    }
    return null;
  };

  return (
    <UserShell title={title} back="/app/profile">
      <div className="mx-auto w-full max-w-lg space-y-4 px-4 pb-8 pt-2">
        <div className="rounded-2xl border border-brand/15 bg-brand-soft/50 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
              {changing ? <LockKeyhole className="size-5" /> : <KeyRound className="size-5" />}
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-brand-dark">{title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{intro}</p>
            </div>
          </div>
        </div>

        <form
          className="space-y-4 rounded-2xl border border-border/60 bg-white p-4 shadow-[0_8px_28px_-18px_rgba(2,8,23,0.28)]"
          onSubmit={async (e) => {
            e.preventDefault();
            const error = validate();
            if (error) {
              setFormError(error);
              toast.error(error);
              return;
            }
            setFormError(null);
            setSaving(true);
            try {
              if (changing) {
                await apiClient.changeTransactionPin({
                  current_pin: currentPin,
                  transaction_pin: pin,
                  confirm_pin: confirmPin,
                });
                toast.success(t("pin.changeSuccess"));
              } else {
                await apiClient.setTransactionPin({
                  transaction_pin: pin,
                  confirm_pin: confirmPin,
                });
                await refreshProfile();
                toast.success(t("pin.setSuccess"));
              }
              navigate({ to: "/app/profile" });
            } catch (err) {
              const message =
                err instanceof ApiError ? err.message : t("profile.updateFailed");
              setFormError(message);
              toast.error(message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {changing ? (
            <div className="space-y-1.5">
              <Label htmlFor="current_pin">{t("pin.currentLabel")}</Label>
              <PasswordInput
                id="current_pin"
                inputMode="numeric"
                autoComplete="off"
                value={currentPin}
                onChange={(e) => {
                  setCurrentPin(digitsOnly(e.target.value));
                  setFormError(null);
                }}
                required
                minLength={4}
                maxLength={4}
                placeholder="••••"
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="transaction_pin">
              {changing ? t("pin.newLabel") : t("pin.label")}
            </Label>
            <PasswordInput
              id="transaction_pin"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => {
                setPin(digitsOnly(e.target.value));
                setFormError(null);
              }}
              required
              minLength={4}
              maxLength={4}
              placeholder="••••"
            />
            <p className="text-[12px] text-muted-foreground">{t("pin.hint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm_pin">
              {changing ? t("pin.confirmNewLabel") : t("pin.confirmLabel")}
            </Label>
            <PasswordInput
              id="confirm_pin"
              inputMode="numeric"
              autoComplete="off"
              value={confirmPin}
              onChange={(e) => {
                setConfirmPin(digitsOnly(e.target.value));
                setFormError(null);
              }}
              required
              minLength={4}
              maxLength={4}
              placeholder="••••"
            />
          </div>

          {formError ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] font-medium text-destructive"
            >
              {formError}
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-[12px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>{t("history.secureEncrypted")}</span>
          </div>

          <Button type="submit" className="h-11 w-full rounded-xl" disabled={saving}>
            {saving ? t("common.updating") : cta}
          </Button>
        </form>
      </div>
    </UserShell>
  );
}
