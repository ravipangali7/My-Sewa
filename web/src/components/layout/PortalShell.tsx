import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Wallet,
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
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard };

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

function navForRole(role: string | undefined): NavItem[] {
  const items: NavItem[] = [
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
    { to: "/app", label: "Wallet", icon: Wallet },
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

export function PortalShell({
  title,
  description,
  children,
  actions,
  back,
  onBack,
  headerLeading,
  flush = false,
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
  const tabRefs = useRef<Record<string, HTMLElement | null>>({});

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

  useEffect(() => {
    const active = items.find((item) => isNavActive(pathname, item.to));
    const el = active ? tabRefs.current[active.to] : null;
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [pathname, items]);

  if (!token || isLoading || !user || isStaff || !isNetworkRole(user)) {
    return <AuthSessionLoader />;
  }

  if (immersive) {
    return (
      <div className="min-h-dvh w-full max-w-full overflow-x-clip overscroll-y-none">
        {children}
      </div>
    );
  }

  const label = roleLabel(user);
  const closeDrawer = () => setDrawerOpen(false);
  const name = displayName(user);

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
    <Link to="/dealer" onClick={closeDrawer} className="flex items-center gap-2.5 px-2">
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
          <Link to="/app">Wallet</Link>
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
          aria-label="Go back"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
        </button>
      ) : (
        <Link
          to={back!}
          aria-label="Go back"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
        </Link>
      )
    ) : null;

  return (
    <div className="mysewa-app-shell mysewa-portal-shell min-h-dvh w-full max-w-full overflow-x-clip overscroll-y-none bg-background md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <div className="mb-6">{brandBlock}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">{navLinks}</div>
        <div className="mt-auto border-t border-border pt-3">{profileMenu("start")}</div>
      </aside>

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

      <div className="flex min-w-0 max-w-full flex-col md:min-h-0 md:flex-1">
        <header className="mysewa-portal-header sticky top-0 z-30 border-b border-border bg-surface/95 px-3 pt-[max(10px,var(--safe-area-top,env(safe-area-inset-top,0px)))] backdrop-blur sm:px-4 md:px-8 md:pt-5">
          <div className="flex min-w-0 items-start gap-2 pb-2">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background md:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            {headerLeading ? <div className="mt-0.5 shrink-0">{headerLeading}</div> : null}
            {backControl ? <div className="mt-0.5 shrink-0">{backControl}</div> : null}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
              {description && !flush ? (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
            {actions ? (
              <div className="hidden max-w-[min(100%,22rem)] shrink-0 items-center gap-2 overflow-x-auto md:flex [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
                {actions}
              </div>
            ) : null}
            <div className="mt-0.5 shrink-0">{profileMenu("end")}</div>
          </div>
          {actions ? (
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-2 md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
              {actions}
            </div>
          ) : null}
          <nav
            aria-label="Dealer pages"
            className="mysewa-portal-tabs -mx-3 flex gap-1 overflow-x-auto overscroll-x-contain px-3 pb-2.5 sm:-mx-4 sm:px-4 md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {items.map((item) => {
              const active = isNavActive(pathname, item.to);
              return (
                <span
                  key={item.to}
                  ref={(el) => {
                    tabRefs.current[item.to] = el;
                  }}
                  className="shrink-0"
                >
                  <Link
                    to={item.to}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                      active
                        ? "bg-brand-soft text-brand-dark"
                        : "bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-3.5" />
                    {item.label}
                    {item.to === "/app/support-chat" ? (
                      <SupportChatUnreadBadge className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-brand px-1 py-0.5 text-[9px] font-semibold leading-none text-primary-foreground" />
                    ) : null}
                  </Link>
                </span>
              );
            })}
          </nav>
        </header>
        <main
          className={cn(
            "mysewa-portal-embed min-w-0 max-w-full overscroll-y-none [--content-safe-top:0px] md:flex-1",
            flush
              ? "px-0 pt-0 pb-[max(12px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))]"
              : "px-3 pt-5 pb-[max(1.25rem,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] sm:px-4 md:px-8 md:py-6",
          )}
        >
          <PullToRefresh onRefresh={handlePullRefresh} disabled={disablePullToRefresh}>
            {children}
          </PullToRefresh>
        </main>
      </div>

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
    </div>
  );
}
