import type { LucideIcon } from "lucide-react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Coins,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { formatNPR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AmountSummary } from "@/lib/types";

export type StatCardTone = "default" | "credit" | "debit" | "brand" | "info" | "warning";

export type StatCardItem = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  tone?: StatCardTone;
  icon?: LucideIcon;
  /** When set, the card navigates like the wallet-balance → history pattern. */
  to?: string;
};

const TONE_ICON_WRAP: Record<StatCardTone, string> = {
  default: "bg-slate-50 text-slate-700 border-slate-200",
  credit: "bg-emerald-50 text-emerald-700 border-emerald-200",
  debit: "bg-blue-50 text-blue-700 border-blue-200",
  brand: "bg-emerald-50 text-emerald-800 border-emerald-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
};

const TONE_VALUE: Record<StatCardTone, string> = {
  default: "text-slate-900",
  credit: "text-emerald-600",
  debit: "text-blue-600",
  brand: "text-emerald-700",
  info: "text-sky-600",
  warning: "text-amber-600",
};

type StatsCardsProps = {
  items: StatCardItem[];
  className?: string;
  /** Compact layout for user-app surfaces */
  variant?: "admin" | "user";
};

export function StatsCards({ items, className, variant = "admin" }: StatsCardsProps) {
  if (!items.length) return null;

  const cols =
    items.length <= 2
      ? "grid-cols-1 sm:grid-cols-2"
      : items.length === 3
        ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
        : items.length === 4
          ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
          : items.length === 5
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
            : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6";

  return (
    <div className={cn("grid gap-3 sm:gap-4", cols, className)}>
      {items.map((card) => {
        const tone = card.tone ?? "default";
        const Icon = card.icon;
        const isUser = variant === "user";
        const clickable = Boolean(card.to);
        const body = (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "font-semibold tracking-wider text-slate-500 uppercase",
                  isUser ? "text-[10px]" : "text-[11px]",
                )}
              >
                {card.label}
              </p>
              <p
                className={cn(
                  "font-mono tabular-nums mt-1.5 font-bold tracking-tight",
                  isUser ? "text-lg" : "text-xl sm:text-2xl",
                  TONE_VALUE[tone],
                )}
              >
                {card.value}
              </p>
              {card.hint ? (
                <p className="mt-1 text-[11px] leading-snug text-slate-400">
                  {card.hint}
                </p>
              ) : null}
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              {Icon ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center justify-center rounded-sm border shadow-2xs",
                    isUser ? "size-8" : "size-9",
                    TONE_ICON_WRAP[tone],
                  )}
                >
                  <Icon className={cn(isUser ? "size-3.5" : "size-4")} aria-hidden />
                </span>
              ) : null}
              {clickable ? (
                <ChevronRight className="size-4 text-slate-400" aria-hidden />
              ) : null}
            </span>
          </div>
        );

        const classNameCard = cn(
          "group relative overflow-hidden rounded-md border border-slate-200/90 bg-white text-left shadow-2xs",
          "transition-all duration-150 hover:border-slate-300 hover:shadow-xs",
          isUser ? "p-3.5" : "p-4 sm:p-5",
          clickable && "cursor-pointer active:bg-slate-50",
        );

        return card.to ? (
          <Link
            key={card.key}
            to={card.to as "/admin/himalpay-history" | "/admin/commission-history"}
            className={classNameCard}
          >
            {body}
          </Link>
        ) : (
          <div key={card.key} className={classNameCard}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** User-app alias — same component, compact spacing */
export function UserStatsCards(props: Omit<StatsCardsProps, "variant">) {
  return <StatsCards {...props} variant="user" />;
}

type AmountCardOptions = {
  /** Which amount fields to show (order preserved) */
  keys?: Array<keyof AmountSummary>;
  labels?: Partial<Record<keyof AmountSummary, string>>;
  hints?: Partial<Record<keyof AmountSummary, string>>;
};

const DEFAULT_LABELS: Record<keyof AmountSummary, string> = {
  total_volume: "Total Volume",
  total_credit: "Total Credit",
  total_debit: "Total Debit",
  total_amount: "Total Amount",
  today_amount: "Today's Volume",
  monthly_amount: "Monthly Volume",
  system_income: "Platform Fees",
  system_payout: "Total Payouts",
};

const DEFAULT_ICONS: Partial<Record<keyof AmountSummary, LucideIcon>> = {
  total_volume: TrendingUp,
  total_credit: ArrowDownLeft,
  total_debit: ArrowUpRight,
  total_amount: Coins,
  today_amount: CalendarDays,
  monthly_amount: CalendarDays,
  system_income: ArrowDownLeft,
  system_payout: ArrowUpRight,
};

const DEFAULT_TONES: Partial<Record<keyof AmountSummary, StatCardTone>> = {
  total_volume: "brand",
  total_credit: "credit",
  total_debit: "debit",
  total_amount: "default",
  today_amount: "info",
  monthly_amount: "warning",
  system_income: "credit",
  system_payout: "debit",
};

/** Build StatCardItem[] from an AmountSummary payload */
export function amountSummaryCards(
  summary: AmountSummary | null | undefined,
  options: AmountCardOptions = {},
): StatCardItem[] {
  if (!summary) return [];
  const keys =
    options.keys ??
    (["total_volume", "total_amount", "today_amount", "monthly_amount"] as Array<
      keyof AmountSummary
    >);

  return keys
    .filter((key) => summary[key] !== undefined && summary[key] !== null)
    .map((key) => {
      const hint = options.hints?.[key];
      const item: StatCardItem = {
        key,
        label: options.labels?.[key] ?? DEFAULT_LABELS[key],
        value: formatNPR(summary[key] ?? 0),
        tone: DEFAULT_TONES[key] ?? "default",
        icon: DEFAULT_ICONS[key] ?? Wallet,
      };
      if (hint) item.hint = hint;
      return item;
    });
}
