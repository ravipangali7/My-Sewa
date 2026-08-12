import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BankOption } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export function BankCombobox({
  banks,
  value,
  onChange,
  disabled,
  loading,
  placeholder,
}: {
  banks: BankOption[];
  value: string;
  onChange: (bankCode: string) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => banks.find((b) => b.bank_code === value),
    [banks, value],
  );
  const resolvedPlaceholder = placeholder ?? t("transfer.selectBank");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-auto min-h-12 w-full items-start justify-between gap-2 whitespace-normal rounded-xl px-3 py-2.5 font-normal"
        >
          <span
            className={cn(
              "min-w-0 flex-1 whitespace-normal break-words text-left leading-snug",
              !selected && "text-muted-foreground",
            )}
          >
            {loading
              ? t("transfer.loadingBanks")
              : selected
                ? `${selected.bank_name} (${selected.bank_code})`
                : resolvedPlaceholder}
          </span>
          <ChevronsUpDown className="mt-0.5 size-4 shrink-0 self-start opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) max-h-[70dvh] overflow-hidden p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder={t("transfer.searchBank")}
            className="sticky top-0 z-10 bg-popover"
          />
          <CommandList className="max-h-[52dvh] overscroll-contain [scrollbar-gutter:stable]">
            <CommandEmpty>{t("transfer.noBank")}</CommandEmpty>
            <CommandGroup>
              {banks.map((b) => (
                <CommandItem
                  key={b.bank_code}
                  value={`${b.bank_name} ${b.bank_code}`}
                  className="items-start py-2"
                  onSelect={() => {
                    onChange(b.bank_code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      value === b.bank_code ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 whitespace-normal break-words leading-snug">
                    {b.bank_name}{" "}
                    <span className="text-muted-foreground">({b.bank_code})</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
