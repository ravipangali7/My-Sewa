import { BsDatePicker } from "@/components/BsDatePicker";
import { Label } from "@/components/ui/label";
import { useI18n, useT } from "@/lib/i18n";
import { formatAdIsoAsBs } from "@/lib/nepali-date";
import { cn } from "@/lib/utils";

type DateOfBirthFieldProps = {
  value: string;
  onChange: (adIso: string) => void;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Extra classes for the picker trigger button. */
  pickerClassName?: string;
  /** Optional helper text under the picker. */
  hint?: string;
};

/**
 * Shared user DOB control — Nepali (Bikram Sambat) picker, stores AD ISO (YYYY-MM-DD).
 * Matches remittance beneficiary DOB behavior (disableFuture + BS UI).
 */
export function DateOfBirthField({
  value,
  onChange,
  id = "date_of_birth",
  required = false,
  disabled = false,
  className,
  pickerClassName,
  hint,
}: DateOfBirthFieldProps) {
  const t = useT();

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{t("profile.dateOfBirth")}</Label>
      <BsDatePicker
        id={id}
        value={value}
        onChange={onChange}
        placeholder={t("profile.dateOfBirthPlaceholder")}
        disableFuture
        required={required}
        disabled={disabled}
        {...(pickerClassName ? { className: pickerClassName } : {})}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Read-only DOB shown in BS calendar format. */
export function DateOfBirthDisplay({
  value,
  className,
  emptyLabel,
}: {
  value: string | null | undefined;
  className?: string;
  emptyLabel?: string;
}) {
  const { locale } = useI18n();
  const t = useT();
  const label = formatAdIsoAsBs(value, locale, "long");

  return (
    <span className={className}>{label ?? emptyLabel ?? t("profile.dateOfBirthEmpty")}</span>
  );
}
