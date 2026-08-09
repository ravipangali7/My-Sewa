import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type CopyableFieldProps = {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
};

export function CopyableField({ label, value, mono = true, className }: CopyableFieldProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const canCopy = Boolean(value && value !== "—");

  async function handleCopy() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(t("common.copied"));
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }

  return (
    <div className={cn("flex min-w-0 items-start justify-between gap-3", className)}>
      <dt className="shrink-0 pt-0.5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {canCopy ? (
          <div className="flex min-w-0 items-start justify-end gap-2">
            <span
              className={cn(
                "min-w-0 break-all text-right text-[14px] font-medium leading-snug",
                mono && "font-mono tabular",
              )}
              title={value}
            >
              {value}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label={copied ? t("common.copied") : t("common.copy")}
              title={copied ? t("common.copied") : t("common.copy")}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </div>
        ) : (
          <span className="break-all text-right font-medium">—</span>
        )}
      </dd>
    </div>
  );
}
