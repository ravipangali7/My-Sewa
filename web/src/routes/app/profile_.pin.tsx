import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/profile_/pin")({
  head: () => ({
    meta: [
      { title: "Transaction PIN — MySewa" },
      {
        name: "description",
        content: "Set, change, or reset your MySewa transaction PIN for payments and transfers.",
      },
      { property: "og:title", content: "Transaction PIN — MySewa" },
    ],
  }),
  component: TransactionPinPage,
});

function digitsOnly(value: string, max = 4) {
  return value.replace(/\D/g, "").slice(0, max);
}

type PinMode = "set" | "change" | "reset";
type ResetMethod = "password" | "otp";

function TransactionPinPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const hasPin = Boolean(user?.has_transaction_pin);
  const otpAvailable = Boolean((user?.email || "").trim());

  const [mode, setMode] = useState<PinMode>(hasPin ? "change" : "set");
  const [resetMethod, setResetMethod] = useState<ResetMethod>("password");

  const [currentPin, setCurrentPin] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setMode((prev) => {
      if (prev === "reset") return prev;
      return hasPin ? "change" : "set";
    });
  }, [hasPin]);

  const title =
    mode === "reset"
      ? t("pin.resetTitle")
      : mode === "change"
        ? t("pin.changeTitle")
        : t("pin.setTitle");
  const intro =
    mode === "reset"
      ? t("pin.resetIntro")
      : mode === "change"
        ? t("pin.changeIntro")
        : t("pin.setIntro");
  const cta =
    mode === "reset"
      ? t("pin.resetCta")
      : mode === "change"
        ? t("pin.changePinCta")
        : t("pin.setPinCta");

  const enterResetMode = () => {
    setMode("reset");
    setResetMethod("password");
    setCurrentPin("");
    setAccountPassword("");
    setOtp("");
    setEmailHint(null);
    setOtpSent(false);
    setPin("");
    setConfirmPin("");
    setFormError(null);
  };

  const exitResetMode = () => {
    setMode(hasPin ? "change" : "set");
    setAccountPassword("");
    setOtp("");
    setEmailHint(null);
    setOtpSent(false);
    setFormError(null);
  };

  const validate = () => {
    if (mode === "change" && !/^\d{4}$/.test(currentPin)) {
      return t("pin.invalidFormat");
    }
    if (mode === "reset") {
      if (resetMethod === "password" && !accountPassword.trim()) {
        return t("pin.passwordRequired");
      }
      if (resetMethod === "otp" && !/^\d{4,10}$/.test(otp.trim())) {
        return t("pin.otpRequired");
      }
    }
    if (!/^\d{4}$/.test(pin)) {
      return t("pin.invalidFormat");
    }
    if (pin !== confirmPin) {
      return t("pin.mismatch");
    }
    if (mode === "change" && currentPin === pin) {
      return t("pin.sameAsCurrent");
    }
    return null;
  };

  const sendResetOtp = async () => {
    setFormError(null);
    setSendingOtp(true);
    try {
      const res = await apiClient.requestTransactionPinResetOtp();
      setOtpSent(true);
      setEmailHint(res.email_hint || user?.email || null);
      setOtp("");
      toast.success(t("pin.otpSent"));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("profile.updateFailed");
      setFormError(message);
      toast.error(message);
    } finally {
      setSendingOtp(false);
    }
  };

  return (
    <UserShell title={title} back="/app/profile">
      <div className="mx-auto w-full max-w-lg space-y-4 px-4 pb-8 pt-2">
        <div className="rounded-2xl border border-brand/15 bg-brand-soft/50 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
              {mode === "set" ? <KeyRound className="size-5" /> : <LockKeyhole className="size-5" />}
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-brand-dark">{title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{intro}</p>
            </div>
          </div>
        </div>

        <form
          className="space-y-4 rounded-2xl border border-border/60 bg-white p-4 shadow-[0_8px_28px_-18px_rgba(2,8,23,0.28)] min-w-0 max-w-full"
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
              if (mode === "reset") {
                await apiClient.resetTransactionPin({
                  ...(resetMethod === "password"
                    ? { current_password: accountPassword }
                    : { otp: otp.trim() }),
                  transaction_pin: pin,
                  confirm_pin: confirmPin,
                });
                await refreshProfile();
                toast.success(t("pin.resetSuccess"));
              } else if (mode === "change") {
                await apiClient.changeTransactionPin({
                  current_pin: currentPin,
                  transaction_pin: pin,
                  confirm_pin: confirmPin,
                });
                await refreshProfile();
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
          {mode === "change" ? (
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
              <button
                type="button"
                className="text-[13px] font-medium text-brand hover:underline"
                onClick={enterResetMode}
              >
                {t("pin.forgotLink")}
              </button>
            </div>
          ) : null}

          {mode === "reset" ? (
            <div className="space-y-3">
              {otpAvailable ? (
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-1">
                  <button
                    type="button"
                    className={cn(
                      "h-9 rounded-lg text-[13px] font-medium transition-colors",
                      resetMethod === "password"
                        ? "bg-white text-brand-dark shadow-sm"
                        : "text-muted-foreground",
                    )}
                    onClick={() => {
                      setResetMethod("password");
                      setFormError(null);
                    }}
                  >
                    {t("pin.verifyWithPassword")}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "h-9 rounded-lg text-[13px] font-medium transition-colors",
                      resetMethod === "otp"
                        ? "bg-white text-brand-dark shadow-sm"
                        : "text-muted-foreground",
                    )}
                    onClick={() => {
                      setResetMethod("otp");
                      setFormError(null);
                    }}
                  >
                    {t("pin.verifyWithOtp")}
                  </button>
                </div>
              ) : null}

              {resetMethod === "password" || !otpAvailable ? (
                <div className="space-y-1.5">
                  <Label htmlFor="account_password">{t("pin.passwordLabel")}</Label>
                  <PasswordInput
                    id="account_password"
                    value={accountPassword}
                    onChange={(e) => {
                      setAccountPassword(e.target.value);
                      setFormError(null);
                    }}
                    autoComplete="current-password"
                    required
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full rounded-xl"
                    disabled={sendingOtp}
                    onClick={sendResetOtp}
                  >
                    {sendingOtp ? t("pin.sendingOtp") : t("pin.sendOtp")}
                  </Button>
                  {otpSent && emailHint ? (
                    <p className="text-[12px] text-muted-foreground">
                      {t("pin.otpHint", { email: emailHint })}
                    </p>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="pin_reset_otp">{t("pin.otpLabel")}</Label>
                    <Input
                      id="pin_reset_otp"
                      inputMode="numeric"
                      autoComplete="off"
                      value={otp}
                      onChange={(e) => {
                        setOtp(digitsOnly(e.target.value, 6));
                        setFormError(null);
                      }}
                      required
                      minLength={4}
                      maxLength={6}
                      placeholder="••••••"
                      className="h-11 rounded-xl tracking-[0.2em]"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="transaction_pin">
              {mode === "set" ? t("pin.label") : t("pin.newLabel")}
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
              {mode === "set" ? t("pin.confirmLabel") : t("pin.confirmNewLabel")}
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

          {mode === "reset" ? (
            <button
              type="button"
              className="w-full text-center text-[13px] font-medium text-muted-foreground hover:text-brand hover:underline"
              onClick={exitResetMode}
            >
              {t("pin.backToChange")}
            </button>
          ) : null}
        </form>
      </div>
    </UserShell>
  );
}
