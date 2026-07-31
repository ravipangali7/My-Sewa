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

export function BankCombobox({
  banks,
  value,
  onChange,
  disabled,
  loading,
  placeholder = "Select bank",
}: {
  banks: BankOption[];
  value: string;
  onChange: (bankCode: string) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => banks.find((b) => b.bank_code === value),
    [banks, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-12 w-full justify-between rounded-xl px-3 font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {loading
              ? "Loading banks…"
              : selected
                ? `${selected.bank_name} (${selected.bank_code})`
                : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search bank…" />
          <CommandList>
            <CommandEmpty>No bank found.</CommandEmpty>
            <CommandGroup>
              {banks.map((b) => (
                <CommandItem
                  key={b.bank_code}
                  value={`${b.bank_name} ${b.bank_code}`}
                  onSelect={() => {
                    onChange(b.bank_code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === b.bank_code ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">
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
