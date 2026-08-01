import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNPR } from "@/lib/format";
import type { AdminWallet } from "@/lib/types";

type WalletCardProps = {
  balance: string | number;
  title?: string;
  subtitle?: string;
  chip?: string;
  className?: string;
  size?: "sm" | "lg";
  footer?: ReactNode;
};

export function WalletCard({
  balance,
  title = "Available balance",
  subtitle,
  chip = "NPR",
  className,
  size = "sm",
  footer,
}: WalletCardProps) {
  const large = size === "lg";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-hero-gradient text-primary-foreground shadow-card",
        large ? "p-6 lg:p-8" : "p-5",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 size-36 rounded-full bg-white/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-12 -left-6 size-40 rounded-full bg-brand-accent/20"
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">
              <Wallet className="size-4" />
            </span>
            <p className="text-[13px] text-primary-foreground/75">{title}</p>
          </div>
          <p
            className={cn(
              "tabular mt-2 font-bold leading-none tracking-tight break-all",
              large ? "text-[32px] sm:text-[40px] lg:text-[48px]" : "text-[28px]",
            )}
          >
            {formatNPR(balance)}
          </p>
          {subtitle ? (
            <p className="mt-2 truncate text-[13px] text-primary-foreground/70">{subtitle}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-brand-accent/90 px-3 py-1 text-xs font-medium">
          {chip}
        </span>
      </div>

      {footer ? <div className="relative mt-4 border-t border-white/15 pt-3">{footer}</div> : null}
    </div>
  );
}

export function walletDisplayName(w: Pick<AdminWallet, "first_name" | "last_name" | "phone">) {
  return [w.first_name, w.last_name].filter(Boolean).join(" ") || w.phone;
}
