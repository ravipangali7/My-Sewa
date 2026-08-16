import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  House,
  ArrowLeftRight,
  ScanLine,
  HandCoins,
  UserRound,
  ArrowLeft,
} from "lucide-react";
import { useCallback, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { apiClient } from "@/lib/api";
import { refreshAppData, settingsQueryOptions } from "@/lib/refresh";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { AuthSessionLoader } from "@/components/AuthSessionLoader";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useT, type MessageKey } from "@/lib/i18n";

const TABS = [
  {
    to: "/app",
    labelKey: "nav.home" as const satisfies MessageKey,
    icon: House,
    match: (p: string) => p === "/app" || p === "/app/",
    prominent: false,
  },
  {
    to: "/app/transfer",
    labelKey: "nav.transfer" as const satisfies MessageKey,
    icon: ArrowLeftRight,
    match: (p: string) => p.startsWith("/app/transfer"),
    prominent: false,
  },
  {
    to: "/app/scan",
    labelKey: "nav.scan" as const satisfies MessageKey,
    icon: ScanLine,
    match: (p: string) => p.startsWith("/app/scan"),
    prominent: true,
  },
  {
    to: "/app/remittance",
    labelKey: "nav.remittance" as const satisfies MessageKey,
    icon: HandCoins,
    match: (p: string) => p.startsWith("/app/remittance"),
    prominent: false,
  },
  {
    to: "/app/profile",
    labelKey: "nav.profile" as const satisfies MessageKey,
    icon: UserRound,
    match: (p: string) => p.startsWith("/app/profile"),
    prominent: false,
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
  hideNav = false,
  disablePullToRefresh = false,
}: {
  title: string;
  children: ReactNode;
  back?: string;
  onBack?: () => void;
  headerLeading?: ReactNode;
  headerTrailing?: ReactNode;
  hideHeader?: boolean;
  hideNav?: boolean;
  disablePullToRefresh?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isLoading, token, logout } = useAuth();
  const { logoUrl } = useSiteBranding();
  const t = useT();

  const handlePullRefresh = useCallback(
    () => refreshAppData(queryClient, { force: true }),
    [queryClient],
  );

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiClient.settings(),
    ...settingsQueryOptions(),
  });
  const maintenance = settingsQuery.data?.config?.security?.maintenance_mode;
  const maintenanceMessage =
    settingsQuery.data?.config?.security?.maintenance_message ||
    t("maintenance.fallback");

  useEffect(() => {
    if (!token) navigate({ to: "/" });
  }, [token, navigate]);

  if (!token || isLoading) {
    return <AuthSessionLoader />;
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
    (user.nickname || "").trim() ||
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.phone;

  return (
    // Mobile: document scroll sized to content (single min-h-dvh shell for
    // short-page fill). Do NOT use overflow-x-hidden — CSS pairs it to
    // overflow-y:auto and Android WebView traps touch on a non-scroller.
    // Desktop: fixed viewport shell with <main> as the scroller.
    <div className="mysewa-app-shell min-h-dvh w-full max-w-full overflow-x-clip overscroll-y-none bg-background lg:flex lg:h-dvh lg:max-h-dvh lg:flex-row lg:overflow-hidden">
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

      <div className="flex min-w-0 w-full max-w-full flex-col lg:min-h-0 lg:flex-1 lg:overflow-hidden">
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
            // Mobile: height follows content only (no flex-1 growth → no blank
            // overscroll). Desktop: flex-1 + overflow scroller inside fixed shell.
            "min-w-0 max-w-full overscroll-y-none lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain",
            hideHeader && hideNav
              ? "relative h-dvh overflow-hidden p-0 lg:h-auto lg:overflow-hidden lg:px-0 lg:pb-0"
              : hideHeader
                ? "px-0 pb-safe lg:px-8 lg:pb-10"
                : "px-3 pb-safe sm:px-4 lg:px-8 lg:pb-10",
          )}
        >
          <PullToRefresh
            onRefresh={handlePullRefresh}
            disabled={disablePullToRefresh}
            className={cn(
              "min-w-0 w-full max-w-full overscroll-y-none",
              hideHeader && hideNav && "h-full",
            )}
          >
            <div
              className={cn(
                "mx-auto min-w-0 w-full max-w-full",
                hideHeader && hideNav
                  ? "h-full max-w-none"
                  : hideHeader
                    ? "max-w-lg lg:max-w-6xl"
                    : "max-w-6xl",
              )}
            >
              {maintenance && !(hideHeader && hideNav) ? (
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[14px] text-amber-900 dark:text-amber-100">
                  <p className="font-medium">{t("maintenance.title")}</p>
                  <p className="mt-0.5 text-[13px] opacity-90">{maintenanceMessage}</p>
                </div>
              ) : null}
              {children}
            </div>
          </PullToRefresh>
        </main>

        {!hideNav ? (
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
          <div className="border-t border-border/40 bg-surface/92 shadow-[0_-8px_32px_-12px_rgb(16_24_40_/_0.14)] backdrop-blur-xl supports-[backdrop-filter]:bg-surface/80">
            <ul className="mx-auto grid max-w-lg grid-cols-5 items-end px-1.5 pt-1.5 pb-[max(8px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))]">
              {TABS.map((tab) => {
                const active = tab.match(pathname);
                const label = t(tab.labelKey);

                if (tab.prominent) {
                  return (
                    <li key={tab.to} className="relative flex justify-center">
                      <Link
                        to={tab.to}
                        aria-current={active ? "page" : undefined}
                        aria-label={label}
                        className={cn(
                          "group relative -mt-5 flex min-h-[64px] w-full max-w-[4.75rem] flex-col items-center justify-end gap-1 px-0.5 pb-0.5 no-underline outline-none",
                          "focus-visible:outline-none",
                        )}
                      >
                        <span
                          className={cn(
                            "relative flex size-[3.25rem] items-center justify-center rounded-full bg-brand-gradient text-primary-foreground shadow-[0_10px_24px_-6px_rgb(10_122_75_/_0.55),0_2px_6px_rgb(16_24_40_/_0.12)] ring-[3px] ring-surface transition-all duration-200",
                            "group-active:scale-[0.96]",
                            active &&
                              "shadow-[0_12px_28px_-4px_rgb(10_122_75_/_0.65),0_2px_8px_rgb(16_24_40_/_0.14)] ring-brand/20",
                          )}
                        >
                          <tab.icon
                            className="size-[1.35rem] shrink-0"
                            strokeWidth={active ? 2.35 : 2.1}
                            aria-hidden
                          />
                        </span>
                        <span
                          className={cn(
                            "max-w-full truncate text-center text-[10px] font-semibold tracking-[0.01em] leading-none transition-colors duration-200",
                            active ? "text-brand-dark" : "text-muted-foreground",
                          )}
                        >
                          {label}
                        </span>
                      </Link>
                    </li>
                  );
                }

                return (
                  <li key={tab.to} className="flex justify-center">
                    <Link
                      to={tab.to}
                      aria-current={active ? "page" : undefined}
                      aria-label={label}
                      className={cn(
                        "group relative flex min-h-[56px] w-full max-w-[4.75rem] flex-col items-center justify-center gap-1 px-0.5 pt-1 no-underline outline-none transition-colors duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                        "active:scale-[0.97]",
                        active ? "text-brand" : "text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-9 items-center justify-center rounded-2xl transition-all duration-200",
                          active
                            ? "bg-brand-soft text-brand-dark"
                            : "bg-transparent text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground",
                        )}
                      >
                        <tab.icon
                          className="size-[1.25rem] shrink-0"
                          strokeWidth={active ? 2.35 : 1.9}
                          aria-hidden
                        />
                      </span>
                      <span
                        className={cn(
                          "max-w-full truncate text-center text-[10px] leading-none tracking-[0.01em] transition-colors duration-200",
                          active
                            ? "font-semibold text-brand-dark"
                            : "font-medium text-muted-foreground",
                        )}
                      >
                        {label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>
        ) : null}
      </div>
    </div>
  );
}
