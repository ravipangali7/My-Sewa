import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import {
  PHONE_CHANGE_OTP_SECONDS,
  useOtpCountdown,
} from "@/hooks/use-otp-countdown";

export const Route = createFileRoute("/app/profile_/phone")({
  head: () => ({
    meta: [
      { title: "Change Phone — MySewa" },
      {
        name: "description",
        content: "Update the phone number linked to your MySewa account with email OTP verification.",
      },
      { property: "og:title", content: "Change Phone — MySewa" },
    ],
  }),
  component: ChangePhonePage,
});

function ChangePhonePage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [newPhone, setNewPhone] = useState("");
  const [phonePassword, setPhonePassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [emailHint, setEmailHint] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const { expired: otpExpired, formatted: otpCountdown } = useOtpCountdown(
    otpSent ? otpExpiresAt : null,
  );

  const requestOtp = async () => {
    setSendingOtp(true);
    try {
      const res = await apiClient.requestChangePhoneOtp({
        new_phone: newPhone.trim(),
        current_password: phonePassword,
      });
      const expiresIn = res.expires_in ?? PHONE_CHANGE_OTP_SECONDS;
      setOtpSent(true);
      setEmailHint(res.email_hint || "");
      setOtp("");
      setOtpExpiresAt(Date.now() + expiresIn * 1000);
      toast.success(res.message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("profile.updateFailed"));
    } finally {
      setSendingOtp(false);
    }
  };

  return (
    <UserShell title={t("profile.changePhone")} back="/app/profile">
      <form
        className="inset-group min-w-0 max-w-full space-y-4 overflow-x-clip p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!otpSent) {
            await requestOtp();
            return;
          }
          if (otpExpired) {
            toast.error(t("profile.otpExpired"));
            return;
          }
          setSaving(true);
          try {
            await apiClient.changePhone({
              new_phone: newPhone.trim(),
              current_password: phonePassword,
              otp: otp.trim(),
            });
            await refreshProfile();
            toast.success(t("profile.phoneUpdated"));
            navigate({ to: "/app/profile" });
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t("profile.updateFailed"));
          } finally {
            setSaving(false);
          }
        }}
      >
        {user?.phone ? (
          <div className="rounded-xl bg-muted/70 px-3.5 py-3">
            <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("profile.currentPhone")}
            </p>
            <p className="mt-0.5 text-[15px] font-medium">{user.phone}</p>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="new_phone">{t("profile.newPhone")}</Label>
          <Input
            id="new_phone"
            value={newPhone}
            onChange={(e) => {
              setNewPhone(e.target.value);
              setOtpSent(false);
              setOtp("");
              setOtpExpiresAt(null);
            }}
            inputMode="tel"
            autoComplete="tel"
            required
            disabled={otpSent}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone_password">{t("profile.currentPassword")}</Label>
          <PasswordInput
            id="phone_password"
            value={phonePassword}
            onChange={(e) => setPhonePassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={otpSent}
          />
        </div>

        {otpSent ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="phone_otp">{t("profile.otpCode")}</Label>
              <span
                className={
                  otpExpired
                    ? "text-[12px] font-semibold text-destructive"
                    : "text-[12px] font-medium tabular-nums text-muted-foreground"
                }
                aria-live="polite"
              >
                {otpExpired
                  ? t("profile.otpExpired")
                  : t("profile.otpExpiresIn", { time: otpCountdown })}
              </span>
            </div>
            <Input
              id="phone_otp"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="000000"
              maxLength={6}
              required
              disabled={otpExpired}
            />
            <p className="text-[12px] text-muted-foreground">
              {emailHint
                ? t("profile.otpSentTo", { email: emailHint })
                : t("profile.otpSentGeneric")}
            </p>
            <button
              type="button"
              className="text-[13px] font-semibold text-brand"
              onClick={() => void requestOtp()}
              disabled={sendingOtp}
            >
              {sendingOtp ? t("profile.sendingOtp") : t("profile.resendOtp")}
            </button>
          </div>
        ) : null}

        <Button
          type="submit"
          className="w-full"
          disabled={saving || sendingOtp || (otpSent && otpExpired)}
        >
          {otpSent
            ? saving
              ? t("common.updating")
              : t("profile.updatePhone")
            : sendingOtp
              ? t("profile.sendingOtp")
              : t("profile.sendOtp")}
        </Button>
      </form>
    </UserShell>
  );
}
