import { cn } from "@/lib/utils";
import { STATUS_TONE, type StatusKey } from "@/constants/colors";
import { useT } from "@/lib/i18n";
import { translateStatus } from "@/lib/status";

const TONE_CLASS: Record<string, string> = {
  warning: "bg-amber-50 text-amber-800 border-amber-200/80",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200/80",
  danger: "bg-rose-50 text-rose-800 border-rose-200/80",
};

const DOT_CLASS: Record<string, string> = {
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  danger: "bg-rose-500",
};

export function StatusChip({
  status,
  compact = false,
  className,
}: {
  status: string;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const key = status.toLowerCase();
  const tone = STATUS_TONE[key as StatusKey] ?? "warning";
  const label = translateStatus(status, t);
  const wasTranslated = label !== status;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold border shadow-2xs rounded-sm",
        !wasTranslated && "capitalize",
        compact
          ? "px-1.5 py-0.5 text-[11px] leading-tight"
          : "px-2 py-0.5 text-xs leading-normal",
        TONE_CLASS[tone] || "bg-slate-50 text-slate-700 border-slate-200",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-xs shrink-0", DOT_CLASS[tone] || "bg-slate-400")} aria-hidden />
      {label}
    </span>
  );
}
