import { cn } from "@/lib/utils";
import { STATUS_TONE, type StatusKey } from "@/constants/colors";
import { useT } from "@/lib/i18n";
import { translateStatus } from "@/lib/status";

const TONE_CLASS: Record<string, string> = {
  warning: "bg-warning/12 text-warning",
  success: "bg-success/14 text-success",
  danger: "bg-danger/12 text-danger",
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
        "inline-flex items-center gap-1.5 font-medium",
        !wasTranslated && "capitalize",
        compact
          ? "rounded-md px-2 py-0.5 text-xs"
          : "rounded-full px-2.5 py-1 text-[13px] leading-none",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
