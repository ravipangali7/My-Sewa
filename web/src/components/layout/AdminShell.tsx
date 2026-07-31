import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Wallet,
  Inbox,
  Smartphone,
  Banknote,
  Settings as SettingsIcon,
  Menu,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/wallets", label: "Wallets", icon: Wallet },
  { to: "/admin/deposits", label: "Deposits", icon: Inbox },
  { to: "/admin/topups", label: "Top-ups", icon: Smartphone },
  { to: "/admin/transfers", label: "Bank transfers", icon: Banknote },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

export function AdminShell({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user, token, isLoading, isStaff, logout } = useAuth();

  useEffect(() => {
    if (!token) {
      navigate({ to: "/" });
      return;
    }
    if (!isLoading && user && !isStaff) {
      navigate({ to: "/app" });
    }
  }, [token, isLoading, user, isStaff, navigate]);

  if (!token || isLoading || !user || !isStaff) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const roleLabel = user.is_superuser ? "Super Admin" : "Admin";

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-brand-soft text-brand-dark"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="size-[18px]" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <Link to="/admin" className="mb-6 flex items-center gap-2.5 px-2">
          <img src="/logo.png" alt="MySewa" className="size-9 rounded-xl" />
          <div>
            <p className="text-[15px] leading-tight font-semibold">MySewa</p>
            <p className="text-xs text-muted-foreground">{roleLabel}</p>
          </div>
        </Link>
        {nav}
        <div className="mt-auto px-3 py-2">
          <p className="truncate text-xs font-medium">
            {[user.first_name, user.last_name].filter(Boolean).join(" ") || user.phone}
          </p>
          <button
            type="button"
            className="mt-1 text-xs font-medium text-danger"
            onClick={async () => {
              await logout();
              navigate({ to: "/" });
            }}
          >
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur md:px-8 md:py-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Menu"
              className="md:hidden"
              onClick={() => setOpen((v) => !v)}
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight md:text-[28px]">
                {title}
              </h1>
              {description && (
                <p className="truncate text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </div>
          {open && <div className="mt-3 md:hidden">{nav}</div>}
        </header>
        <main className="flex-1 px-4 py-5 md:px-8 md:py-7">{children}</main>
      </div>
    </div>
  );
}
