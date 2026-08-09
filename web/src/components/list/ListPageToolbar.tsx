import { Loader2, Search } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ListFilters, StatusOption } from "@/hooks/use-list-filters";

type Stats = {
  total?: number;
  success?: number;
  pending?: number;
  failed?: number;
};

type StatsLabels = {
  total: string;
  success: string;
  pending: string;
  failed: string;
};

type ToolbarProps = {
  stats?: Stats | undefined;
  filters: ListFilters;
  onFiltersChange: (next: Partial<ListFilters>) => void;
  onExport?: (() => void | Promise<void>) | undefined;
  exporting?: boolean | undefined;
  searchPlaceholder?: string | undefined;
  exportLabel?: string | undefined;
  statsLabels?: StatsLabels | undefined;
  statusOptions?: StatusOption[] | undefined;
  statusPlaceholder?: string | undefined;
  startDatePlaceholder?: string | undefined;
  endDatePlaceholder?: string | undefined;
};

const DEFAULT_LABELS: StatsLabels = {
  total: "Total",
  success: "Success",
  pending: "Pending",
  failed: "Failed",
};

function NumberPill({ label, value }: { label: string; value?: number | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-muted/35 px-2.5 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className="font-semibold">{value ?? 0}</span>
    </div>
  );
}

function DateFilterInput({
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  className,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  "aria-label": string;
  className?: string | undefined;
}) {
  const empty = !value;
  return (
    <div className={cn("relative w-full sm:w-[160px]", className)}>
      <Input
        type="date"
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        title={placeholder}
        placeholder={placeholder}
        className={cn(
          "w-full",
          empty &&
            "text-transparent [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-datetime-edit]:text-transparent",
        )}
      />
      {empty ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {placeholder}
        </span>
      ) : null}
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
  exportLabel = "Export CSV",
  statsLabels = DEFAULT_LABELS,
  statusOptions = [],
  statusPlaceholder,
  startDatePlaceholder,
  endDatePlaceholder,
}: ToolbarProps) {
  const t = useT();
  const resolvedSearchPlaceholder = searchPlaceholder ?? t("common.search");
  const resolvedStatusPlaceholder = statusPlaceholder ?? t("list.allStatuses");
  const resolvedStartDatePlaceholder = startDatePlaceholder ?? t("list.startDate");
  const resolvedEndDatePlaceholder = endDatePlaceholder ?? t("list.endDate");
  const statusIdle = filters.status === "all";

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 basis-full lg:basis-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.q}
            onChange={(e) => onFiltersChange({ q: e.target.value })}
            placeholder={resolvedSearchPlaceholder}
            className="pl-9"
          />
        </div>
        <select
          value={filters.status}
          onChange={(e) => onFiltersChange({ status: e.target.value as ListFilters["status"] })}
          className={cn(
            "h-10 w-full shrink-0 rounded-md border border-input bg-background px-3 text-sm sm:w-auto",
            statusIdle && "text-muted-foreground",
          )}
          aria-label={t("list.status")}
          title={resolvedStatusPlaceholder}
        >
          {statusOptions.map((option) => (
            <option
              key={option.value}
              value={option.value}
              className="text-foreground"
            >
              {option.value === "all" ? resolvedStatusPlaceholder : option.label}
            </option>
          ))}
        </select>
        <DateFilterInput
          value={filters.startDate}
          onChange={(e) => onFiltersChange({ startDate: e.target.value })}
          placeholder={resolvedStartDatePlaceholder}
          aria-label={resolvedStartDatePlaceholder}
        />
        <DateFilterInput
          value={filters.endDate}
          onChange={(e) => onFiltersChange({ endDate: e.target.value })}
          placeholder={resolvedEndDatePlaceholder}
          aria-label={resolvedEndDatePlaceholder}
        />
        {onExport ? (
          <Button
            type="button"
            variant="outline"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => void onExport()}
            disabled={exporting}
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : null}
            {exportLabel}
          </Button>
        ) : null}
      </div>
      {stats ? (
        <div className="flex flex-wrap gap-2">
          <NumberPill label={statsLabels.total} value={stats.total} />
          <NumberPill label={statsLabels.success} value={stats.success} />
          <NumberPill label={statsLabels.pending} value={stats.pending} />
          <NumberPill label={statsLabels.failed} value={stats.failed} />
        </div>
      ) : null}
    </div>
  );
}

export function ReceiptDownloadLink({
  label,
  downloading,
  onClick,
}: {
  label: string;
  downloading?: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={downloading}
      className="text-xs font-medium text-brand underline-offset-2 hover:underline disabled:opacity-60"
    >
      {downloading ? "Downloading..." : label}
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
  tone: "success" | "warning" | "danger";
  title: string;
  body?: string | undefined;
  receiptLabel?: string | undefined;
  onDownloadReceipt?: (() => void) | undefined;
  downloading?: boolean | undefined;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "success" && "border-green-200 bg-green-50 text-green-900",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "danger" && "border-red-200 bg-red-50 text-red-900",
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      {body ? <p className="mt-1 text-xs opacity-90">{body}</p> : null}
      {onDownloadReceipt && receiptLabel ? (
        <div className="mt-2">
          <ReceiptDownloadLink
            label={receiptLabel}
            downloading={downloading}
            onClick={onDownloadReceipt}
          />
        </div>
      ) : null}
    </div>
  );
}

export type { ToolbarProps as ListPageToolbarProps, Stats as ListToolbarStats, ReactNode };
