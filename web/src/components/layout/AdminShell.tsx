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
  User,
  LogOut,
  ChevronDown,
  ArrowDownToLine,
  BarChart3,
  ShieldCheck,
  Package,
  Wifi,
  Droplets,
  Zap,
  FileSearch,
  MessageSquare,
  Coins,
  Bell,
  History,
  Handshake,
  GitBranch,
  TrendingUp,
  MessageCircle,
  Landmark,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { homePathForUser } from "@/lib/auth-destination";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { AuthSessionLoader } from "@/components/AuthSessionLoader";
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

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin/statement", label: "Statement", icon: FileSearch },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/support-chat", label: "Support Chat", icon: MessageCircle },
  { to: "/admin/dealers", label: "Dealers", icon: Handshake },
  { to: "/admin/hierarchy", label: "Dealer Hierarchy", icon: GitBranch },
  { to: "/admin/dealer-profit", label: "Dealer Profit", icon: TrendingUp },
  { to: "/admin/wallets", label: "Wallets", icon: Wallet },
  { to: "/admin/transaction-history", label: "Transaction History", icon: History },
  { to: "/admin/deposits", label: "Manual Deposit", icon: Inbox },
  { to: "/admin/payout-accounts", label: "Payout accounts", icon: Landmark },
  { to: "/admin/kyc", label: "KYC", icon: ShieldCheck },
  { to: "/admin/remittances", label: "Remittances", icon: ArrowDownToLine },
  { to: "/admin/topups", label: "Top-ups", icon: Smartphone },
  { to: "/admin/data-topups", label: "Data Top-Up", icon: Package },
  { to: "/admin/internet", label: "Internet", icon: Wifi },
  { to: "/admin/water", label: "Khanepani", icon: Droplets },
  { to: "/admin/community-electricity", label: "Community Power", icon: Zap },
  { to: "/admin/transfers", label: "Bank transfers", icon: Banknote },
  { to: "/admin/commission-history", label: "Commission History", icon: Coins },
  { to: "/admin/popups", label: "Popups", icon: MessageSquare },
  { to: "/admin/push", label: "Push notifications", icon: Bell },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
] as const;

/** Primary destinations shown in the mobile bottom bar. */
const BOTTOM_TABS = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/deposits", label: "Manual Deposit", icon: Inbox },
  { to: "/admin/wallets", label: "Wallets", icon: Wallet },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
] as const;

function isNavActive(pathname: string, to: string) {
  if (to === "/admin") {
    return pathname === "/admin" || pathname === "/admin/";
  }
  if (to === "/admin/statement") {
    return (
      pathname === to ||
      pathname.startsWith(`${to}/`) ||
      pathname === "/admin/himalpay-history"
    );
  }
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

function AdminProfileControls({
  user,
  roleLabel,
  variant,
  onNavigate,
}: {
  user: UserProfile;
  roleLabel: string;
  variant: "header" | "sidebar";
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const name = displayName(user);

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/" });
  };

  const avatar = (
    <Avatar className={cn(variant === "header" ? "size-8" : "size-9")}>
      {user.avatar_url ? <AvatarImage src={user.avatar_url} alt={name} /> : null}
      <AvatarFallback className="bg-brand-soft text-xs font-semibold text-brand-dark">
        {initials(user)}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "header" ? (
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left transition-colors hover:bg-muted"
            >
              {avatar}
              <span className="hidden max-w-[140px] truncate text-sm font-medium sm:inline">
                {name}
              </span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
            >
              {avatar}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{roleLabel}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user.phone}</p>
              </div>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={variant === "header" ? "end" : "start"}
          side={variant === "sidebar" ? "top" : "bottom"}
          className="w-56"
        >
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{name}</span>
              <span className="text-xs text-muted-foreground">{user.email || user.phone}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              to="/admin/profile"
              onClick={() => onNavigate?.()}
              className="cursor-pointer"
            >
              <User className="size-3.5" />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer text-danger focus:text-danger"
            onSelect={() => setLogoutOpen(true)}
          >
            <LogOut className="size-3.5" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  );
}

export function AdminShell({
  title,
  description,
  children,
  actions,
  dense = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Compact header + page padding for managed console surfaces */
  dense?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const { user, token, isLoading, isStaff } = useAuth();
  const { logoUrl } = useSiteBranding();

  useEffect(() => {
    if (!token) {
      navigate({ to: "/" });
      return;
    }
    if (!isLoading && user && !isStaff) {
      navigate({ to: homePathForUser(user) });
    }
  }, [token, isLoading, user, isStaff, navigate]);

  if (!token || isLoading || !user || !isStaff) {
    return <AuthSessionLoader />;
  }

  const roleLabel = user.is_superuser ? "Super Admin" : "Admin";
  const closeDrawer = () => setDrawerOpen(false);

  const navLinks = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
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
            {item.to === "/admin/support-chat" ? <SupportChatUnreadBadge /> : null}
          </Link>
        );
      })}
    </nav>
  );

  const brandBlock = (
    <Link to="/admin" onClick={closeDrawer} className="flex items-center gap-2.5 px-2">
      <img src={logoUrl} alt="MySewa" className="size-9 rounded-xl object-cover" />
      <div>
        <p className="text-[15px] leading-tight font-semibold">MySewa</p>
        <p className="text-xs text-muted-foreground">{roleLabel}</p>
      </div>
    </Link>
  );

  return (
    <div className="mysewa-app-shell min-h-dvh w-full max-w-full overflow-x-clip overscroll-y-none bg-background md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <div className="mb-6">{brandBlock}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">{navLinks}</div>
        <div className="mt-auto border-t border-border pt-3">
          <AdminProfileControls user={user} roleLabel={roleLabel} variant="sidebar" />
        </div>
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="flex w-[min(100%,20rem)] flex-col gap-0 p-0 pt-[var(--safe-area-top,env(safe-area-inset-top,0px))] pb-[var(--safe-area-bottom,env(safe-area-inset-bottom,0px))]"
        >
          <SheetHeader className="border-b border-border px-4 py-4 text-left">
            <SheetTitle className="sr-only">Admin menu</SheetTitle>
            <SheetDescription className="sr-only">
              Navigate between Super Admin sections
            </SheetDescription>
            {brandBlock}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">{navLinks}</div>
          <div className="border-t border-border px-3 py-3">
            <AdminProfileControls
              user={user}
              roleLabel={roleLabel}
              variant="sidebar"
              onNavigate={closeDrawer}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 max-w-full flex-col md:min-h-0 md:flex-1">
        <header
          className={cn(
            "sticky top-0 z-30 border-b border-border bg-surface/95 px-3 pt-[max(12px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-3 backdrop-blur sm:px-4 md:px-8",
            dense ? "md:pt-3 md:pb-3" : "md:pt-5 md:pb-5",
          )}
        >
          <div className="flex min-w-0 items-start gap-2 sm:gap-3">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground transition-colors hover:bg-muted md:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h1
                    className={cn(
                      "truncate font-semibold tracking-tight",
                      dense
                        ? "text-base sm:text-lg md:text-xl"
                        : "text-lg sm:text-xl md:text-[28px]",
                    )}
                  >
                    {title}
                  </h1>
                  {description && (
                    <p
                      className={cn(
                        "mt-0.5 line-clamp-2 text-muted-foreground md:truncate md:line-clamp-none",
                        dense ? "text-xs" : "text-sm",
                      )}
                    >
                      {description}
                    </p>
                  )}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {/* Inline actions only when sidebar layout has room; avoid clipping on phones/tablets */}
                  <div className="hidden max-w-[min(100%,22rem)] items-center gap-2 overflow-x-auto md:flex [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
                    {actions}
                  </div>
                  <AdminProfileControls
                    user={user}
                    roleLabel={roleLabel}
                    variant="header"
                    onNavigate={closeDrawer}
                  />
                </div>
              </div>
              {actions ? (
                <div className="mt-3 flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
                  {actions}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main
          className={cn(
            "min-w-0 max-w-full overscroll-y-none px-3 pb-safe sm:px-4 md:flex-1 md:px-8",
            dense ? "py-4 md:py-5 md:pb-5" : "py-5 md:py-7 md:pb-7",
          )}
        >
          {children}
        </main>

        <nav
          aria-label="Admin primary"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-surface/95 backdrop-blur-md pb-[max(8px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] md:hidden"
        >
          <ul className="grid grid-cols-5">
            {BOTTOM_TABS.map((tab) => {
              const active = isNavActive(pathname, tab.to);
              return (
                <li key={tab.to}>
                  <Link
                    to={tab.to}
                    className={cn(
                      "relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 px-0.5 pt-1.5 text-[10px] font-medium no-underline outline-none",
                      "active:bg-transparent focus-visible:bg-transparent",
                      active ? "text-brand" : "text-[#8A94A6]",
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute inset-x-4 top-0 h-[2.5px] rounded-b-full bg-brand"
                      />
                    ) : null}
                    <tab.icon className={cn("size-5", active && "stroke-[2.25px]")} />
                    <span className="max-w-full truncate leading-none">{tab.label}</span>
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
