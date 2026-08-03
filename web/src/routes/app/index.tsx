import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bell,
  ChevronRight,
  Eye,
  EyeOff,
  ArrowDownToLine,
  Send,
  History,
  Smartphone,
  Redo2,
} from "lucide-react";
import { UserShell } from "@/components/layout/UserShell";
import { MountainBackdrop } from "@/components/home/MountainBackdrop";
import { WalletIllustration } from "@/components/home/WalletIllustration";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { apiClient } from "@/lib/api";
import { buildActivity } from "@/lib/activity";
import { buildNotifications } from "@/lib/notifications";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { LIVE_REFETCH_MS } from "@/lib/refresh";
import { isAccountPending } from "@/lib/account-status";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { toast } from "sonner";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Wallet Home — MySewa" },
      {
        name: "description",
        content:
          "Your MySewa wallet balance in NPR with quick access to load, top-up and bank transfer.",
      },
      { property: "og:title", content: "Wallet Home — MySewa" },
      { property: "og:description", content: "Balance, quick actions and recent wallet activity." },
    ],
  }),
  component: WalletHome,
});

const ACTIONS = [
  {
    to: "/app/transfer",
    labelKey: "home.fundTransfer" as const satisfies MessageKey,
    icon: Send,
    iconBg: "bg-[#22C55E]",
  },
  {
    to: "/app/topup",
    labelKey: "home.topUp" as const satisfies MessageKey,
    icon: Smartphone,
    iconBg: "bg-[#F59E0B]",
  },
  {
    to: "/app/remittance",
    labelKey: "home.receiveRemittance" as const satisfies MessageKey,
    icon: ArrowDownToLine,
    iconBg: "bg-[#2563EB]",
  },
  {
    to: "/app/history",
    labelKey: "home.history" as const satisfies MessageKey,
    icon: History,
    iconBg: "bg-[#7C3AED]",
  },
] as const;

function formatRu(value: string | number) {
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "रु. —";
  return `रु. ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTxStamp(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-CA"); // YYYY-MM-DD
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} ${time}`;
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("977") && digits.length >= 12) {
    return `+977 ${digits.slice(3)}`;
  }
  if (digits.length === 10) return `+977 ${digits}`;
  if (phone.startsWith("+")) return phone;
  return phone ? `+977 ${phone}` : "";
}

function WalletHome() {
  const { user, wallet } = useAuth();
  const { logoUrl } = useSiteBranding();
  const { t, locale } = useI18n();
  const accountPending = isAccountPending(user);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const txQuery = useQuery({
    queryKey: ["wallet", "transactions"],
    queryFn: () => apiClient.walletTransactions(),
    refetchInterval: LIVE_REFETCH_MS,
  });

  const activity = useMemo(
    () => (txQuery.data ? buildActivity(txQuery.data, t).slice(0, 3) : []),
    [txQuery.data, t, locale],
  );
  const unreadCount = useMemo(
    () =>
      txQuery.data
        ? buildNotifications(txQuery.data, t).filter((n) => n.unread).length
        : 0,
    [txQuery.data, t, locale],
  );
  const firstName = user?.first_name?.trim() || t("common.user");
  const initials = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .map((s) => s![0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "MS";

  return (
    <UserShell title="MySewa" hideHeader>
      <div className="relative min-h-[100dvh] bg-[#F3F5F8] lg:rounded-2xl lg:overflow-hidden">
        {/* Header band */}
        <section className="relative overflow-hidden bg-[linear-gradient(105deg,#04275C_0%,#0A3D7A_28%,#0C5F8A_55%,#0A8A6A_82%,#10B981_100%)] px-4 pb-[72px] pt-[max(12px,env(safe-area-inset-top))]">
          <MountainBackdrop className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] w-full opacity-90" />

          <div className="relative z-10 flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src={logoUrl}
                alt="MySewa"
                className="size-[44px] shrink-0 rounded-full object-cover shadow-[0_4px_14px_rgba(0,0,0,0.25)] ring-[2.5px] ring-white/40"
              />
              <div className="leading-tight">
                <p className="text-[22px] font-bold tracking-tight">
                  <span className="text-white">My</span>
                  <span className="text-[#6CFFAE]">Sewa</span>
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-white/90">
                  {t("home.tagline")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-0.5">
              <LanguageToggle />
              <Link
                to="/app/notifications"
                aria-label={t("home.notifications")}
                className="relative mt-1 flex size-10 items-center justify-center rounded-full text-white"
              >
                <Bell className="size-[22px]" strokeWidth={1.75} />
                {unreadCount > 0 ? (
                  <span className="absolute top-1 right-1 flex size-[16px] items-center justify-center rounded-full bg-[#FF3B30] text-[9px] font-bold text-white ring-2 ring-[#0B4A8F]/70">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </Link>
            </div>
          </div>

          <div className="relative z-10 mt-5 flex items-center gap-3">
            <Avatar className="size-[52px] ring-2 ring-white/40 shadow-md">
              {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt={firstName} /> : null}
              <AvatarFallback className="bg-white/20 text-sm font-semibold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-[18px] font-bold text-white">
                {t("home.greeting", { name: firstName })}
              </p>
              <p className="mt-0.5 text-[13px] font-medium text-white/80">
                {user ? formatPhone(user.phone) : ""}
              </p>
            </div>
          </div>
        </section>

        {/* Content overlapping header */}
        <div className="relative z-20 -mt-10 space-y-4 px-4 pb-6">
          {/* Wallet card */}
          <section className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(145deg,#062A5C_0%,#0B3B7A_38%,#0B5588_68%,#0A6E78_100%)] px-5 pb-5 pt-4 shadow-[0_14px_36px_-10px_rgba(6,42,92,0.55)]">
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 18% 78%, rgba(125,211,252,0.45) 0 1.2px, transparent 1.8px), radial-gradient(circle at 72% 72%, rgba(165,243,252,0.35) 0 1px, transparent 1.6px), radial-gradient(circle at 88% 58%, rgba(103,232,249,0.3) 0 1.4px, transparent 2.2px), radial-gradient(circle at 55% 85%, rgba(110,231,183,0.25) 0 1px, transparent 1.5px)",
                backgroundSize: "26px 26px, 34px 34px, 20px 20px, 30px 30px",
              }}
            />

            <div className="relative z-10 flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 text-white">
                <span className="text-[13px] font-medium tracking-wide">{t("home.wallet")}</span>
                <button
                  type="button"
                  aria-label={balanceVisible ? t("home.hideBalance") : t("home.showBalance")}
                  onClick={() => setBalanceVisible((v) => !v)}
                  className="inline-flex size-7 items-center justify-center rounded-full text-white/90"
                >
                  {balanceVisible ? (
                    <Eye className="size-[16px]" strokeWidth={1.75} />
                  ) : (
                    <EyeOff className="size-[16px]" strokeWidth={1.75} />
                  )}
                </button>
              </div>
              <span className="shrink-0 rounded-full bg-[#22C55E] px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white shadow-sm">
                {t("home.remittanceReceived")}
              </span>
            </div>

            <div className="relative z-10 mt-3 flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="tabular text-[34px] leading-none font-bold tracking-tight text-white">
                  {wallet
                    ? balanceVisible
                      ? formatRu(wallet.balance)
                      : "रु. ••••••"
                    : "रु. —"}
                </p>
                <p className="mt-2 text-[11px] font-medium text-white/75">
                  {t("home.balanceCaption")}
                </p>
              </div>
              <WalletIllustration className="mb-[-4px] h-[88px] w-[108px] shrink-0" />
            </div>
          </section>

          {/* Quick actions */}
          <section className="grid grid-cols-4 gap-2.5">
            {ACTIONS.map((a) => {
              const blocked =
                accountPending &&
                (a.to === "/app/transfer" ||
                  a.to === "/app/topup" ||
                  a.to === "/app/remittance");
              if (blocked) {
                return (
                  <button
                    key={a.to}
                    type="button"
                    onClick={() => toast.error(t("account.pending"))}
                    className="flex flex-col items-center gap-2 rounded-2xl bg-white px-1.5 py-3.5 opacity-70 shadow-[0_4px_16px_-6px_rgba(16,24,40,0.14)] transition-transform active:scale-[0.97]"
                  >
                    <span
                      className={cn(
                        "flex size-11 items-center justify-center rounded-full text-white shadow-sm",
                        a.iconBg,
                      )}
                    >
                      <a.icon className="size-5" strokeWidth={2.25} />
                    </span>
                    <span className="text-center text-[11px] leading-tight font-semibold text-[#0B2B4A]">
                      {t(a.labelKey)}
                    </span>
                  </button>
                );
              }
              return (
                <Link
                  key={a.to}
                  to={a.to}
                  className="flex flex-col items-center gap-2 rounded-2xl bg-white px-1.5 py-3.5 shadow-[0_4px_16px_-6px_rgba(16,24,40,0.14)] transition-transform active:scale-[0.97]"
                >
                  <span
                    className={cn(
                      "flex size-11 items-center justify-center rounded-full text-white shadow-sm",
                      a.iconBg,
                    )}
                  >
                    <a.icon className="size-5" strokeWidth={2.25} />
                  </span>
                  <span className="text-center text-[11px] leading-tight font-semibold text-[#0B2B4A]">
                    {t(a.labelKey)}
                  </span>
                </Link>
              );
            })}
          </section>

          {/* Recent transactions */}
          <section>
            <div className="mb-2.5 flex items-center justify-between px-0.5">
              <h2 className="text-[16px] font-bold text-[#0B2B4A]">{t("home.recentTx")}</h2>
              <Link
                to="/app/history"
                className="inline-flex items-center gap-0.5 rounded-full bg-[#DCEBFA] px-3 py-1 text-[11px] font-semibold text-[#3B7FC4]"
              >
                {t("home.viewAll")}
                <ChevronRight className="size-3.5 stroke-[2.5px]" />
              </Link>
            </div>

            {txQuery.isLoading ? (
              <div className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-muted-foreground shadow-[0_4px_16px_-6px_rgba(16,24,40,0.12)]">
                {t("home.loadingActivity")}
              </div>
            ) : activity.length === 0 ? (
              <div className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-muted-foreground shadow-[0_4px_16px_-6px_rgba(16,24,40,0.12)]">
                {t("home.noActivity")}
              </div>
            ) : (
              <ul className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_16px_-6px_rgba(16,24,40,0.12)]">
                {activity.map((item, idx) => (
                  <li key={item.id}>
                    <Link
                      to="/app/history/$activityId"
                      params={{ activityId: item.id }}
                      className={cn(
                        "flex items-center gap-3 px-3.5 py-3.5 transition-colors active:bg-muted/40",
                        idx > 0 && "border-t border-[#EEF1F5]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-full",
                          item.credit
                            ? "bg-[#22C55E]/15 text-[#16A34A]"
                            : "bg-[#2563EB]/12 text-[#2563EB]",
                        )}
                      >
                        {item.credit ? (
                          <ArrowDownToLine className="size-[18px]" strokeWidth={2.25} />
                        ) : (
                          <Redo2 className="size-[18px]" strokeWidth={2.25} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-[#0B2B4A]">
                          {item.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#8A94A6]">
                          {formatTxStamp(item.created_at)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "tabular shrink-0 text-right text-[13px] font-bold",
                          item.credit ? "text-[#16A34A]" : "text-[#0B2B4A]",
                        )}
                      >
                        {item.credit ? "+" : "−"} {formatRu(item.amount)}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-[#C0C7D1]" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </UserShell>
  );
}
