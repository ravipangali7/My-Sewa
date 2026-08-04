import type { ReactNode } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNPR } from "@/lib/format";
import type { ListQueryParams, ListStats } from "@/lib/types";
import { EMPTY_LIST_STATS } from "@/lib/list-query";
import { cn } from "@/lib/utils";

type StatusOption = { value: string; label: string };

export function ListStatsCards({
  stats = EMPTY_LIST_STATS,
  labels,
}: {
  stats?: ListStats;
  labels: {
    total: string;
    success: string;
    pending: string;
    failed: string;
  };
}) {
  const cards = [
    { label: labels.total, count: stats.total_count, amount: stats.total_amount, tone: "default" },
    { label: labels.success, count: stats.success_count, amount: stats.success_amount, tone: "success" },
    { label: labels.pending, count: stats.pending_count, amount: stats.pending_amount, tone: "warning" },
    { label: labels.failed, count: stats.failed_count, amount: stats.failed_amount, tone: "danger" },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="inset-group px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {card.label}
          </p>
          <p className="tabular mt-0.5 text-[18px] font-semibold">{card.count}</p>
          <p
            className={cn(
              "tabular text-[12px] font-medium",
              card.tone === "success" && "text-success",
              card.tone === "warning" && "text-warning",
              card.tone === "danger" && "text-destructive",
              card.tone === "default" && "text-muted-foreground",
            )}
          >
            {formatNPR(card.amount)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ListPageToolbar({
  stats,
  filters,
  onFiltersChange,
  onExport,
  exporting = false,
  searchPlaceholder,
  exportLabel,
  statsLabels,
  statusOptions,
  extra,
}: {
  stats?: ListStats;
  filters: ListQueryParams;
  onFiltersChange: (next: ListQueryParams) => void;
  onExport?: () => void;
  exporting?: boolean;
  searchPlaceholder: string;
  exportLabel: string;
  statsLabels: {
    total: string;
    success: string;
    pending: string;
    failed: string;
  };
  statusOptions?: StatusOption[];
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <ListStatsCards stats={stats} labels={statsLabels} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search ?? ""}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder={searchPlaceholder}
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <Input
          type="date"
          value={filters.date_from ?? ""}
          onChange={(e) => onFiltersChange({ ...filters, date_from: e.target.value })}
          className="h-10 w-full rounded-xl sm:w-[140px]"
          aria-label="From date"
        />
        <Input
          type="date"
          value={filters.date_to ?? ""}
          onChange={(e) => onFiltersChange({ ...filters, date_to: e.target.value })}
          className="h-10 w-full rounded-xl sm:w-[140px]"
          aria-label="To date"
        />
        {statusOptions?.length ? (
          <Select
            value={filters.status || "all"}
            onValueChange={(v) =>
              onFiltersChange({ ...filters, status: v === "all" ? undefined : v })
            }
          >
            <SelectTrigger className="h-10 w-full rounded-xl sm:w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {extra}
        {onExport ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl shrink-0"
            disabled={exporting}
            onClick={() => onExport()}
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {exportLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ReceiptDownloadLink({
  onClick,
  downloading,
  label,
}: {
  onClick: () => void;
  downloading?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={downloading}
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[12px] font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
    >
      {downloading ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Download className="size-3" />
      )}
      {label}
    </button>
  );
}

export function TransactionResultBanner({
  tone,
  title,
  body,
  receiptLabel,
  onDownloadReceipt,
  downloading,
}: {
  tone: "success" | "danger" | "warning";
  title: string;
  body?: string;
  receiptLabel: string;
  onDownloadReceipt: () => void;
  downloading?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "border-brand/20 bg-brand/5"
      : tone === "danger"
        ? "border-destructive/20 bg-destructive/5"
        : "border-warning/30 bg-warning/10";

  return (
    <section className={cn("inset-group p-4", toneClass)}>
      <p className="text-[15px] font-semibold">{title}</p>
      {body ? <p className="mt-1 text-[13px] text-muted-foreground">{body}</p> : null}
      <div className="mt-2">
        <ReceiptDownloadLink
          onClick={onDownloadReceipt}
          downloading={downloading}
          label={receiptLabel}
        />
      </div>
    </section>
  );
}
