import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { UserShell } from "@/components/layout/UserShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { formatNPR, formatDate } from "@/lib/format";

export const Route = createFileRoute("/app/profile")({
  head: () => ({
    meta: [
      { title: "Profile & Security — MySewa" },
      {
        name: "description",
        content:
          "Manage your MySewa account: profile details, phone number, password and wallet information.",
      },
      { property: "og:title", content: "Profile & Security — MySewa" },
      { property: "og:description", content: "Account, security and wallet settings." },
    ],
  }),
  component: Profile,
});

function Profile() {
  const navigate = useNavigate();
  const { user, wallet, logout, refreshProfile, setSessionToken } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);

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
      <UserShell title="Profile">
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </UserShell>
    );
  }

  const initials =
    `${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`.toUpperCase() ||
    user.phone.slice(0, 2);

  return (
    <UserShell title="Profile">
      <div className="space-y-5">
        <section className="inset-group flex items-center gap-4 p-4">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="size-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-[22px] font-semibold text-brand-dark">
              {initials}
            </div>
          )}
          <div>
            <p className="text-[20px] font-semibold">
              {[user.first_name, user.last_name].filter(Boolean).join(" ") || "MySewa user"}
            </p>
            <p className="text-[15px] text-muted-foreground">{user.phone}</p>
            <p className="text-[13px] text-muted-foreground">{user.email || "No email"}</p>
          </div>
        </section>

        <section className="inset-group divide-y divide-border">
          <Field label="Wallet balance" value={wallet ? formatNPR(wallet.balance) : "—"} />
          <Field label="Account status" value={user.is_active ? "Active" : "Inactive"} />
          <Field label="Date joined" value={formatDate(user.date_joined)} />
          <Field label="Last login" value={user.last_login ? formatDate(user.last_login) : "—"} />
        </section>

        <section className="inset-group divide-y divide-border">
          <ActionRow
            label="Edit profile"
            onClick={() => {
              setFirstName(user.first_name || "");
              setLastName(user.last_name || "");
              setEmail(user.email || "");
              setEditOpen(true);
            }}
          />
          <ActionRow
            label="Change phone"
            onClick={() => {
              setNewPhone("");
              setPhonePassword("");
              setPhoneOpen(true);
            }}
          />
          <ActionRow
            label="Change password"
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
          className="inset-group block w-full px-4 py-3.5 text-center text-[17px] font-medium text-danger"
          onClick={async () => {
            await logout();
            navigate({ to: "/" });
          }}
        >
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
              <Label>First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
              <Label>New phone</Label>
              <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <Input
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
              <Label>Current password</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm password</Label>
              <Input
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
    </UserShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[15px] text-muted-foreground">{label}</span>
      <span className="text-[15px] font-medium">{value}</span>
    </div>
  );
}

function ActionRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center px-4 py-3.5 text-left text-[17px] hover:bg-muted/60"
    >
      {label}
      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
    </button>
  );
}
