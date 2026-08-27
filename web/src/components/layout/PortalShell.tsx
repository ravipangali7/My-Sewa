import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Wallet,
  History,
  Coins,
  BarChart3,
  Smartphone,
  User,
  LogOut,
  Menu,
  ChevronDown,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { AuthSessionLoader } from "@/components/AuthSessionLoader";
import { homePathForUser, isNetworkRole, roleLabel } from "@/lib/auth-destination";
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

function navForRole(role: string | undefined): NavItem[] {
  const common: NavItem[] = [
    { to: "/dealer", label: "Dashboard", icon: LayoutDashboard },
    { to: "/dealer/customers", label: "My Customers", icon: Users },
    { to: "/dealer/transactions", label: "Transactions", icon: History },
    { to: "/dealer/commission", label: "Commission", icon: Coins },
    { to: "/dealer/reports", label: "Reports", icon: BarChart3 },
    { to: "/app", label: "Wallet", icon: Wallet },
    { to: "/app/services", label: "Services", icon: Smartphone },
    { to: "/dealer/profile", label: "Profile", icon: User },
  ];
  if (role === "sub_agent") return common;
  return [
    ...common.slice(0, 2),
    { to: "/dealer/sub-agents", label: "My Sub-Agents", icon: UserPlus },
    ...common.slice(2),
  ];
}

function isNavActive(pathname: string, to: string) {
  if (to === "/dealer") return pathname === "/dealer" || pathname === "/dealer/";
  if (to === "/app") return pathname === "/app" || pathname === "/app/";
  if (to === "/app/services") return pathname.startsWith("/app/services");
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
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const navigate = useNavigate();
  const { user, token, isLoading, isStaff, logout } = useAuth();
  const { logoUrl } = useSiteBranding();

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

  if (!token || isLoading || !user || isStaff || !isNetworkRole(user)) {
    return <AuthSessionLoader />;
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
            <item.icon className="size-[18px]" />
            {item.label}
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

  return (
    <div className="mysewa-app-shell min-h-dvh w-full max-w-full overflow-x-clip overscroll-y-none bg-background md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <div className="mb-6">{brandBlock}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">{navLinks}</div>
        <div className="mt-auto border-t border-border pt-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
              >
                {avatar}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{label}</p>
                </div>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuLabel>{name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/dealer/profile">Profile</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/app">Wallet services</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-danger" onSelect={() => setLogoutOpen(true)}>
                <LogOut className="size-3.5" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="flex w-[min(100%,20rem)] flex-col gap-0 p-0">
          <SheetHeader className="border-b border-border px-4 py-4 text-left">
            <SheetTitle className="sr-only">Dealer menu</SheetTitle>
            <SheetDescription className="sr-only">Dealer portal navigation</SheetDescription>
            {brandBlock}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">{navLinks}</div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 max-w-full flex-col md:min-h-0 md:flex-1">
        <header className="sticky top-0 z-30 border-b border-border bg-surface/95 px-3 py-3 backdrop-blur sm:px-4 md:px-8">
          <div className="flex min-w-0 items-start gap-2">
            <button
              type="button"
              aria-label="Open menu"
              className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background md:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
              {description ? (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
            {actions ? <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div> : null}
          </div>
          {actions ? <div className="mt-3 flex gap-2 overflow-x-auto md:hidden">{actions}</div> : null}
        </header>
        <main className="min-w-0 max-w-full px-3 py-5 sm:px-4 md:flex-1 md:px-8 md:py-6">
          {children}
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
            <AlertDialogAction className="bg-danger text-white hover:bg-danger/90" onClick={handleLogout}>
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export { homePathForUser };
