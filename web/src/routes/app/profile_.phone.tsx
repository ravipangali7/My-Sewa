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

export const Route = createFileRoute("/app/profile_/phone")({
  head: () => ({
    meta: [
      { title: "Change Phone — MySewa" },
      {
        name: "description",
        content: "Update the phone number linked to your MySewa account.",
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
  const [saving, setSaving] = useState(false);

  return (
    <UserShell title={t("profile.changePhone")} back="/app/profile">
      <form
        className="inset-group space-y-4 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await apiClient.changePhone({
              new_phone: newPhone.trim(),
              current_password: phonePassword,
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
            onChange={(e) => setNewPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            required
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
          />
        </div>
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? t("common.updating") : t("profile.updatePhone")}
        </Button>
      </form>
    </UserShell>
  );
}
