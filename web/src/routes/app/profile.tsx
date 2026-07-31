import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { useAuth } from "@/lib/auth";
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
  const { user, wallet, logout } = useAuth();

  if (!user) {
    return (
      <UserShell title="Profile">
        <p className="text-sm text-muted-foreground">Loading profile…</p>
      </UserShell>
    );
  }

  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || "MySewa user";
  const initials =
    `${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`.toUpperCase() ||
    user.phone.slice(0, 2);

  return (
    <UserShell title="Profile">
      <div className="space-y-5">
        <section className="inset-group overflow-hidden">
          <div className="h-16 bg-hero-gradient sm:h-18" aria-hidden />
          <div className="relative px-4 pb-5 pt-0">
            <div className="-mt-10 flex items-end gap-4">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="size-22 shrink-0 rounded-2xl object-cover shadow-card ring-4 ring-surface"
                />
              ) : (
                <div className="flex size-22 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-[28px] font-semibold text-brand-dark shadow-card ring-4 ring-surface">
                  {initials}
                </div>
              )}
              <div className="min-w-0 flex-1 pb-1">
                <p className="truncate text-[20px] font-semibold leading-tight tracking-tight">
                  {displayName}
                </p>
                <p className="mt-1 truncate text-[15px] text-muted-foreground">{user.phone}</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-muted/70 px-3.5 py-3">
              <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                Email
              </p>
              <p className="mt-0.5 truncate text-[15px] font-medium">
                {user.email || "No email on file"}
              </p>
            </div>
          </div>
        </section>

        <section className="inset-group divide-y divide-border">
          <Field label="Wallet balance" value={wallet ? formatNPR(wallet.balance) : "—"} />
          <Field label="Account status" value={user.is_active ? "Active" : "Inactive"} />
          <Field label="Date joined" value={formatDate(user.date_joined)} />
          <Field label="Last login" value={user.last_login ? formatDate(user.last_login) : "—"} />
        </section>

        <section className="inset-group divide-y divide-border">
          <ActionRow label="Edit profile" to="/app/profile/edit" />
          <ActionRow label="Change phone" to="/app/profile/phone" />
          <ActionRow label="Change password" to="/app/profile/password" />
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

function ActionRow({ label, to }: { label: string; to: "/app/profile/edit" | "/app/profile/phone" | "/app/profile/password" }) {
  return (
    <Link
      to={to}
      className="flex w-full items-center px-4 py-3.5 text-left text-[17px] hover:bg-muted/60"
    >
      {label}
      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
    </Link>
  );
}
