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
  default: "text-slate-900",
  credit: "text-emerald-600",
  debit: "text-blue-600",
  brand: "text-emerald-700",
  info: "text-sky-600",
  warning: "text-amber-600",
};

const TONE_DOT: Record<StatCardTone, string> = {
  default: "bg-slate-400",
  credit: "bg-emerald-500",
  debit: "bg-blue-500",
  brand: "bg-emerald-600",
  info: "bg-sky-500",
  warning: "bg-amber-500",
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
        <span className={cn("size-1.5 shrink-0 rounded-xs", TONE_DOT[tone])} aria-hidden />
        {Icon ? <Icon className="size-3 shrink-0 text-slate-400" aria-hidden /> : null}
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {item.label}
        </p>
        {clickable ? (
          <ChevronRight className="ml-auto size-3 shrink-0 text-slate-400" aria-hidden />
        ) : null}
      </div>
      <p className={cn("font-mono tabular-nums mt-1 truncate text-[15px] font-bold tracking-tight", TONE_VALUE[tone])}>
        {item.value}
      </p>
      {item.hint ? (
        <p className="mt-0.5 truncate text-[10px] leading-tight text-slate-400">{item.hint}</p>
      ) : null}
    </>
  );

  const cellClass = cn(
    "-mb-px -mr-px border-b border-r border-slate-200/90 bg-white px-3.5 py-3 transition-colors",
    clickable && "hover:bg-slate-50 cursor-pointer",
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
        "overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xs",
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
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xs">
      <div className={cn("grid", gridCols(cells))}>
        {Array.from({ length: cells }, (_, i) => (
          <div key={i} className="-mb-px -mr-px border-b border-r border-slate-200/80 bg-white px-3.5 py-3">
            <div className="h-2.5 w-16 animate-pulse rounded-xs bg-slate-100" />
            <div className="mt-2 h-4 w-20 animate-pulse rounded-xs bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
