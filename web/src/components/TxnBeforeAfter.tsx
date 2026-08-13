import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function hasWalletBalance(value: string | null | undefined): value is string {
  return value != null && String(value).trim() !== "";
}

export function formatWalletRu(value: string | number) {
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "रु. —";
  return `रु. ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type TxnBeforeAfterProps = {
  before?: string | null;
  after?: string | null;
  className?: string;
};

export function TxnBeforeAfter({ before, after, className }: TxnBeforeAfterProps) {
  const { t } = useI18n();

  return (
    <span className={cn("grid grid-cols-2 gap-2", className)}>
      <span className="min-w-0 rounded-xl bg-[#F3F6FA] px-2.5 py-2">
        <span className="block text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("walletHistory.beforeBalance")}
        </span>
        <span className="mt-0.5 block truncate tabular text-[12px] font-bold text-[#0B2B4A]">
          {hasWalletBalance(before) ? formatWalletRu(before) : "रु. —"}
        </span>
      </span>
      <span className="min-w-0 rounded-xl bg-emerald-50 px-2.5 py-2">
        <span className="block text-[10px] font-semibold tracking-wide text-emerald-700/80 uppercase">
          {t("walletHistory.afterBalance")}
        </span>
        <span className="mt-0.5 block truncate tabular text-[12px] font-bold text-[#0B2B4A]">
          {hasWalletBalance(after) ? formatWalletRu(after) : "रु. —"}
        </span>
      </span>
    </span>
  );
}
