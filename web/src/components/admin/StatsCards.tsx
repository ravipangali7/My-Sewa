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
  default: "bg-brand-soft/80 text-brand",
  credit: "bg-success/12 text-success",
  debit: "bg-ocean/10 text-ocean",
  brand: "bg-brand-soft text-brand-dark",
  info: "bg-info/12 text-info",
  warning: "bg-warning/12 text-warning",
};

const TONE_VALUE: Record<StatCardTone, string> = {
  default: "text-label",
  credit: "text-success",
  debit: "text-ocean",
  brand: "text-brand-dark",
  info: "text-info",
  warning: "text-warning",
};

const TONE_ACCENT: Record<StatCardTone, string> = {
  default: "from-brand/15 via-transparent to-transparent",
  credit: "from-success/15 via-transparent to-transparent",
  debit: "from-ocean/15 via-transparent to-transparent",
  brand: "from-brand/20 via-transparent to-transparent",
  info: "from-info/15 via-transparent to-transparent",
  warning: "from-warning/15 via-transparent to-transparent",
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
          <>
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90",
                TONE_ACCENT[tone],
              )}
            />
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "font-medium tracking-wide text-muted-foreground uppercase",
                    isUser ? "text-[10px]" : "text-[10px] sm:text-[11px]",
                  )}
                >
                  {card.label}
                </p>
                <p
                  className={cn(
                    "tabular mt-2 font-bold tracking-tight",
                    isUser ? "text-lg" : "text-xl sm:text-2xl",
                    TONE_VALUE[tone],
                  )}
                >
                  {card.value}
                </p>
                {card.hint ? (
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    {card.hint}
                  </p>
                ) : null}
              </div>
              <span className="flex shrink-0 items-center gap-1">
                {Icon ? (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center rounded-xl",
                      "ring-1 ring-inset ring-black/5",
                      isUser ? "size-9" : "size-10 sm:size-11",
                      TONE_ICON_WRAP[tone],
                    )}
                  >
                    <Icon className={cn(isUser ? "size-4" : "size-5")} aria-hidden />
                  </span>
                ) : null}
                {clickable ? (
                  <ChevronRight className="size-4 text-muted-foreground/70" aria-hidden />
                ) : null}
              </span>
            </div>
          </>
        );
        const classNameCard = cn(
          "group relative overflow-hidden rounded-2xl border border-border/80 bg-surface text-left",
          "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]",
          "transition-[box-shadow,transform,border-color] duration-200",
          "hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_16px_32px_-14px_rgba(10,122,75,0.22)]",
          isUser ? "p-3.5" : "p-4 sm:p-5",
          clickable && "cursor-pointer",
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
  total_volume: "Total transaction volume",
  total_credit: "Total credit",
  total_debit: "Total debit",
  total_amount: "Total amount",
  today_amount: "Today's amount",
  monthly_amount: "Monthly amount",
};

const DEFAULT_ICONS: Partial<Record<keyof AmountSummary, LucideIcon>> = {
  total_volume: TrendingUp,
  total_credit: ArrowDownLeft,
  total_debit: ArrowUpRight,
  total_amount: Coins,
  today_amount: CalendarDays,
  monthly_amount: CalendarDays,
};

const DEFAULT_TONES: Partial<Record<keyof AmountSummary, StatCardTone>> = {
  total_volume: "brand",
  total_credit: "credit",
  total_debit: "debit",
  total_amount: "default",
  today_amount: "info",
  monthly_amount: "warning",
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
