import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type { StatCardTone } from "@/components/admin/StatsCards";

export type MetricStripItem = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  tone?: StatCardTone;
  icon?: LucideIcon;
  to?: string;
};

const TONE_VALUE: Record<StatCardTone, string> = {
  default: "text-label",
  credit: "text-success",
  debit: "text-ocean",
  brand: "text-brand-dark",
  info: "text-info",
  warning: "text-warning",
};

const TONE_DOT: Record<StatCardTone, string> = {
  default: "bg-brand",
  credit: "bg-success",
  debit: "bg-ocean",
  brand: "bg-brand",
  info: "bg-info",
  warning: "bg-warning",
};

type AdminMetricStripProps = {
  items: MetricStripItem[];
  className?: string;
};

function gridCols(count: number) {
  if (count <= 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-2 sm:grid-cols-3";
  if (count === 4) return "grid-cols-2 sm:grid-cols-4";
  if (count === 5) return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5";
  if (count === 6) return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7";
}

function MetricCell({ item }: { item: MetricStripItem }) {
  const tone = item.tone ?? "default";
  const Icon = item.icon;
  const clickable = Boolean(item.to);

  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden />
        {Icon ? <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {item.label}
        </p>
        {clickable ? (
          <ChevronRight className="ml-auto size-3 shrink-0 text-muted-foreground/60" aria-hidden />
        ) : null}
      </div>
      <p className={cn("tabular mt-1 truncate text-[15px] font-semibold tracking-tight", TONE_VALUE[tone])}>
        {item.value}
      </p>
      {item.hint ? (
        <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">{item.hint}</p>
      ) : null}
    </>
  );

  const cellClass = cn(
    "-mb-px -mr-px border-b border-r border-border/80 px-3 py-2.5",
    clickable && "transition-colors hover:bg-muted/50",
  );

  if (item.to) {
    return (
      <Link to={item.to as "/admin"} className={cn(cellClass, "block no-underline")}>
        {body}
      </Link>
    );
  }

  return <div className={cellClass}>{body}</div>;
}

export function AdminMetricStrip({ items, className }: AdminMetricStripProps) {
  if (!items.length) return null;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-surface",
        className,
      )}
    >
      <div className={cn("grid", gridCols(items.length))}>
        {items.map((item) => (
          <MetricCell key={item.key} item={item} />
        ))}
      </div>
    </div>
  );
}

export function AdminMetricStripSkeleton({ cells = 7 }: { cells?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className={cn("grid", gridCols(cells))}>
        {Array.from({ length: cells }, (_, i) => (
          <div key={i} className="-mb-px -mr-px border-b border-r border-border/80 px-3 py-2.5">
            <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-4 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
