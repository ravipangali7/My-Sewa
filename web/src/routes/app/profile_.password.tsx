import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/app/profile_/password")({
  head: () => ({
    meta: [
      { title: "Change Password — MySewa" },
      {
        name: "description",
        content: "Update your MySewa account password.",
      },
      { property: "og:title", content: "Change Password — MySewa" },
    ],
  }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const { setSessionToken } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const validate = () => {
    if (newPassword.length < 8) {
      return t("profile.passwordTooShort");
    }
    if (newPassword !== confirmPassword) {
      return t("profile.passwordMismatch");
    }
    if (currentPassword && newPassword === currentPassword) {
      return t("profile.passwordSameAsCurrent");
    }
    return null;
  };

  return (
    <UserShell title={t("profile.changePassword")} back="/app/profile">
      <div className="mx-auto w-full max-w-lg space-y-4 px-4 pb-8 pt-2">
        <div className="rounded-2xl border border-brand/15 bg-brand-soft/50 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
              <Lock className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-brand-dark">
                {t("profile.changePassword")}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {t("profile.passwordIntro")}
              </p>
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
              const res = await apiClient.changePassword({
                current_password: currentPassword,
                new_password: newPassword,
                confirm_password: confirmPassword,
              });
              setSessionToken(res.token);
              toast.success(t("profile.passwordChanged"));
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
          <div className="space-y-1.5">
            <Label htmlFor="current_password">{t("profile.currentPassword")}</Label>
            <PasswordInput
              id="current_password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setFormError(null);
              }}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new_password">{t("profile.newPassword")}</Label>
            <PasswordInput
              id="new_password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setFormError(null);
              }}
              autoComplete="new-password"
              required
              minLength={8}
            />
            <p className="text-[12px] text-muted-foreground">{t("profile.passwordTooShort")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm_password">{t("profile.confirmPassword")}</Label>
            <PasswordInput
              id="confirm_password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setFormError(null);
              }}
              autoComplete="new-password"
              required
              minLength={8}
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
            {saving ? t("common.updating") : t("profile.updatePassword")}
          </Button>
        </form>
      </div>
    </UserShell>
  );
}
