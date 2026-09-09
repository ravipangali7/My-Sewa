import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { BiometricFingerprintButton } from "@/components/BiometricFingerprintButton";
import { useAuth } from "@/lib/auth";
import {
  biometricErrorMessage,
  getBiometricCapability,
  requestBiometric,
} from "@/lib/biometric";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PIN_LENGTH = 4;

type TransactionPinDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When false, show a prompt to set PIN instead of the OTP entry. */
  hasPin: boolean;
  onConfirm: (pin: string) => void;
  /** Called after native biometric succeeded and a server assertion was minted. */
  onBiometricConfirm?: () => void;
  confirming?: boolean;
  title?: string;
  description?: string;
  error?: string | null;
  setPinHref?: "/app/profile/pin";
};

export function TransactionPinDialog({
  open,
  onOpenChange,
  hasPin,
  onConfirm,
  onBiometricConfirm,
  confirming = false,
  title,
  description,
  error = null,
  setPinHref = "/app/profile/pin",
}: TransactionPinDialogProps) {
  const t = useT();
  const { user } = useAuth();
  const [pin, setPin] = useState("");
  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);

  const biometricEnabled = Boolean(user?.transaction_pin_biometric_enabled && onBiometricConfirm);

  useEffect(() => {
    if (open) {
      setPin("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || !biometricEnabled) {
      setBiometricReady(false);
      return;
    }
    let cancelled = false;
    void getBiometricCapability().then((cap) => {
      if (cancelled) return;
      setBiometricReady(Boolean(cap.biometricAvailable && cap.pinEnrolled));
    });
    return () => {
      cancelled = true;
    };
  }, [open, biometricEnabled]);

  const busy = confirming || biometricBusy;
  const canSubmit = hasPin && pin.length === PIN_LENGTH && !busy;

  const handleBiometric = async () => {
    if (!onBiometricConfirm || busy) return;
    setBiometricBusy(true);
    try {
      const result = await requestBiometric({
        action: "transaction_pin",
        reason: t("biometric.transactionPrompt"),
        ...(user?.id != null ? { userId: user.id } : {}),
      });
      if (result.reason === "cancelled") return;
      if (!result.success || !result.authenticated) {
        const msg = biometricErrorMessage(result, t("biometric.transactionFailed"));
        if (msg) toast.error(msg);
        return;
      }
      onBiometricConfirm();
    } finally {
      setBiometricBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-[min(100%,24rem)] gap-5 sm:rounded-2xl">
        <DialogHeader className="space-y-2 text-center sm:text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#E8F0FE] text-[#1D4ED8]">
            <KeyRound className="size-5" strokeWidth={2} />
          </div>
          <DialogTitle>
            {title ?? (hasPin ? t("pin.enterTitle") : t("pin.setupRequiredTitle"))}
          </DialogTitle>
          <DialogDescription>
            {description ??
              (hasPin ? t("pin.enterBody") : t("pin.setupRequiredBody"))}
          </DialogDescription>
        </DialogHeader>

        {hasPin ? (
          <div className="flex flex-col items-center gap-3">
            {biometricReady ? (
              <>
                <BiometricFingerprintButton
                  label={t("biometric.confirmAria")}
                  loading={biometricBusy}
                  disabled={busy}
                  onClick={() => void handleBiometric()}
                />
                <p className="text-center text-xs font-medium text-[#1A73E8]">
                  {t("biometric.confirmCta")}
                </p>
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("biometric.orUsePin")}
                </p>
              </>
            ) : null}
            <InputOTP
              maxLength={PIN_LENGTH}
              value={pin}
              onChange={(value) => setPin(value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
              disabled={busy}
              autoFocus={!biometricReady}
              inputMode="numeric"
              pattern="[0-9]*"
              containerClassName="justify-center"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  onConfirm(pin);
                }
              }}
            >
              <InputOTPGroup>
                {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className="size-10 text-base font-semibold first:rounded-l-xl last:rounded-r-xl sm:size-11"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {error ? (
              <p className="text-center text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                {t("pin.hint")}
              </p>
            )}
          </div>
        ) : (
          <p
            className={cn(
              "rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3",
              "text-center text-sm text-amber-950",
            )}
          >
            {t("pin.setupPrompt")}
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {hasPin ? (
            <Button
              type="button"
              className="w-full"
              disabled={!canSubmit}
              onClick={() => onConfirm(pin)}
            >
              {confirming ? t("common.processing") : t("pin.confirm")}
            </Button>
          ) : (
            <Button asChild type="button" className="w-full">
              <Link to={setPinHref} onClick={() => onOpenChange(false)}>
                {t("pin.setPinCta")}
              </Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
