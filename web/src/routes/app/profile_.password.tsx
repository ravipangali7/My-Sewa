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

  return (
    <UserShell title={t("profile.changePassword")} back="/app/profile">
      <form
        className="inset-group space-y-4 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
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
            toast.error(err instanceof ApiError ? err.message : t("profile.updateFailed"));
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
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new_password">{t("profile.newPassword")}</Label>
          <PasswordInput
            id="new_password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm_password">{t("profile.confirmPassword")}</Label>
          <PasswordInput
            id="confirm_password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? t("common.updating") : t("profile.updatePassword")}
        </Button>
      </form>
    </UserShell>
  );
}
