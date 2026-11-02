import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  CreditCard,
  Coins,
  Key,
  BookOpen,
  History,
  Smartphone,
  Send,
  Wifi,
  Zap,
  Droplet,
  Globe,
  Wallet,
  FileText,
  MessageCircle,
  UserRound,
  Lock,
  LogOut,
  ShieldCheck,
  ChevronRight,
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

  return (
    <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3.5 py-5 lg:flex select-none">
      {/* Brand Header */}
      <Link to="/app" className="mb-5 flex items-center gap-3 px-2 py-1">
        <img
          src={logoUrl || "/logo.png"}
          alt="MySewa"
          className="size-9 rounded-full object-cover shadow-xs"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] leading-tight font-bold tracking-tight">
            <span className="text-ocean font-extrabold">My</span>
            <span className="text-brand font-extrabold">Sewa</span>
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
              Merchant Portal
            </span>
          </div>
        </div>
      </Link>

      {/* Scrollable Navigation Sections */}
      <div className="flex-1 overflow-y-auto space-y-5 pr-1 scrollbar-thin">
        {/* Section 1: Merchant Operations */}
        <div className="space-y-1">
          <div className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Merchant Operations
          </div>

          {/* Overview & Telemetry */}
          {(() => {
            const active =
              pathname === "/app" &&
              (!searchTab || searchTab === "overview");
            return (
              <Link
                to="/app"
                search={{ tab: "overview" }}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all",
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70 hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Activity className="size-4 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span>Overview & Telemetry</span>
                </div>
                <span
                  className={cn(
                    "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                    active
                      ? "bg-emerald-700/60 text-white"
                      : "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  LIVE
                </span>
              </Link>
            );
          })()}

          {/* Payment API (Payin/Payout) */}
          {(() => {
            const active = pathname === "/app" && searchTab === "payment-api";
            return (
              <Link
                to="/app"
                search={{ tab: "payment-api" }}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all",
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70 hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <CreditCard className="size-4 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span>Payment API (Payin/Payout)</span>
                </div>
                <span
                  className={cn(
                    "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                    active
                      ? "bg-emerald-700/60 text-white"
                      : "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400",
                  )}
                >
                  1.5% / 2%
                </span>
              </Link>
            );
          })()}

          {/* GGR Gaming Engine */}
          {(() => {
            const active = pathname === "/app/ggr" || (pathname === "/app" && searchTab === "ggr");
            return (
              <Link
                to="/app/ggr"
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all",
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70 hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Coins className="size-4 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span>GGR Gaming Engine</span>
                </div>
                {isGgrEnabled ? (
                  <span
                    className={cn(
                      "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                      active
                        ? "bg-emerald-700/60 text-white"
                        : "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    ACTIVE
                  </span>
                ) : (
                  <span
                    className={cn(
                      "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1",
                      active
                        ? "bg-emerald-700/60 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500",
                    )}
                  >
                    <Lock className="size-2.5" />
                    OFF
                  </span>
                )}
              </Link>
            );
          })()}

          {/* API Keys & Webhooks */}
          {(() => {
            const active = pathname === "/app" && searchTab === "api-keys";
            return (
              <Link
                to="/app"
                search={{ tab: "api-keys" }}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all",
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70 hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Key className="size-4 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span>API Keys & Webhooks</span>
                </div>
              </Link>
            );
          })()}

          {/* API Docs & Sandbox */}
          {(() => {
            const active = pathname === "/app" && searchTab === "docs";
            return (
              <Link
                to="/app"
                search={{ tab: "docs" }}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all",
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70 hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <BookOpen className="size-4 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span>API Docs & Sandbox</span>
                </div>
                <span
                  className={cn(
                    "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                    active
                      ? "bg-emerald-700/60 text-white"
                      : "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400",
                  )}
                >
                  SDK
                </span>
              </Link>
            );
          })()}

          {/* Transaction Ledger */}
          {(() => {
            const active = pathname === "/app" && searchTab === "ledger";
            return (
              <Link
                to="/app"
                search={{ tab: "ledger" }}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all",
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70 hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <History className="size-4 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span>Transaction Ledger</span>
                </div>
              </Link>
            );
          })()}
        </div>

        {/* Section 2: Consumer Services */}
        <div className="space-y-1 pt-2 border-t border-zinc-100 dark:border-zinc-900">
          <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            <span>Consumer Services</span>
            <span className="text-[10px] font-normal text-zinc-400">Personal Wallet</span>
          </div>
          <p className="px-2 text-[11px] text-zinc-400 dark:text-zinc-500 pb-1 leading-snug">
            Use your wallet cash for consumer utility payments anytime:
          </p>

          <Link
            to="/app/topup"
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/topup")
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <Smartphone className="size-4 text-emerald-600 shrink-0" />
            <span>Mobile Topup</span>
          </Link>

          <Link
            to="/app/transfer"
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/transfer")
                ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <Send className="size-4 text-blue-600 shrink-0" />
            <span>Bank & Fund Transfer</span>
          </Link>

          <Link
            to="/app/internet"
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/internet")
                ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <Wifi className="size-4 text-indigo-600 shrink-0" />
            <span>Internet Bill</span>
          </Link>

          <Link
            to="/app/electricity"
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/electricity")
                ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <Zap className="size-4 text-amber-500 shrink-0" />
            <span>Electricity Bill</span>
          </Link>

          <Link
            to="/app/water"
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/water")
                ? "bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <Droplet className="size-4 text-cyan-600 shrink-0" />
            <span>Water Bill (Khanepani)</span>
          </Link>

          <Link
            to="/app/remittance"
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/remittance")
                ? "bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <Globe className="size-4 text-purple-600 shrink-0" />
            <span>Remittance Transfer</span>
          </Link>

          <Link
            to="/app/load"
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/load")
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <Wallet className="size-4 text-emerald-600 shrink-0" />
            <span>Load Wallet Cash</span>
          </Link>

          <Link
            to="/app/history"
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/history")
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <FileText className="size-4 text-zinc-500 shrink-0" />
            <span>All Statements</span>
          </Link>
        </div>

        {/* Section 3: Support & Profile */}
        <div className="space-y-1 pt-2 border-t border-zinc-100 dark:border-zinc-900">
          <Link
            to="/app/support-chat"
            className={cn(
              "flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/support-chat")
                ? "bg-brand-soft text-brand-dark font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <div className="flex items-center gap-2.5">
              <MessageCircle className="size-4 shrink-0 text-emerald-600" />
              <span>Support Chat</span>
            </div>
            <SupportChatUnreadBadge />
          </Link>

          <Link
            to="/app/profile"
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              pathname.startsWith("/app/profile")
                ? "bg-brand-soft text-brand-dark font-semibold"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900/70",
            )}
          >
            <UserRound className="size-4 shrink-0 text-zinc-500" />
            <span>Profile & KYC</span>
          </Link>
        </div>
      </div>

      {/* Merchant Account Footer Card */}
      <div className="mt-auto pt-3 border-t border-zinc-200/80 dark:border-zinc-800">
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/70 p-3 border border-zinc-200/60 dark:border-zinc-800/60">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {displayName}
              </p>
              <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                {user?.phone}
              </p>
              <div className="flex items-center gap-1 mt-1 text-[10px] text-emerald-600 font-medium">
                <ShieldCheck className="size-3" />
                <span>Verified Merchant</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 text-xs font-semibold text-red-500 hover:text-red-600 transition-colors cursor-pointer"
          >
            Log out
          </button>
        </div>
      </div>
    </aside>
  );
}
