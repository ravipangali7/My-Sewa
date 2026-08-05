import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
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
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PIN_MIN = 4;
const PIN_MAX = 6;

type TransactionPinDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When false, show a prompt to set PIN instead of the OTP entry. */
  hasPin: boolean;
  onConfirm: (pin: string) => void;
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
  confirming = false,
  title,
  description,
  error = null,
  setPinHref = "/app/profile/pin",
}: TransactionPinDialogProps) {
  const t = useT();
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (open) {
      setPin("");
    }
  }, [open]);

  const canSubmit = hasPin && pin.length >= PIN_MIN && !confirming;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <InputOTP
              maxLength={PIN_MAX}
              value={pin}
              onChange={setPin}
              disabled={confirming}
              autoFocus
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
                {Array.from({ length: PIN_MAX }).map((_, index) => (
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
            disabled={confirming}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
