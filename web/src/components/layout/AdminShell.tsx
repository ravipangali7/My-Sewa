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
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
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

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/wallets", label: "Wallets", icon: Wallet },
  { to: "/admin/deposits", label: "Deposits", icon: Inbox },
  { to: "/admin/topups", label: "Top-ups", icon: Smartphone },
  { to: "/admin/transfers", label: "Bank transfers", icon: Banknote },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

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
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user, token, isLoading, isStaff } = useAuth();

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
        const active =
          item.to === "/admin"
            ? pathname === "/admin" || pathname === "/admin/"
            : pathname === item.to || pathname.startsWith(`${item.to}/`);
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
        <div className="mt-auto border-t border-border pt-3">
          <AdminProfileControls user={user} roleLabel={roleLabel} variant="sidebar" />
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
            <div className="ml-auto flex items-center gap-2">
              {actions}
              <AdminProfileControls
                user={user}
                roleLabel={roleLabel}
                variant="header"
                onNavigate={() => setOpen(false)}
              />
            </div>
          </div>
          {open && (
            <div className="mt-3 space-y-3 md:hidden">
              {nav}
              <div className="border-t border-border pt-2">
                <AdminProfileControls
                  user={user}
                  roleLabel={roleLabel}
                  variant="sidebar"
                  onNavigate={() => setOpen(false)}
                />
              </div>
            </div>
          )}
        </header>
        <main className="flex-1 px-4 py-5 md:px-8 md:py-7">{children}</main>
      </div>
    </div>
  );
}
