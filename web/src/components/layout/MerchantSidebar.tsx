import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  CreditCard,
  Coins,
  Key,
  BookOpen,
  History,
  Landmark,
  MessageCircle,
  UserRound,
  Lock,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { SupportChatUnreadBadge } from "@/hooks/use-support-chat-unread";

export function MerchantSidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { logoUrl } = useSiteBranding();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchTab = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown>)?.tab as string | undefined,
  });

  const isGgrEnabled = Boolean(user?.is_ggr_user || user?.is_ggr);

  const displayName =
    (user?.business_name || "").trim() ||
    (user?.nickname || "").trim() ||
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    user?.phone ||
    "Merchant";

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/" });
  };

  const navItem = (
    tabId: string,
    label: string,
    icon: typeof Activity,
    to: string,
    search?: Record<string, string>,
    badge?: string,
    isLock?: boolean,
  ) => {
    const active =
      to === "/app/ggr"
        ? pathname === "/app/ggr"
        : pathname === "/app" && (!searchTab ? tabId === "overview" : searchTab === tabId);
    const Icon = icon;

    return (
      <Link
        to={to}
        search={search}
        className={cn(
          "flex items-center justify-between rounded-sm px-2.5 py-2 text-xs transition-all",
          active
            ? "bg-slate-100 text-slate-900 font-semibold shadow-2xs border-l-2 border-emerald-600"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium",
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn("size-3.5 shrink-0", active ? "text-emerald-700" : "text-slate-400")} />
          <span className="truncate">{label}</span>
        </div>
        {badge ? (
          <span
            className={cn(
              "text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-xs border",
              active
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-slate-50 text-slate-600 border-slate-200",
            )}
          >
            {badge}
          </span>
        ) : isLock ? (
          <span className="text-[9px] font-mono font-semibold px-1 py-0.2 rounded-xs bg-slate-100 text-slate-400 flex items-center gap-0.5">
            <Lock className="size-2.5" /> OFF
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-4 lg:flex select-none shadow-2xs">
      {/* Brand Header */}
      <Link to="/app" className="mb-4 flex items-center gap-2.5 px-1 py-1 border-b border-slate-100 pb-3">
        <img
          src={logoUrl || "/logo.png"}
          alt="MySewa"
          className="size-8 rounded-sm object-contain border border-slate-200 shadow-2xs bg-white p-0.5"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight font-bold tracking-tight text-slate-900">
            MySewa
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-semibold text-slate-500">
              API Merchant Console
            </span>
          </div>
        </div>
      </Link>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 [scrollbar-width:thin]">
        <div className="space-y-0.5">
          <div className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Operations
          </div>
          {navItem("overview", "Overview & Telemetry", Activity, "/app", { tab: "overview" }, "LIVE")}
          {navItem("payment-api", "Payment API", CreditCard, "/app", { tab: "payment-api" }, "PROD")}
          {navItem(
            "ggr",
            "GGR Gaming",
            Coins,
            "/app/ggr",
            undefined,
            isGgrEnabled ? "ACTIVE" : undefined,
            !isGgrEnabled,
          )}
          {navItem("bank-accounts", "Payout Accounts", Landmark, "/app", { tab: "bank-accounts" })}
          {navItem("ledger", "Transaction Ledger", History, "/app", { tab: "ledger" })}
        </div>

        <div className="space-y-0.5 pt-2 border-t border-slate-100">
          <div className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Integration
          </div>
          {navItem("api-keys", "API Keys & Webhooks", Key, "/app", { tab: "api-keys" })}
          {navItem("docs", "Production Docs", BookOpen, "/app", { tab: "docs" }, "DOCS")}
        </div>

        <div className="space-y-0.5 pt-2 border-t border-slate-100">
          <div className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Support
          </div>
          <Link
            to="/app/support-chat"
            className={cn(
              "flex items-center justify-between rounded-sm px-2.5 py-2 text-xs transition-colors",
              pathname.startsWith("/app/support-chat")
                ? "bg-slate-100 text-slate-900 font-semibold border-l-2 border-emerald-600"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium",
            )}
          >
            <div className="flex items-center gap-2">
              <MessageCircle className="size-3.5 shrink-0 text-emerald-600" />
              <span>Support Chat</span>
            </div>
            <SupportChatUnreadBadge />
          </Link>
          <Link
            to="/app/profile"
            className={cn(
              "flex items-center gap-2 rounded-sm px-2.5 py-2 text-xs transition-colors",
              pathname.startsWith("/app/profile")
                ? "bg-slate-100 text-slate-900 font-semibold border-l-2 border-emerald-600"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium",
            )}
          >
            <UserRound className="size-3.5 shrink-0 text-slate-400" />
            <span>Profile & KYC</span>
          </Link>
        </div>
      </div>

      {/* Merchant Footer Card */}
      <div className="mt-auto pt-3 border-t border-slate-100">
        <div className="rounded-sm bg-slate-50 p-2.5 border border-slate-200/80">
          <p className="text-xs font-bold text-slate-900 truncate">
            {displayName}
          </p>
          <p className="text-[10px] font-mono text-slate-400 mt-0.5">
            {user?.phone}
          </p>
          <div className="flex items-center gap-1 mt-1 text-[10px] text-emerald-700 font-medium">
            <ShieldCheck className="size-3 text-emerald-600" />
            <span>Verified Merchant</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 text-[11px] font-semibold text-rose-600 hover:text-rose-700 transition-colors cursor-pointer flex items-center gap-1"
          >
            <LogOut className="size-3" /> Sign Out
          </button>
        </div>
      </div>
    </aside>
  );
}
