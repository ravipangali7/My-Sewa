import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import {
  BS_MONTH_NAMES_EN,
  BS_MONTH_NAMES_NP,
  BS_WEEKDAYS_EN,
  BS_WEEKDAYS_NP,
  BS_YEAR_MAX,
  BS_YEAR_MIN,
  adIsoToBs,
  bsToAdIso,
  clampBsDay,
  formatBsDisplay,
  getBsMonthGrid,
  getBsYears,
  isSameBs,
  toNepaliDigits,
  todayBs,
  type BsParts,
} from "@/lib/nepali-date";
import { cn } from "@/lib/utils";

type BsDatePickerProps = {
  value: string;
  onChange: (adIso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  /** When true, dates after today (BS) cannot be selected. */
  disableFuture?: boolean;
  /** Optional earliest selectable BS year (inclusive). */
  minYear?: number;
  /** Optional latest selectable BS year (inclusive). */
  maxYear?: number;
};

export function BsDatePicker({
  value,
  onChange,
  placeholder,
  disabled,
  required,
  id,
  className,
  disableFuture = false,
  minYear = BS_YEAR_MIN,
  maxYear = BS_YEAR_MAX,
}: BsDatePickerProps) {
  const { locale, t } = useI18n();
  const isNe = locale === "ne";
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => (value ? adIsoToBs(value) : null), [value]);
  const today = useMemo(() => todayBs(), []);

  const yearFloor = Math.max(BS_YEAR_MIN, minYear);
  const yearCeil = Math.min(BS_YEAR_MAX, maxYear);

  const [view, setView] = useState<Pick<BsParts, "year" | "month">>(() => ({
    year: selected?.year ?? today.year,
    month: selected?.month ?? today.month,
  }));

  useEffect(() => {
    if (!open) return;
    setView({
      year: selected?.year ?? today.year,
      month: selected?.month ?? today.month,
    });
  }, [open, selected, today.month, today.year]);

  const years = useMemo(() => {
    return getBsYears().filter((y) => y >= yearFloor && y <= yearCeil);
  }, [yearCeil, yearFloor]);

  const monthNames = isNe ? BS_MONTH_NAMES_NP : BS_MONTH_NAMES_EN;
  const weekdays = isNe ? BS_WEEKDAYS_NP : BS_WEEKDAYS_EN;
  const grid = useMemo(
    () => getBsMonthGrid(view.year, view.month),
    [view.month, view.year],
  );

  const resolvedPlaceholder = placeholder ?? t("date.pickBs");

  const displayLabel = selected
    ? formatBsDisplay(selected, locale, "long")
    : resolvedPlaceholder;

  const adHint = selected && value ? value : null;

  const shiftMonth = (delta: number) => {
    let month = view.month + delta;
    let year = view.year;
    if (month < 0) {
      month = 11;
      year -= 1;
    } else if (month > 11) {
      month = 0;
      year += 1;
    }
    if (year < yearFloor || year > yearCeil) return;
    setView({ year, month });
  };

  const isDayDisabled = (day: number) => {
    if (disableFuture) {
      if (view.year > today.year) return true;
      if (view.year === today.year && view.month > today.month) return true;
      if (
        view.year === today.year &&
        view.month === today.month &&
        day > today.day
      ) {
        return true;
      }
    }
    return false;
  };

  const pickDay = (day: number) => {
    if (isDayDisabled(day)) return;
    const parts: BsParts = { year: view.year, month: view.month, day };
    const iso = bsToAdIso(parts);
    if (!iso) return;
    onChange(iso);
    setOpen(false);
  };

  const pickToday = () => {
    if (today.year < yearFloor || today.year > yearCeil) return;
    const iso = bsToAdIso(today);
    if (!iso) return;
    onChange(iso);
    setView({ year: today.year, month: today.month });
    setOpen(false);
  };

  const clear = () => {
    onChange("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-required={required}
          className={cn(
            "min-h-11 w-full justify-between rounded-xl px-3 py-1.5 font-normal shadow-sm",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
            <span className="truncate text-[14px] leading-tight">{displayLabel}</span>
            {adHint ? (
              <span className="truncate text-[11px] leading-none text-muted-foreground">
                {t("date.adHint", { date: adHint })}
              </span>
            ) : null}
          </span>
          <CalendarDays className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(100vw-2rem,20.5rem)] rounded-2xl border p-3 shadow-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest("[data-radix-select-content]")) {
            e.preventDefault();
          }
        }}
        onFocusOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest("[data-radix-select-content]")) {
            e.preventDefault();
          }
        }}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("date.bsCalendar")}
            </p>
            {value ? (
              <button
                type="button"
                onClick={clear}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
                {t("date.clear")}
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              onClick={() => shiftMonth(-1)}
              disabled={view.year === yearFloor && view.month === 0}
              aria-label={t("date.prevMonth")}
            >
              <ChevronLeft className="size-4" />
            </Button>

            <Select
              value={String(view.month)}
              onValueChange={(v) => {
                const month = Number(v);
                setView((prev) => ({
                  year: prev.year,
                  month,
                }));
              }}
            >
              <SelectTrigger className="h-8 flex-1 rounded-lg text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthNames.map((name, idx) => (
                  <SelectItem key={name} value={String(idx)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={String(view.year)}
              onValueChange={(v) => {
                const year = Number(v);
                setView((prev) => ({
                  year,
                  month: prev.month,
                }));
              }}
            >
              <SelectTrigger className="h-8 w-[5.5rem] rounded-lg text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {isNe ? toNepaliDigits(y) : y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              onClick={() => shiftMonth(1)}
              disabled={view.year === yearCeil && view.month === 11}
              aria-label={t("date.nextMonth")}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {weekdays.map((d) => (
              <div
                key={d}
                className="flex h-7 items-center justify-center text-[11px] font-medium text-muted-foreground"
              >
                {d}
              </div>
            ))}
            {grid.map((day, idx) => {
              if (day == null) {
                return <div key={`e-${idx}`} className="h-9" />;
              }
              const parts: BsParts = {
                year: view.year,
                month: view.month,
                day: clampBsDay(view.year, view.month, day),
              };
              const isSelected = isSameBs(parts, selected);
              const isToday = isSameBs(parts, today);
              const dayDisabled = isDayDisabled(day);

              return (
                <button
                  key={`${view.year}-${view.month}-${day}`}
                  type="button"
                  disabled={dayDisabled}
                  onClick={() => pickDay(day)}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-lg text-[13px] tabular-nums transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:pointer-events-none disabled:opacity-35",
                    isToday && !isSelected && "bg-brand-soft text-brand-dark font-medium",
                    isSelected &&
                      "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground font-semibold",
                  )}
                >
                  {isNe ? toNepaliDigits(day) : day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg px-2 text-[12px]"
              onClick={pickToday}
              disabled={today.year < yearFloor || today.year > yearCeil}
            >
              {t("date.today")}
            </Button>
            {selected ? (
              <p className="truncate text-[11px] text-muted-foreground">
                {formatBsDisplay(selected, locale, "short")}
                {adHint ? ` · AD ${adHint}` : ""}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">{t("date.selectDay")}</p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
