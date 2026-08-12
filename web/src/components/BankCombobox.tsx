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

/** Word-based relevance score (higher = better). 0 hides the item. */
function bankSearchScore(value: string, search: string): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;

  const haystack = value.toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;

  // Every token must appear as a contiguous substring (not character-fuzzy).
  if (!tokens.every((token) => haystack.includes(token))) return 0;

  let score = 0;

  // Full phrase match (ignoring extra spaces in the item text)
  const compactHaystack = haystack.replace(/\s+/g, " ");
  if (compactHaystack.includes(query)) score += 80;
  if (compactHaystack.startsWith(query)) score += 40;

  for (const token of tokens) {
    if (haystack.startsWith(token)) score += 30;
    else if (haystack.includes(` ${token}`)) score += 20;
    else score += 8;

    // Prefer token at a word boundary over mid-word noise
    const wordBoundary = new RegExp(`(?:^|\\s)${escapeRegExp(token)}`);
    if (wordBoundary.test(haystack)) score += 12;
  }

  // Prefer shorter / more specific names when scores are close
  score += Math.max(0, 40 - haystack.length / 8);

  return score;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
        <Command filter={bankSearchScore}>
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
