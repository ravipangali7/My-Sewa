import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Camera, ChevronRight, LogOut } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/layout/AdminShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/admin/profile")({
  head: () => ({
    meta: [
      { title: "Profile — MySewa Admin" },
      {
        name: "description",
        content: "Update your admin profile details, photo, and password.",
      },
      { property: "og:title", content: "Profile — MySewa Admin" },
      { property: "og:description", content: "Manage your Super Admin account." },
    ],
  }),
  component: AdminProfilePage,
});

function AdminProfilePage() {
  const navigate = useNavigate();
  const { user, logout, refreshProfile, setSessionToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  const [newPhone, setNewPhone] = useState("");
  const [phonePassword, setPhonePassword] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  if (!user) {
    return (
      <AdminShell title="Profile">
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </AdminShell>
    );
  }

  const name =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || "Admin";
  const initials =
    `${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`.toUpperCase() ||
    user.phone.slice(0, 2);
  const roleLabel = user.is_superuser ? "Super Admin" : "Admin";

  const handleAvatarChange = async (file: File | null) => {
    if (!file) return;
    setSavingAvatar(true);
    try {
      const fd = new FormData();
      fd.append("avatar", file);
      await apiClient.updateProfile(fd);
      await refreshProfile();
      toast.success("Profile photo updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Photo update failed");
    } finally {
      setSavingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/" });
  };

  return (
    <AdminShell title="Profile" description="Manage your account details and security">
      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="size-16">
                {user.avatar_url ? (
                  <AvatarImage src={user.avatar_url} alt={name} />
                ) : null}
                <AvatarFallback className="bg-brand-soft text-xl font-semibold text-brand-dark">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                aria-label="Change profile photo"
                disabled={savingAvatar}
                className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted disabled:opacity-60"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="size-3.5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleAvatarChange(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{name}</p>
              <p className="text-sm text-muted-foreground">{user.phone}</p>
              <p className="text-sm text-muted-foreground">{user.email || "No email"}</p>
              <p className="mt-1 text-xs font-medium text-brand-dark">{roleLabel}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={savingAvatar}
            onClick={() => fileInputRef.current?.click()}
          >
            {savingAvatar ? "Uploading…" : "Change photo"}
          </Button>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <Field label="Full name" value={name} />
          <Field label="Phone" value={user.phone} />
          <Field label="Email" value={user.email || "—"} />
          <Field label="Role" value={roleLabel} />
          <Field label="Account status" value={user.is_active ? "Active" : "Inactive"} />
          <Field label="Date joined" value={formatDate(user.date_joined)} />
          <Field
            label="Last login"
            value={user.last_login ? formatDate(user.last_login) : "—"}
          />
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <ActionRow
            label="Edit profile"
            description="Name and email"
            onClick={() => {
              setFirstName(user.first_name || "");
              setLastName(user.last_name || "");
              setEmail(user.email || "");
              setEditOpen(true);
            }}
          />
          <ActionRow
            label="Change phone"
            description="Requires current password"
            onClick={() => {
              setNewPhone("");
              setPhonePassword("");
              setPhoneOpen(true);
            }}
          />
          <ActionRow
            label="Change password"
            description="Update your login password"
            onClick={() => {
              setCurrentPassword("");
              setNewPassword("");
              setConfirmPassword("");
              setPassOpen(true);
            }}
          />
        </section>

        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-medium text-danger transition-colors hover:bg-muted"
          onClick={() => setLogoutOpen(true)}
        >
          <LogOut className="size-4" />
          Log out
        </button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const fd = new FormData();
                fd.append("first_name", firstName);
                fd.append("last_name", lastName);
                fd.append("email", email);
                await apiClient.updateProfile(fd);
                await refreshProfile();
                toast.success("Profile updated");
                setEditOpen(false);
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Update failed");
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="first_name">First name</Label>
              <Input
                id="first_name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last_name">Last name</Label>
              <Input
                id="last_name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={phoneOpen} onOpenChange={setPhoneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change phone</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiClient.changePhone({
                  new_phone: newPhone.trim(),
                  current_password: phonePassword,
                });
                await refreshProfile();
                toast.success("Phone updated");
                setPhoneOpen(false);
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Update failed");
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="new_phone">New phone</Label>
              <Input
                id="new_phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone_password">Current password</Label>
              <Input
                id="phone_password"
                type="password"
                value={phonePassword}
                onChange={(e) => setPhonePassword(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit">Update phone</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={passOpen} onOpenChange={setPassOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await apiClient.changePassword({
                  current_password: currentPassword,
                  new_password: newPassword,
                  confirm_password: confirmPassword,
                });
                setSessionToken(res.token);
                toast.success("Password changed");
                setPassOpen(false);
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Update failed");
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="current_password">Current password</Label>
              <Input
                id="current_password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new_password">New password</Label>
              <Input
                id="new_password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm_password">Confirm password</Label>
              <Input
                id="confirm_password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit">Update password</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will be signed out of the admin portal and returned to the login screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={handleLogout}
            >
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  );
}

function ActionRow({
  label,
  description,
  onClick,
}: {
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-border px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-muted/60"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
