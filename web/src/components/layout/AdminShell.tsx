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
  Receipt,
  KeyRound,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { SwitchAccountModal } from "@/components/SwitchAccountModal";
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

export type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: "support-chat";
};

export type NavGroup = {
  id: string;
  title: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    title: "Overview & Audits",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { to: "/admin/reports", label: "Financial Reports", icon: BarChart3 },
      { to: "/admin/statement", label: "Audit Statement", icon: FileSearch },
    ],
  },
  {
    id: "network",
    title: "Directory & Partners",
    items: [
      { to: "/admin/users", label: "User Directory", icon: Users },
      { to: "/admin/api-users", label: "API Merchants", icon: KeyRound },
      { to: "/admin/shareholders", label: "Shareholder Revenue", icon: Coins },
      { to: "/admin/dealers", label: "Dealer Directory", icon: Handshake },
      { to: "/admin/hierarchy", label: "Dealer Hierarchy", icon: GitBranch },
      { to: "/admin/dealer-profit", label: "Dealer Profit Share", icon: TrendingUp },
      { to: "/admin/kyc", label: "KYC Verification", icon: ShieldCheck },
    ],
  },
  {
    id: "finance",
    title: "Settlement & Ledger",
    items: [
      { to: "/admin/wallets", label: "User Wallets", icon: Wallet },
      { to: "/admin/transaction-history", label: "Transaction Ledger", icon: History },
      { to: "/admin/deposits", label: "Manual Deposits", icon: Inbox },
      { to: "/admin/transfers", label: "Bank Transfers", icon: Banknote },
      { to: "/admin/payout-accounts", label: "Payout Accounts", icon: Landmark },
      { to: "/admin/remittances", label: "Remittances", icon: ArrowDownToLine },
      { to: "/admin/commission-charge", label: "Commission Setup", icon: Receipt },
      { to: "/admin/commission-history", label: "Commission History", icon: Coins },
    ],
  },
  {
    id: "utilities",
    title: "Utility Services",
    items: [
      { to: "/admin/topups", label: "Mobile Top-ups", icon: Smartphone },
      { to: "/admin/data-topups", label: "Data Packages", icon: Package },
      { to: "/admin/internet", label: "Internet Providers", icon: Wifi },
      { to: "/admin/water", label: "Khanepani Water", icon: Droplets },
      { to: "/admin/community-electricity", label: "Community Power", icon: Zap },
    ],
  },
  {
    id: "engagement",
    title: "System & Support",
    items: [
      { to: "/admin/support-chat", label: "Support Chat", icon: MessageCircle, badge: "support-chat" },
      { to: "/admin/popups", label: "Announcements", icon: MessageSquare },
      { to: "/admin/push", label: "Push Notifications", icon: Bell },
      { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

const ADMIN_BOTTOM_TABS = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/deposits", label: "Deposit", icon: Inbox },
  { to: "/admin/wallets", label: "Wallets", icon: Wallet },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
] as const;

const SHAREHOLDER_BOTTOM_TABS = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/shareholders", label: "Equity", icon: Coins },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
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
  const { logout, openLogoutDialog } = useAuth();
  const [switchAccountOpen, setSwitchAccountOpen] = useState(false);
  const name = displayName(user);


  const isShareholder = user.role === "shareholder";
  const isSuper = user.is_superuser;

  const avatar = (
    <Avatar className={cn(variant === "header" ? "size-7 rounded-sm ring-1 ring-slate-200" : "size-8 rounded-sm ring-1 ring-slate-200")}>
      {user.avatar_url ? <AvatarImage src={user.avatar_url} alt={name} /> : null}
      <AvatarFallback className="bg-slate-100 rounded-sm text-xs font-bold text-slate-800">
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
              className="flex items-center gap-2 rounded-sm border border-slate-200 bg-white px-2.5 py-1.5 text-left shadow-2xs transition-colors hover:bg-slate-50 cursor-pointer"
            >
              {avatar}
              <div className="hidden text-left sm:block">
                <span className="block max-w-[130px] truncate text-xs font-semibold leading-tight text-slate-900">
                  {name}
                </span>
                <span className="block text-[10px] text-slate-500 font-medium">
                  {roleLabel}
                </span>
              </div>
              <ChevronDown className="size-3 text-slate-400" />
            </button>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-sm border border-slate-200 bg-white p-2 text-left shadow-2xs transition-colors hover:bg-slate-50 cursor-pointer"
            >
              {avatar}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-900">{name}</p>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-xs px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider",
                      isSuper
                        ? "bg-purple-50 text-purple-700 border border-purple-200"
                        : isShareholder
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-200",
                    )}
                  >
                    {roleLabel}
                  </span>
                  <span className="truncate text-[10px] text-slate-400 font-mono">
                    {user.phone}
                  </span>
                </div>
              </div>
              <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={variant === "header" ? "end" : "start"}
          side={variant === "sidebar" ? "top" : "bottom"}
          className="w-56 rounded-md shadow-md border-slate-200 bg-white"
        >
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-slate-900">{name}</span>
              <span className="text-[11px] text-slate-500">{user.email || user.phone}</span>
              <span className="text-[10px] font-mono font-medium text-emerald-600 pt-0.5">
                Role: {roleLabel}
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-slate-100" />
          <DropdownMenuItem asChild>
            <Link
              to="/admin/profile"
              onClick={() => onNavigate?.()}
              className="cursor-pointer text-xs"
            >
              <User className="size-3.5 mr-2" />
              Account Profile
            </Link>
          </DropdownMenuItem>
          {isShareholder && (
            <DropdownMenuItem asChild>
              <Link
                to="/admin/shareholders"
                onClick={() => onNavigate?.()}
                className="cursor-pointer text-xs text-amber-700"
              >
                <Coins className="size-3.5 mr-2" />
                Shareholder Balance
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="bg-slate-100" />
          <DropdownMenuItem
            className="cursor-pointer text-xs focus:bg-slate-50"
            onSelect={() => setSwitchAccountOpen(true)}
          >
            <Users className="size-3.5 mr-2" />
            Switch Account
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer text-xs text-red-600 focus:text-red-700 focus:bg-red-50"
            onSelect={openLogoutDialog}
          >
            <LogOut className="size-3.5 mr-2" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SwitchAccountModal open={switchAccountOpen} onOpenChange={setSwitchAccountOpen} />
    </>
  );
}

export function AdminShell({
  title,
  description,
  children,
  actions,
  dense = false,
  fillHeight = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  dense?: boolean;
  fillHeight?: boolean;
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

  const isShareholder = user.role === "shareholder";
  const roleLabel = user.is_superuser
    ? "Super Admin"
    : isShareholder
    ? "Shareholder"
    : user.is_staff
    ? "Staff Admin"
    : "Admin";

  const closeDrawer = () => setDrawerOpen(false);

  const navLinks = (
    <div className="flex flex-col gap-4 py-1">
      {NAV_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          <div className="px-2.5 pb-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase font-mono">
            {group.title}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isNavActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={closeDrawer}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-xs transition-all",
                    active
                      ? "bg-slate-100 text-slate-900 font-semibold shadow-2xs border-l-2 border-emerald-600"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium",
                  )}
                >
                  <item.icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      active
                        ? "text-emerald-700"
                        : "text-slate-400 group-hover:text-slate-600",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge === "support-chat" ? <SupportChatUnreadBadge /> : null}
                  {item.to === "/admin/shareholders" && isShareholder ? (
                    <span className="rounded-xs bg-amber-50 border border-amber-200 px-1.5 py-0.2 text-[9px] font-bold text-amber-700">
                      Equity
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  const brandBlock = (
    <Link
      to="/admin"
      onClick={closeDrawer}
      className="flex items-center gap-2.5 rounded-sm p-1.5 transition-colors hover:bg-slate-50"
    >
      <img
        src={logoUrl || "/logo.png"}
        alt="MySewa"
        className="size-8 rounded-sm object-contain border border-slate-200 shadow-2xs bg-white p-0.5"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm leading-tight font-bold tracking-tight text-slate-900">
            MySewa
          </p>
          <span className="inline-flex items-center rounded-xs bg-emerald-50 px-1 py-0.2 text-[9px] font-semibold text-emerald-700 border border-emerald-200">
            Console
          </span>
        </div>
        <p className="text-[10px] text-slate-400 font-medium pt-0.5">
          {isShareholder ? "Shareholder & Admin" : "Enterprise Operations"}
        </p>
      </div>
    </Link>
  );

  const bottomTabs = isShareholder ? SHAREHOLDER_BOTTOM_TABS : ADMIN_BOTTOM_TABS;

  return (
    <div
      className={cn(
        "mysewa-app-shell min-h-dvh w-full max-w-full overflow-x-clip overscroll-y-none bg-[#f8fafc] text-slate-900 md:flex",
        fillHeight &&
          "mysewa-fill-height flex h-[var(--vv-height,100dvh)] max-h-[var(--vv-height,100dvh)] flex-col overflow-hidden md:flex-row",
      )}
    >
      {/* Desktop Professional Clean White Sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-4 shadow-2xs md:flex select-none">
        <div className="mb-3 pb-3 border-b border-slate-100">{brandBlock}</div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
          {navLinks}
        </div>
        <div className="mt-auto border-t border-slate-100 pt-3">
          <AdminProfileControls user={user} roleLabel={roleLabel} variant="sidebar" />
        </div>
      </aside>

      {/* Mobile Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="flex w-[min(100%,19rem)] flex-col gap-0 p-0 pt-[var(--safe-area-top,env(safe-area-inset-top,0px))] pb-[var(--safe-area-bottom,env(safe-area-inset-bottom,0px))] bg-white border-r border-slate-200"
        >
          <SheetHeader className="border-b border-slate-100 px-4 py-3 text-left">
            <SheetTitle className="sr-only">Admin Navigation Menu</SheetTitle>
            <SheetDescription className="sr-only">
              Navigation menu
            </SheetDescription>
            {brandBlock}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{navLinks}</div>
          <div className="border-t border-slate-100 px-3 py-3 bg-slate-50/50">
            <AdminProfileControls
              user={user}
              roleLabel={roleLabel}
              variant="sidebar"
              onNavigate={closeDrawer}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div
        className={cn(
          "flex min-w-0 max-w-full flex-col md:min-h-0 md:flex-1",
          fillHeight && "h-full min-h-0 flex-1 overflow-hidden",
        )}
      >
        <header
          className={cn(
            "sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 px-3 pt-[max(10px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-3 backdrop-blur-md shadow-2xs sm:px-4 md:px-7",
            dense ? "md:pt-2.5 md:pb-2.5" : "md:pt-3.5 md:pb-3.5",
          )}
        >
          <div className="flex min-w-0 items-start gap-2 sm:gap-3">
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 md:hidden cursor-pointer"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="size-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h1
                      className={cn(
                        "truncate font-bold tracking-tight text-slate-900",
                        dense
                          ? "text-base sm:text-lg"
                          : "text-lg sm:text-xl",
                      )}
                    >
                      {title}
                    </h1>
                    {isShareholder && (
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-xs border border-amber-200 bg-amber-50 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800">
                        <Sparkles className="size-2.5 text-amber-600" />
                        Shareholder
                      </span>
                    )}
                  </div>
                  {description && (
                    <p
                      className={cn(
                        "mt-0.5 line-clamp-1 text-slate-500",
                        dense ? "text-xs" : "text-xs",
                      )}
                    >
                      {description}
                    </p>
                  )}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <Link
                    to="/admin/support-chat"
                    aria-label="Support Chat"
                    className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 md:hidden"
                  >
                    <MessageCircle className="size-4" />
                    <SupportChatUnreadBadge variant="icon" className="ring-white" />
                  </Link>
                  <div className="hidden max-w-[min(100%,24rem)] items-center gap-1.5 overflow-x-auto md:flex">
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
                <div className="mt-2.5 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5 md:hidden">
                  {actions}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main
          className={cn(
            "min-w-0 max-w-full overscroll-y-none px-3 pb-safe sm:px-4 md:flex-1 md:px-7",
            dense ? "py-3.5 md:py-4 md:pb-5" : "py-4 md:py-5 md:pb-8",
            fillHeight && "flex min-h-0 flex-1 flex-col overflow-hidden py-3 md:py-4",
          )}
        >
          {children}
        </main>

        <nav
          aria-label="Admin quick navigation"
          className="mysewa-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-[max(6px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] shadow-md md:hidden"
        >
          <ul className="grid grid-cols-5">
            {bottomTabs.map((tab) => {
              const active = isNavActive(pathname, tab.to);
              return (
                <li key={tab.to}>
                  <Link
                    to={tab.to}
                    className={cn(
                      "relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 px-0.5 pt-1 text-[10px] font-medium no-underline outline-none",
                      active ? "text-emerald-700 font-bold" : "text-slate-500",
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute inset-x-3 top-0 h-[2px] rounded-b-xs bg-emerald-600"
                      />
                    ) : null}
                    <tab.icon className={cn("size-4", active && "stroke-[2.25px]")} />
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
