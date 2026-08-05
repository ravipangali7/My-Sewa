import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DateOfBirthDisplay, DateOfBirthField } from "@/components/DateOfBirthField";
import { IdentityLockedBanner } from "@/components/IdentityLockedBanner";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { isIdentityLocked } from "@/lib/kyc-lock";
import { useT } from "@/lib/i18n";
import { toAdIsoDate } from "@/lib/nepali-date";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/profile_/edit")({
  head: () => ({
    meta: [
      { title: "Edit Profile — MySewa" },
      {
        name: "description",
        content: "Update your MySewa name, email, and date of birth.",
      },
      { property: "og:title", content: "Edit Profile — MySewa" },
    ],
  }),
  component: EditProfilePage,
});

function EditProfilePage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.first_name || "");
    setLastName(user.last_name || "");
    setEmail(user.email || "");
    setDateOfBirth(toAdIsoDate(user.date_of_birth));
  }, [user]);

  if (!user) {
    return (
      <UserShell title={t("profile.editProfile")} back="/app/profile">
        <p className="text-sm text-muted-foreground">{t("profile.loading")}</p>
      </UserShell>
    );
  }

  const identityLocked = isIdentityLocked(user);
  const dobMissing = !user.date_of_birth;
  const citizenship = (user.citizenship_number || "").trim();

  return (
    <UserShell title={t("profile.editProfile")} back="/app/profile">
      <form
        className="inset-group space-y-4 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!identityLocked && !dateOfBirth) {
            toast.error(t("profile.dateOfBirthRequired"));
            return;
          }
          setSaving(true);
          try {
            const fd = new FormData();
            // Email (and avatar elsewhere) remain editable after KYC.
            fd.append("email", email);
            if (!identityLocked) {
              fd.append("first_name", firstName);
              fd.append("last_name", lastName);
              fd.append("date_of_birth", dateOfBirth);
            }
            await apiClient.updateProfile(fd);
            await refreshProfile();
            toast.success(t("profile.updated"));
            navigate({ to: "/app/profile" });
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t("profile.updateFailed"));
          } finally {
            setSaving(false);
          }
        }}
      >
        {identityLocked ? <IdentityLockedBanner /> : null}

        <div className="space-y-1.5">
          <Label htmlFor="first_name">{t("profile.firstName")}</Label>
          <Input
            id="first_name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            readOnly={identityLocked}
            disabled={identityLocked}
            className={cn(identityLocked && "bg-muted/50")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last_name">{t("profile.lastName")}</Label>
          <Input
            id="last_name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            readOnly={identityLocked}
            disabled={identityLocked}
            className={cn(identityLocked && "bg-muted/50")}
          />
        </div>

        {identityLocked || citizenship ? (
          <div className="space-y-1.5">
            <Label htmlFor="citizenship_number">{t("profile.citizenshipNumber")}</Label>
            <Input
              id="citizenship_number"
              value={citizenship || t("profile.citizenshipEmpty")}
              readOnly
              disabled
              className="bg-muted/50"
            />
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="email">{t("profile.email")}</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>

        {identityLocked ? (
          <div className="space-y-1.5">
            <Label>{t("profile.dateOfBirth")}</Label>
            <div className="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-foreground">
              <DateOfBirthDisplay value={user.date_of_birth} />
            </div>
          </div>
        ) : (
          <DateOfBirthField
            value={dateOfBirth}
            onChange={setDateOfBirth}
            required
            {...(dobMissing ? { hint: t("profile.dateOfBirthRequired") } : {})}
          />
        )}

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? t("common.saving") : t("profile.saveChanges")}
        </Button>
      </form>
    </UserShell>
  );
}
