import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  History,
  Coins,
  BarChart3,
  Smartphone,
  User,
  LogOut,
  Menu,
  ChevronDown,
  ArrowLeft,
  ArrowDownToLine,
  MessageCircle,
  Landmark,
  Inbox,
  House,
  UserRound,
  ScanLine,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { AuthSessionLoader } from "@/components/AuthSessionLoader";
import { PullToRefresh } from "@/components/PullToRefresh";
import { isNetworkRole, roleLabel } from "@/lib/auth-destination";
import { refreshAppData } from "@/lib/refresh";
import { SupportChatUnreadBadge } from "@/hooks/use-support-chat-unread";
import type { UserProfile } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useT, type MessageKey } from "@/lib/i18n";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard };

type BottomTab = {
  to: string;
  labelKey: MessageKey;
  icon: typeof House;
  match: (pathname: string) => boolean;
  prominent?: boolean;
};

type DealerChromeValue = {
  openMenu: () => void;
  menuOpen: boolean;
};

const DealerChromeContext = createContext<DealerChromeValue | null>(null);

export function useDealerChrome() {
  return useContext(DealerChromeContext);
}

export function DealerMenuButton({ className }: { className?: string }) {
  const chrome = useDealerChrome();
  const t = useT();
  if (!chrome) return null;
  return (
    <button
      type="button"
      aria-label={t("nav.menu")}
      aria-expanded={chrome.menuOpen}
      onClick={chrome.openMenu}
      className={cn(
        "relative mt-1 flex size-10 items-center justify-center rounded-full text-white md:hidden",
        "transition-transform active:scale-95",
        "hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
        className,
      )}
    >
      <Menu className="size-[22px]" strokeWidth={1.75} />
    </button>
  );
}

const SERVICE_PREFIXES = [
  "/app/services",
  "/app/topup",
  "/app/data-topup",
  "/app/internet",
  "/app/water",
  "/app/electricity",
  "/app/community-electricity",
  "/app/load",
  "/app/transfer",
  "/app/remittance",
];

const BOTTOM_TABS: BottomTab[] = [
  {
    to: "/app",
    labelKey: "nav.home",
    icon: House,
    match: (p) => p === "/app" || p === "/app/",
  },
  {
    to: "/dealer/push-balance",
    labelKey: "nav.pushBalance",
    icon: ArrowDownToLine,
    match: (p) => p.startsWith("/dealer/push-balance"),
  },
  {
    to: "/app/scan",
    labelKey: "nav.scan",
    icon: ScanLine,
    match: (p) => p.startsWith("/app/scan"),
    prominent: true,
  },
  {
    to: "/dealer/transactions",
    labelKey: "nav.transactions",
    icon: History,
    match: (p) => p.startsWith("/dealer/transactions"),
  },
  {
    to: "/app/profile",
    labelKey: "nav.profile",
    icon: UserRound,
    match: (p) => p.startsWith("/app/profile"),
  },
];

function navForRole(role: string | undefined): NavItem[] {
  const items: NavItem[] = [
    { to: "/app", label: "Home", icon: House },
    { to: "/app/scan", label: "Scan", icon: ScanLine },
    { to: "/dealer", label: "Dashboard", icon: LayoutDashboard },
    { to: "/dealer/customers", label: "My Customers", icon: Users },
  ];
  if (role === "dealer") {
    items.push({ to: "/dealer/push-balance", label: "Push Balance", icon: ArrowDownToLine });
  }
  items.push(
    { to: "/dealer/payout-accounts", label: "Payout Accounts", icon: Landmark },
    { to: "/dealer/deposits", label: "Wallet Loads", icon: Inbox },
    { to: "/dealer/transactions", label: "Transactions", icon: History },
    { to: "/dealer/commission", label: "Commission", icon: Coins },
    { to: "/dealer/reports", label: "Reports", icon: BarChart3 },
    { to: "/app/support-chat", label: "Support Chat", icon: MessageCircle },
    { to: "/app/services", label: "Services", icon: Smartphone },
    { to: "/app/profile", label: "Profile", icon: User },
  );
  return items;
}

function isNavActive(pathname: string, to: string) {
  if (to === "/dealer") return pathname === "/dealer" || pathname === "/dealer/";
  if (to === "/app") return pathname === "/app" || pathname === "/app/";
  if (to === "/app/services") {
    return SERVICE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  }
  if (to === "/app/profile")
    return pathname === "/app/profile" || pathname.startsWith("/app/profile");
  return pathname === to || pathname.startsWith(`${to}/`);
}

function displayName(user: UserProfile) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.phone;
}

function initials(user: UserProfile) {
  return (
    `${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`.toUpperCase() ||
    user.phone.slice(0, 2)
  );
}

function DealerBottomNav({ pathname }: { pathname: string }) {
  const t = useT();
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 md:hidden">
      <div className="border-t border-border/40 bg-surface/92 shadow-[0_-8px_32px_-12px_rgb(16_24_40_/_0.14)] backdrop-blur-xl supports-[backdrop-filter]:bg-surface/80">
        <ul className="mx-auto grid max-w-lg grid-cols-5 items-end px-1.5 pt-1.5 pb-[max(8px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))]">
          {BOTTOM_TABS.map((tab) => {
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
                      "relative flex size-9 items-center justify-center rounded-2xl transition-all duration-200",
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
                      "max-w-full text-center text-[10px] leading-[1.15] tracking-[0.01em] transition-colors duration-200 line-clamp-2",
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
  );
}

export function PortalShell({
  title,
  description,
  children,
  actions,
  back,
  onBack,
  headerLeading,
  flush = false,
  hideHeader = false,
  disablePullToRefresh = false,
  immersive = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  back?: string;
  onBack?: () => void;
  headerLeading?: ReactNode;
  /** Edge-to-edge page body (wallet / profile heroes) under the portal chrome. */
  flush?: boolean;
  /** Hide the portal title bar (page supplies its own compact chrome). */
  hideHeader?: boolean;
  disablePullToRefresh?: boolean;
  /** Full-screen page that supplies its own chrome (e.g. Push Balance). */
  immersive?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, token, isLoading, isStaff, logout } = useAuth();
  const { logoUrl } = useSiteBranding();
  const t = useT();
  const hideTopChrome = hideHeader || immersive;

  const handlePullRefresh = useCallback(
    () => refreshAppData(queryClient, { force: true }),
    [queryClient],
  );

  useEffect(() => {
    if (!token) {
      navigate({ to: "/" });
      return;
    }
    if (!isLoading && user) {
      if (isStaff) navigate({ to: "/admin" });
      else if (!isNetworkRole(user)) navigate({ to: "/app" });
    }
  }, [token, isLoading, user, isStaff, navigate]);

  const items = useMemo(() => navForRole(user?.role), [user?.role]);
  const chromeValue = useMemo<DealerChromeValue>(
    () => ({ openMenu: () => setDrawerOpen(true), menuOpen: drawerOpen }),
    [drawerOpen],
  );

  if (!token || isLoading || !user || isStaff || !isNetworkRole(user)) {
    return <AuthSessionLoader />;
  }

  const label = roleLabel(user);
  const closeDrawer = () => setDrawerOpen(false);
  const name = displayName(user);
  const showBottomNav = !pathname.startsWith("/app/scan");

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/" });
  };

  const navLinks = (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isNavActive(pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={closeDrawer}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-brand-soft text-brand-dark"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="size-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.to === "/app/support-chat" ? <SupportChatUnreadBadge /> : null}
          </Link>
        );
      })}
    </nav>
  );

  const brandBlock = (
    <Link to="/app" onClick={closeDrawer} className="flex items-center gap-2.5 px-2">
      <img src={logoUrl} alt="MySewa" className="size-9 rounded-xl object-cover" />
      <div>
        <p className="text-[15px] leading-tight font-semibold">MySewa</p>
        <p className="text-xs text-muted-foreground">{label} portal</p>
      </div>
    </Link>
  );

  const avatar = (
    <Avatar className="size-8">
      {user.avatar_url ? <AvatarImage src={user.avatar_url} alt={name} /> : null}
      <AvatarFallback className="bg-brand-soft text-xs font-semibold text-brand-dark">
        {initials(user)}
      </AvatarFallback>
    </Avatar>
  );

  const profileMenu = (align: "start" | "end") => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-3 rounded-lg text-left hover:bg-muted",
            align === "start" ? "w-full px-2 py-2" : "p-1",
          )}
        >
          {avatar}
          {align === "start" ? (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{label}</p>
              </div>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          ) : (
            <span className="sr-only">{name}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={align === "start" ? "top" : "bottom"}
        className="w-56"
      >
        <DropdownMenuLabel>{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/app/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/app">Home</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dealer">Dashboard</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger" onSelect={() => setLogoutOpen(true)}>
          <LogOut className="size-3.5" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const backControl =
    back || onBack ? (
      onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={t("common.goBack")}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
        </button>
      ) : (
        <Link
          to={back!}
          aria-label={t("common.goBack")}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
        </Link>
      )
    ) : null;

  const drawer = (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
      <SheetContent
        side="left"
        className="flex w-[min(100%,20rem)] flex-col gap-0 p-0 pt-[var(--safe-area-top,env(safe-area-inset-top,0px))] pb-[var(--safe-area-bottom,env(safe-area-inset-bottom,0px))]"
      >
        <SheetHeader className="border-b border-border px-4 py-4 text-left">
          <SheetTitle className="sr-only">Dealer menu</SheetTitle>
          <SheetDescription className="sr-only">Dealer portal navigation</SheetDescription>
          {brandBlock}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">{navLinks}</div>
        <div className="border-t border-border px-3 py-3">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium text-danger hover:bg-muted"
            onClick={() => {
              closeDrawer();
              setLogoutOpen(true);
            }}
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );

  const logoutDialog = (
    <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Log out?</AlertDialogTitle>
          <AlertDialogDescription>
            You will be signed out of the {label.toLowerCase()} portal.
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
  );

  if (immersive) {
    return (
      <DealerChromeContext.Provider value={chromeValue}>
        <div className="mysewa-app-shell mysewa-portal-shell min-h-dvh w-full max-w-full overflow-x-clip overscroll-y-none">
          {drawer}
          {children}
          {showBottomNav ? <DealerBottomNav pathname={pathname} /> : null}
          {logoutDialog}
        </div>
      </DealerChromeContext.Provider>
    );
  }

  return (
    <DealerChromeContext.Provider value={chromeValue}>
      <div className="mysewa-app-shell mysewa-portal-shell min-h-dvh w-full max-w-full overflow-x-clip overscroll-y-none bg-background md:flex">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
          <div className="mb-6">{brandBlock}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">{navLinks}</div>
          <div className="mt-auto border-t border-border pt-3">{profileMenu("start")}</div>
        </aside>

        {drawer}

        <div className="flex min-w-0 max-w-full flex-col md:min-h-0 md:flex-1">
          {hideTopChrome ? null : (
            <header className="mysewa-portal-header sticky top-0 z-30 border-b border-border bg-surface/95 px-3 pt-[max(8px,var(--safe-area-top,env(safe-area-inset-top,0px)))] backdrop-blur sm:px-4 md:px-8 md:pt-5">
              <div className="flex min-w-0 items-center gap-2 pb-2">
                <button
                  type="button"
                  aria-label={t("nav.menu")}
                  aria-expanded={drawerOpen}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background md:hidden"
                  onClick={() => setDrawerOpen(true)}
                >
                  <Menu className="size-5" />
                </button>
                {headerLeading ? <div className="shrink-0">{headerLeading}</div> : null}
                {backControl ? <div className="shrink-0">{backControl}</div> : null}
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[17px] font-semibold tracking-tight md:text-xl">
                    {title}
                  </h1>
                  {description ? (
                    <p className="mt-0.5 hidden line-clamp-2 text-sm text-muted-foreground md:block">
                      {description}
                    </p>
                  ) : null}
                </div>
                {actions ? (
                  <div className="hidden max-w-[min(100%,22rem)] shrink-0 items-center gap-2 overflow-x-auto md:flex [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
                    {actions}
                  </div>
                ) : null}
                <div className="hidden shrink-0 md:block">{profileMenu("end")}</div>
              </div>
              {actions ? (
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-2 md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
                  {actions}
                </div>
              ) : null}
            </header>
          )}
          <main
            className={cn(
              "mysewa-portal-embed min-w-0 max-w-full overscroll-y-none md:flex-1",
              hideTopChrome
                ? "[--content-safe-top:var(--safe-area-top,env(safe-area-inset-top,0px))]"
                : "[--content-safe-top:0px]",
              flush
                ? "px-0 pt-0 pb-safe md:pb-[max(12px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))]"
                : "px-3 pt-5 pb-safe sm:px-4 md:px-8 md:py-6 md:pb-[max(1.25rem,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))]",
            )}
          >
            <PullToRefresh onRefresh={handlePullRefresh} disabled={disablePullToRefresh}>
              {children}
            </PullToRefresh>
          </main>
        </div>

        {showBottomNav ? <DealerBottomNav pathname={pathname} /> : null}
        {logoutDialog}
      </div>
    </DealerChromeContext.Provider>
  );
}
