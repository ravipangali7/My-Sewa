import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";

export const Route = createFileRoute("/app/profile_/edit")({
  head: () => ({
    meta: [
      { title: "Edit Profile — MySewa" },
      {
        name: "description",
        content: "Update your MySewa name and email details.",
      },
      { property: "og:title", content: "Edit Profile — MySewa" },
    ],
  }),
  component: EditProfilePage,
});

function EditProfilePage() {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.first_name || "");
    setLastName(user.last_name || "");
    setEmail(user.email || "");
  }, [user]);

  if (!user) {
    return (
      <UserShell title="Edit profile" back="/app/profile">
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </UserShell>
    );
  }

  return (
    <UserShell title="Edit profile" back="/app/profile">
      <form
        className="inset-group space-y-4 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            const fd = new FormData();
            fd.append("first_name", firstName);
            fd.append("last_name", lastName);
            fd.append("email", email);
            await apiClient.updateProfile(fd);
            await refreshProfile();
            toast.success("Profile updated");
            navigate({ to: "/app/profile" });
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Update failed");
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="first_name">First name</Label>
          <Input
            id="first_name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last_name">Last name</Label>
          <Input
            id="last_name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </UserShell>
  );
}
