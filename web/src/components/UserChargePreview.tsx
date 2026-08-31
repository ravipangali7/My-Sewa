import { formatNPR } from "@/lib/format";
import { userFacingChargeExtra } from "@/lib/user-charge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Amount + one combined service charge + total. Internal splits stay off-screen. */
export function UserChargePreview({
  amount,
  charge,
  cashback,
  totalDebited,
  chargeLabel,
  loading = false,
  insufficient = false,
  insufficientText,
  className,
  separatorClassName,
}: {
  amount: number;
  charge: string;
  cashback: string;
  totalDebited: string;
  chargeLabel: string;
  loading?: boolean;
  insufficient?: boolean;
  insufficientText?: string;
  className?: string;
  separatorClassName?: string;
}) {
  const { t } = useI18n();
  const extra = userFacingChargeExtra({
    amount,
    charge,
    cashback,
    totalDebited,
  });
  return (
    <div className={cn("rounded-xl bg-muted p-3 text-[14px]", className)}>
      <PreviewRow label={t("common.amount")} value={formatNPR(amount)} />
      {extra > 0 ? (
        <PreviewRow label={chargeLabel} value={loading ? "…" : formatNPR(extra)} />
      ) : null}
      <div className={cn("mt-2 border-t border-separator pt-2", separatorClassName)}>
        <PreviewRow
          label={t("common.totalDebited")}
          value={loading ? "…" : formatNPR(totalDebited || amount)}
          strong
        />
      </div>
      {insufficient && insufficientText ? (
        <p className="mt-2 text-[12px] font-medium text-destructive" role="alert">
          {insufficientText}
        </p>
      ) : null}
    </div>
  );
}

function PreviewRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular", strong ? "font-semibold" : "font-medium")}>{value}</span>
    </div>
  );
}
