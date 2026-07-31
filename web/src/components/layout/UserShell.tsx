import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, ArrowLeftRight, History, User, Bell, ChevronLeft } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const TABS = [
  { to: "/app", label: "Home", icon: Home },
  { to: "/app/services", label: "Services", icon: ArrowLeftRight },
  { to: "/app/history", label: "History", icon: History },
  { to: "/app/profile", label: "Profile", icon: User },
];

export function UserShell({
  title,
  children,
  back,
  hideHeader = false,
}: {
  title: string;
  children: ReactNode;
  back?: string;
  hideHeader?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { user, isLoading, token, logout } = useAuth();

  useEffect(() => {
    if (!token) navigate({ to: "/" });
  }, [token, navigate]);

  if (!token || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Session expired. <Link to="/" className="ml-1 text-brand">Sign in</Link>
      </div>
    );
  }

  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || user.phone;

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
        <Link to="/app" className="mb-8 flex items-center gap-2.5 px-2">
          <img src="/logo.png" alt="MySewa" className="size-9 rounded-xl" />
          <div>
            <p className="text-[17px] leading-tight font-semibold">MySewa</p>
            <p className="text-xs text-muted-foreground">Wallet portal</p>
          </div>
        </Link>
        <nav className="flex flex-col gap-1">
          {TABS.map((t) => {
            const active = pathname === t.to;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand-dark"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <t.icon className="size-[18px]" />
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-xl bg-muted p-3">
          <p className="text-sm font-medium">{displayName}</p>
          <p className="text-xs text-muted-foreground">{user.phone}</p>
          <button
            type="button"
            className="mt-2 inline-block text-xs font-medium text-danger"
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
        {!hideHeader && (
          <header className="sticky top-0 z-30 bg-hero-gradient px-4 pt-[max(14px,env(safe-area-inset-top))] pb-5 lg:static lg:bg-none lg:bg-surface lg:px-8 lg:py-5 lg:shadow-none">
            <div className="flex items-center gap-3">
              {back && (
                <Link to={back} className="-ml-1 text-primary-foreground lg:text-foreground">
                  <ChevronLeft className="size-6" />
                </Link>
              )}
              <h1 className="text-[28px] font-bold tracking-tight text-primary-foreground lg:text-[22px] lg:text-foreground">
                {title}
              </h1>
              <button
                type="button"
                aria-label="Notifications"
                className="relative ml-auto text-primary-foreground lg:text-muted-foreground"
              >
                <Bell className="size-[22px]" />
              </button>
            </div>
          </header>
        )}

        <main className="flex-1 px-4 pb-28 lg:px-8 lg:pb-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[max(8px,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <ul className="grid grid-cols-4">
            {TABS.map((t) => {
              const active = pathname === t.to;
              return (
                <li key={t.to}>
                  <Link
                    to={t.to}
                    className={cn(
                      "flex min-h-[52px] flex-col items-center justify-center gap-1 text-[11px] font-medium",
                      active ? "text-brand" : "text-muted-foreground",
                    )}
                  >
                    <t.icon className="size-[22px]" />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
