import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, ArrowLeftRight, History, User, ArrowLeft } from "lucide-react";
import { useCallback, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { apiClient } from "@/lib/api";
import { refreshAppData } from "@/lib/refresh";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { PullToRefresh } from "@/components/PullToRefresh";

const TABS = [
  { to: "/app", label: "Home", icon: Home, match: (p: string) => p === "/app" || p === "/app/" },
  {
    to: "/app/transfer",
    label: "Fund Transfer",
    icon: ArrowLeftRight,
    match: (p: string) => p.startsWith("/app/transfer"),
  },
  {
    to: "/app/history",
    label: "History",
    icon: History,
    match: (p: string) => p.startsWith("/app/history"),
  },
  {
    to: "/app/profile",
    label: "Profile",
    icon: User,
    match: (p: string) => p.startsWith("/app/profile"),
  },
] as const;

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
  const queryClient = useQueryClient();
  const { user, isLoading, token, logout } = useAuth();
  const { logoUrl } = useSiteBranding();

  const handlePullRefresh = useCallback(
    () => refreshAppData(queryClient),
    [queryClient],
  );

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
    staleTime: 60_000,
  });
  const maintenance = settingsQuery.data?.config?.security?.maintenance_mode;
  const maintenanceMessage =
    settingsQuery.data?.config?.security?.maintenance_message ||
    "MySewa is under maintenance. Some features may be unavailable.";

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
        Session expired.{" "}
        <Link to="/" className="ml-1 text-brand">
          Sign in
        </Link>
      </div>
    );
  }

  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || user.phone;

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
        <Link to="/app" className="mb-8 flex items-center gap-2.5 px-2">
          <img src={logoUrl} alt="MySewa" className="size-9 rounded-full object-cover" />
          <div>
            <p className="text-[17px] leading-tight font-semibold">
              <span className="text-ocean">My</span>
              <span className="text-brand">Sewa</span>
            </p>
            <p className="text-xs text-muted-foreground">Wallet portal</p>
          </div>
        </Link>
        <nav className="flex flex-col gap-1">
          {TABS.map((t) => {
            const active = t.match(pathname);
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
          <header className="sticky top-0 z-30 bg-hero-gradient px-4 pt-[max(14px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-5 lg:static lg:bg-none lg:bg-surface lg:px-8 lg:py-5 lg:shadow-none">
            <div className="flex items-center gap-3">
              {back && (
                <Link
                  to={back}
                  aria-label="Go back"
                  className={cn(
                    "group -ml-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-primary-foreground shadow-sm backdrop-blur transition-all duration-200",
                    "hover:bg-white/25 hover:shadow-md",
                    "lg:border-border lg:bg-surface lg:text-foreground lg:hover:border-brand/35 lg:hover:bg-brand-soft lg:hover:text-brand-dark",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  )}
                >
                  <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
                </Link>
              )}
              <h1 className="text-[28px] font-bold tracking-tight text-primary-foreground lg:text-[22px] lg:text-foreground">
                {title}
              </h1>
            </div>
          </header>
        )}

        <main
          className={cn(
            "flex-1 lg:px-8 lg:pb-10",
            hideHeader ? "px-0 pb-28" : "px-4 pb-28",
          )}
        >
          <PullToRefresh onRefresh={handlePullRefresh}>
            <div className={cn("mx-auto w-full", hideHeader ? "max-w-lg lg:max-w-6xl" : "max-w-6xl")}>
              {maintenance ? (
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[14px] text-amber-900 dark:text-amber-100">
                  <p className="font-medium">Maintenance mode</p>
                  <p className="mt-0.5 text-[13px] opacity-90">{maintenanceMessage}</p>
                </div>
              ) : null}
              {children}
            </div>
          </PullToRefresh>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-surface pb-[max(10px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] lg:hidden">
          <ul className="grid grid-cols-4">
            {TABS.map((t) => {
              const active = t.match(pathname);
              return (
                <li key={t.to}>
                  <Link
                    to={t.to}
                    className={cn(
                      "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 pt-1.5 text-[10px] font-medium no-underline outline-none",
                      "active:bg-transparent focus-visible:bg-transparent",
                      active ? "text-brand" : "text-[#8A94A6]",
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute inset-x-6 top-0 h-[2.5px] rounded-b-full bg-brand"
                      />
                    ) : null}
                    <t.icon className={cn("size-[22px]", active && "stroke-[2.25px]")} />
                    <span className="leading-none">{t.label}</span>
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
