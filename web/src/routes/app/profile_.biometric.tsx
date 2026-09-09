import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { FingerprintMark } from "@/components/BiometricFingerprintButton";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import {
  biometricErrorMessage,
  getBiometricCapability,
  requestBiometric,
  type BiometricResult,
} from "@/lib/biometric";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/profile_/biometric")({
  head: () => ({
    meta: [
      { title: "Biometric & Security — MySewa" },
      {
        name: "description",
        content: "Enable fingerprint or Face ID for MySewa login and transaction PIN confirmation.",
      },
      { property: "og:title", content: "Biometric & Security — MySewa" },
    ],
  }),
  component: BiometricSecurityPage,
});

type ManageTarget = "login" | "transaction_pin" | null;

function BiometricSecurityPage() {
  const t = useT();
  const { user, refreshProfile } = useAuth();
  const [capability, setCapability] = useState<BiometricResult | null>(null);
  const [target, setTarget] = useState<ManageTarget>(null);
  const [busy, setBusy] = useState(false);

  const refreshCapability = async () => {
    const cap = await getBiometricCapability(4000, { force: true });
    setCapability(cap);
    return cap;
  };

  useEffect(() => {
    void refreshCapability();
  }, []);

  const nativeAvailable = Boolean(capability?.biometricAvailable);
  const loginEnabled = Boolean(user?.login_biometric_enabled);
  const pinEnabled = Boolean(user?.transaction_pin_biometric_enabled);
  const hasPin = Boolean(user?.has_transaction_pin);

  const runAction = async (action: string, successMessage: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await requestBiometric({
        action,
        ...(user?.id != null ? { userId: user.id } : {}),
      });
      if (result.reason === "cancelled") return;
      if (!result.success) {
        const msg = biometricErrorMessage(result, t("common.requestFailed"));
        if (msg) toast.error(msg);
        return;
      }
      await refreshProfile();
      await refreshCapability();
      toast.success(successMessage);
      setTarget(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <UserShell title={t("biometric.title")} back="/app/profile">
      <div className="mx-auto w-full max-w-lg space-y-4 px-4 pb-8 pt-2">
        <div className="rounded-2xl border border-brand/15 bg-brand-soft/50 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-brand-dark">{t("biometric.title")}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {t("biometric.intro")}
              </p>
            </div>
          </div>
        </div>

        {!nativeAvailable ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-950">
            {capability?.reason === "bridge_unavailable"
              ? t("biometric.webOnly")
              : capability?.message || t("biometric.unavailable")}
          </p>
        ) : null}

        <div className="space-y-2.5">
          <SecurityOption
            icon={<Fingerprint className="size-[18px]" strokeWidth={2} />}
            title={t("biometric.loginTitle")}
            description={t("biometric.loginBody")}
            enabled={loginEnabled}
            enabledLabel={t("biometric.enabled")}
            disabledLabel={t("biometric.disabled")}
            onClick={() => setTarget("login")}
          />
          <SecurityOption
            icon={<KeyRound className="size-[18px]" strokeWidth={2} />}
            title={t("biometric.pinTitle")}
            description={t("biometric.pinBody")}
            enabled={pinEnabled}
            enabledLabel={t("biometric.enabled")}
            disabledLabel={t("biometric.disabled")}
            onClick={() => setTarget("transaction_pin")}
          />
        </div>
      </div>

      <Sheet open={target !== null} onOpenChange={(open) => !busy && setTarget(open ? target : null)}>
        <SheetContent side="bottom" className="rounded-t-3xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {target === "login" ? (
            <ManagePanel
              title={t("biometric.loginTitle")}
              description={t("biometric.loginManage")}
              enabled={loginEnabled}
              nativeAvailable={nativeAvailable}
              busy={busy}
              enableLabel={t("biometric.enableLogin")}
              disableLabel={t("biometric.disableLogin")}
              reauthLabel={t("biometric.reauthenticate")}
              onEnable={() => void runAction("enable_login", t("biometric.loginEnabled"))}
              onDisable={() => void runAction("disable_login", t("biometric.loginDisabled"))}
              onReauth={() => void runAction("enable_login", t("biometric.loginEnabled"))}
            />
          ) : target === "transaction_pin" ? (
            <ManagePanel
              title={t("biometric.pinTitle")}
              description={
                hasPin ? t("biometric.pinManage") : t("biometric.pinRequired")
              }
              enabled={pinEnabled}
              nativeAvailable={nativeAvailable && hasPin}
              busy={busy}
              enableLabel={t("biometric.enablePin")}
              disableLabel={t("biometric.disablePin")}
              reauthLabel={t("biometric.reauthenticate")}
              onEnable={() => void runAction("enable_transaction_pin", t("biometric.pinEnabled"))}
              onDisable={() => void runAction("disable_transaction_pin", t("biometric.pinDisabled"))}
              onReauth={() => void runAction("enable_transaction_pin", t("biometric.pinEnabled"))}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </UserShell>
  );
}

function SecurityOption({
  icon,
  title,
  description,
  enabled,
  enabledLabel,
  disabledLabel,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  enabledLabel: string;
  disabledLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl bg-white px-3.5 py-3.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)] active:bg-[#F8FAFC]"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#1D4ED8]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-semibold text-[#0F172A]">{title}</p>
        <p className="mt-0.5 text-[13px] text-[#8A94A6]">{description}</p>
        <p className={cn("mt-1.5 text-[12px] font-semibold", enabled ? "text-[#15803D]" : "text-[#64748B]")}>
          {enabled ? enabledLabel : disabledLabel}
        </p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-[#C0C7D2]" strokeWidth={2} />
    </button>
  );
}

function ManagePanel({
  title,
  description,
  enabled,
  nativeAvailable,
  busy,
  enableLabel,
  disableLabel,
  reauthLabel,
  onEnable,
  onDisable,
  onReauth,
}: {
  title: string;
  description: string;
  enabled: boolean;
  nativeAvailable: boolean;
  busy: boolean;
  enableLabel: string;
  disableLabel: string;
  reauthLabel: string;
  onEnable: () => void;
  onDisable: () => void;
  onReauth: () => void;
}) {
  const t = useT();
  return (
    <>
      <SheetHeader className="text-left">
        <div className="mx-auto mb-1 flex size-14 items-center justify-center rounded-full bg-[#E8F0FE]">
          <FingerprintMark className="size-8" />
        </div>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <p className={cn("mt-3 text-sm font-semibold", enabled ? "text-[#15803D]" : "text-[#64748B]")}>
        {enabled ? t("biometric.enabled") : t("biometric.disabled")}
      </p>
      <div className="mt-5 space-y-2">
        {nativeAvailable ? (
          enabled ? (
            <>
              <Button className="h-11 w-full rounded-xl" disabled={busy} onClick={onReauth}>
                {busy ? t("common.processing") : reauthLabel}
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full rounded-xl"
                disabled={busy}
                onClick={onDisable}
              >
                {disableLabel}
              </Button>
            </>
          ) : (
            <Button className="h-11 w-full rounded-xl" disabled={busy} onClick={onEnable}>
              {busy ? t("common.processing") : enableLabel}
            </Button>
          )
        ) : (
          <p className="text-sm text-muted-foreground">{t("biometric.unavailable")}</p>
        )}
      </div>
    </>
  );
}
