import { cn } from "@/lib/utils";
import type { DataPackOperator } from "@/lib/data-packs";

/** Stylized Nepal Telecom Namaste emblem (golden gesture on blue field). */
function NamasteLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="24" cy="24" r="23" fill="#1B4F8C" />
      <circle cx="24" cy="24" r="19" fill="#2563A8" />
      <path
        d="M24 8c-3.3 0-6 2.7-6 6v3.5c0 1.4.6 2.7 1.6 3.6l-4.6 4.6a5 5 0 0 0-1.4 3.5V30c0 3.3 2.7 6 6 6h8c3.3 0 6-2.7 6-6v-3.8a5 5 0 0 0-1.4-3.5l-4.6-4.6a5 5 0 0 0 1.6-3.6V14c0-3.3-2.7-6-6-6z"
        fill="#C9A227"
      />
      <path
        d="M17 19.5c0-2.2 1.8-4 4-4s4 1.8 4 4v5.5c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2V19.5z"
        fill="#F0D060"
      />
      <path
        d="M23 19.5c0-2.2 1.8-4 4-4s4 1.8 4 4v5.5c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2V19.5z"
        fill="#F0D060"
      />
      <path
        d="M20 28.5c1.2 1.8 2.6 2.7 4 2.7s2.8-.9 4-2.7"
        stroke="#B8860B"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="24" cy="33.5" r="1.3" fill="#D4AF37" />
      <path
        d="M22.5 36c0 1.2.7 2 1.5 2s1.5-.8 1.5-2"
        stroke="#D4AF37"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NcellLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" className={className} aria-hidden>
      <polygon points="14,8 22,16 14,24" fill="#F7941D" />
      <polygon points="34,8 26,16 34,24" fill="#F7941D" />
      <rect x="20" y="12" width="8" height="8" fill="#E91E8C" opacity="0.9" />
    </svg>
  );
}

export function OperatorPackBadge({
  operator,
  validity,
  className,
}: {
  operator: DataPackOperator;
  validity: string;
  className?: string;
}) {
  const isNtc = operator === "NTC";

  return (
    <div
      className={cn(
        "flex size-[72px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg shadow-sm",
        isNtc ? "border border-brand/20 bg-white" : "bg-[#5C2483]",
        className,
      )}
    >
      {isNtc ? (
        <NamasteLogo className="size-11" />
      ) : (
        <NcellLogo className="h-8 w-12" />
      )}
      {validity ? (
        <span
          className={cn(
            "mt-0.5 max-w-full truncate px-1 text-center text-[9px] font-bold uppercase leading-tight",
            isNtc ? "text-brand-dark" : "text-white/95",
          )}
        >
          {validity}
        </span>
      ) : null}
    </div>
  );
}
