import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, ArrowLeftRight, ArrowDownToLine, History, User, ArrowLeft } from "lucide-react";
import { useCallback, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { apiClient } from "@/lib/api";
import { refreshAppData } from "@/lib/refresh";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useT, type MessageKey } from "@/lib/i18n";

const TABS = [
  {
    to: "/app",
    labelKey: "nav.home" as const satisfies MessageKey,
    icon: Home,
    match: (p: string) => p === "/app" || p === "/app/",
  },
  {
    to: "/app/transfer",
    labelKey: "nav.transfer" as const satisfies MessageKey,
    icon: ArrowLeftRight,
    match: (p: string) => p.startsWith("/app/transfer"),
  },
  {
    to: "/app/remittance",
    labelKey: "nav.remittance" as const satisfies MessageKey,
    icon: ArrowDownToLine,
    match: (p: string) => p.startsWith("/app/remittance"),
  },
  {
    to: "/app/history",
    labelKey: "nav.history" as const satisfies MessageKey,
    icon: History,
    match: (p: string) => p.startsWith("/app/history"),
  },
  {
    to: "/app/profile",
    labelKey: "nav.profile" as const satisfies MessageKey,
    icon: User,
    match: (p: string) => p.startsWith("/app/profile"),
  },
] as const;

export function UserShell({
  title,
  children,
  back,
  onBack,
  headerLeading,
  headerTrailing,
  hideHeader = false,
}: {
  title: string;
  children: ReactNode;
  back?: string;
  onBack?: () => void;
  headerLeading?: ReactNode;
  headerTrailing?: ReactNode;
  hideHeader?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isLoading, token, logout } = useAuth();
  const { logoUrl } = useSiteBranding();
  const t = useT();

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
    t("maintenance.fallback");

  useEffect(() => {
    if (!token) navigate({ to: "/" });
  }, [token, navigate]);

  if (!token || isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        {t("common.sessionExpired")}{" "}
        <Link to="/" className="ml-1 text-brand">
          {t("common.signIn")}
        </Link>
      </div>
    );
  }

  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || user.phone;

  return (
    // Mobile: document scroll only. Do NOT use overflow-x-hidden here —
    // CSS pairs it to overflow-y:auto, and Android WebView then traps
    // touch on a non-scrolling shell (every page feels frozen).
    // Desktop: fixed viewport shell with <main> as the scroller.
    <div className="min-h-dvh w-full max-w-full overflow-x-clip overscroll-y-none bg-background lg:flex lg:h-dvh lg:max-h-dvh lg:flex-row lg:overflow-hidden">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
        <Link to="/app" className="mb-8 flex items-center gap-2.5 px-2">
          <img src={logoUrl} alt="MySewa" className="size-9 rounded-full object-cover" />
          <div>
            <p className="text-[17px] leading-tight font-semibold">
              <span className="text-ocean">My</span>
              <span className="text-brand">Sewa</span>
            </p>
            <p className="text-xs text-muted-foreground">{t("nav.walletPortal")}</p>
          </div>
        </Link>
        <nav className="flex flex-col gap-1">
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand-dark"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <tab.icon className="size-[18px]" />
                {t(tab.labelKey)}
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
            {t("nav.logOut")}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 w-full max-w-full flex-1 flex-col lg:min-h-0 lg:overflow-hidden">
        {!hideHeader && (
          <header className="sticky top-0 z-30 max-w-full shrink-0 bg-hero-gradient px-3 pt-[max(14px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-5 sm:px-4 lg:static lg:bg-none lg:bg-surface lg:px-8 lg:py-5 lg:shadow-none">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {headerLeading ? <div className="shrink-0">{headerLeading}</div> : null}
              {(back || onBack) && (
                onBack ? (
                  <button
                    type="button"
                    onClick={onBack}
                    aria-label={t("common.goBack")}
                    className={cn(
                      "group -ml-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-primary-foreground shadow-sm backdrop-blur transition-all duration-200",
                      "hover:bg-white/25 hover:shadow-md",
                      "lg:border-border lg:bg-surface lg:text-foreground lg:hover:border-brand/35 lg:hover:bg-brand-soft lg:hover:text-brand-dark",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                    )}
                  >
                    <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
                  </button>
                ) : (
                  <Link
                    to={back!}
                    aria-label={t("common.goBack")}
                    className={cn(
                      "group -ml-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-primary-foreground shadow-sm backdrop-blur transition-all duration-200",
                      "hover:bg-white/25 hover:shadow-md",
                      "lg:border-border lg:bg-surface lg:text-foreground lg:hover:border-brand/35 lg:hover:bg-brand-soft lg:hover:text-brand-dark",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                    )}
                  >
                    <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
                  </Link>
                )
              )}
              <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold tracking-tight text-primary-foreground sm:text-[28px] lg:text-[22px] lg:text-foreground">
                {title}
              </h1>
              {headerTrailing ? (
                <div className="flex max-w-[45%] shrink-0 items-center justify-end gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 sm:max-w-none">
                  {headerTrailing}
                </div>
              ) : null}
            </div>
          </header>
        )}

        <main
          className={cn(
            "min-w-0 max-w-full flex-1 overscroll-y-none lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:px-8 lg:pb-10",
            // pb-safe clears fixed bottom nav + home-indicator; desktop uses lg:pb-10.
            hideHeader ? "px-0 pb-safe lg:pb-10" : "px-3 pb-safe sm:px-4 lg:pb-10",
          )}
        >
          <PullToRefresh onRefresh={handlePullRefresh} className="min-w-0 w-full max-w-full overscroll-y-none">
            <div
              className={cn(
                "mx-auto min-w-0 w-full max-w-full",
                hideHeader ? "max-w-lg lg:max-w-6xl" : "max-w-6xl",
              )}
            >
              {maintenance ? (
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[14px] text-amber-900 dark:text-amber-100">
                  <p className="font-medium">{t("maintenance.title")}</p>
                  <p className="mt-0.5 text-[13px] opacity-90">{maintenanceMessage}</p>
                </div>
              ) : null}
              {children}
            </div>
          </PullToRefresh>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-surface pb-[max(10px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] lg:hidden">
          <ul className="grid grid-cols-5">
            {TABS.map((tab) => {
              const active = tab.match(pathname);
              return (
                <li key={tab.to}>
                  <Link
                    to={tab.to}
                    className={cn(
                      "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-0.5 pt-1.5 text-[10px] font-medium no-underline outline-none",
                      "active:bg-transparent focus-visible:bg-transparent",
                      active ? "text-brand" : "text-[#8A94A6]",
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute inset-x-3 top-0 h-[2.5px] rounded-b-full bg-brand sm:inset-x-4"
                      />
                    ) : null}
                    <tab.icon className={cn("size-[22px] shrink-0", active && "stroke-[2.25px]")} />
                    <span className="max-w-full truncate leading-none">{t(tab.labelKey)}</span>
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
