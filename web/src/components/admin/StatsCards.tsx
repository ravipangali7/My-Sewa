import type { LucideIcon } from "lucide-react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Coins,
  TrendingUp,
  Wallet,
} from "lucide-react";
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
};

const TONE_ICON: Record<StatCardTone, string> = {
  default: "text-brand/70",
  credit: "text-success",
  debit: "text-ocean",
  brand: "text-brand",
  info: "text-info",
  warning: "text-warning",
};

const TONE_VALUE: Record<StatCardTone, string> = {
  default: "text-label",
  credit: "text-success",
  debit: "text-ocean",
  brand: "text-brand-dark",
  info: "text-info",
  warning: "text-warning",
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
      ? "grid-cols-2"
      : items.length === 3
        ? "grid-cols-2 sm:grid-cols-3"
        : items.length === 4
          ? "grid-cols-2 lg:grid-cols-4"
          : items.length === 5
            ? "grid-cols-2 sm:gap-4 xl:grid-cols-5"
            : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6";

  return (
    <div className={cn("grid gap-3", cols, className)}>
      {items.map((card) => {
        const tone = card.tone ?? "default";
        const Icon = card.icon;
        const isUser = variant === "user";
        return (
          <div
            key={card.key}
            className={cn(
              "rounded-xl border border-border bg-surface",
              isUser ? "p-3" : "p-3.5 sm:p-4",
              items.length % 2 === 1 && card === items[items.length - 1]
                ? "last:col-span-2 xl:last:col-span-1"
                : null,
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p
                className={cn(
                  "text-muted-foreground",
                  isUser ? "text-[11px]" : "text-[11px] sm:text-xs",
                )}
              >
                {card.label}
              </p>
              {Icon ? (
                <Icon className={cn("size-4 shrink-0", TONE_ICON[tone])} aria-hidden />
              ) : null}
            </div>
            <p
              className={cn(
                "tabular mt-1 font-semibold tracking-tight",
                isUser ? "text-base" : "text-lg sm:mt-1.5 sm:text-xl",
                TONE_VALUE[tone],
              )}
            >
              {card.value}
            </p>
            {card.hint ? (
              <p className="mt-1 text-[11px] text-muted-foreground">{card.hint}</p>
            ) : null}
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
