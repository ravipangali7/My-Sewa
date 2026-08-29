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

export const Route = createFileRoute("/app/profile_/email")({
  head: () => ({
    meta: [
      { title: "Change Email — MySewa" },
      {
        name: "description",
        content: "Update your MySewa email with OTP verification sent to your registered address.",
      },
      { property: "og:title", content: "Change Email — MySewa" },
    ],
  }),
  component: ChangeEmailPage,
});

function ChangeEmailPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [emailHint, setEmailHint] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [saving, setSaving] = useState(false);

  const requestOtp = async () => {
    setSendingOtp(true);
    try {
      const res = await apiClient.requestEmailChange({
        new_email: newEmail.trim(),
        current_password: password,
      });
      setOtpSent(true);
      setEmailHint(res.email_hint || "");
      setOtp("");
      toast.success(res.message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("profile.updateFailed"));
    } finally {
      setSendingOtp(false);
    }
  };

  return (
    <UserShell title={t("profile.changeEmail")} back="/app/profile">
      <form
        className="inset-group min-w-0 max-w-full space-y-4 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!otpSent) {
            await requestOtp();
            return;
          }
          setSaving(true);
          try {
            await apiClient.confirmEmailChange({ otp: otp.trim() });
            await refreshProfile();
            toast.success(t("profile.emailUpdated"));
            navigate({ to: "/app/profile" });
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t("profile.updateFailed"));
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="rounded-xl bg-muted/70 px-3.5 py-3">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("profile.currentEmail")}
          </p>
          <p className="mt-0.5 break-all text-[15px] font-medium">
            {(user?.email || "").trim() || t("profile.emailEmpty")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new_email">{t("profile.newEmail")}</Label>
          <Input
            id="new_email"
            type="email"
            value={newEmail}
            onChange={(e) => {
              setNewEmail(e.target.value);
              setOtpSent(false);
              setOtp("");
            }}
            autoComplete="email"
            required
            disabled={otpSent}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email_password">{t("profile.currentPassword")}</Label>
          <PasswordInput
            id="email_password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={otpSent}
          />
        </div>

        {otpSent ? (
          <div className="space-y-1.5">
            <Label htmlFor="email_otp">{t("profile.otpCode")}</Label>
            <Input
              id="email_otp"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="000000"
              maxLength={6}
              required
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

        <Button type="submit" className="w-full" disabled={saving || sendingOtp}>
          {otpSent
            ? saving
              ? t("common.updating")
              : t("profile.confirmEmailChange")
            : sendingOtp
              ? t("profile.sendingOtp")
              : t("profile.sendOtp")}
        </Button>
      </form>
    </UserShell>
  );
}
