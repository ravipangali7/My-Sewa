import { cn } from "@/lib/utils";
import type { DataPackOperator } from "@/lib/data-packs";

function NtcLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" className={className} aria-hidden>
      <circle cx="24" cy="14" r="10" fill="#D4AF37" />
      <circle cx="24" cy="14" r="6" fill="#FFF8E7" />
      <text
        x="24"
        y="30"
        textAnchor="middle"
        fill="#D4AF37"
        fontSize="7"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        NTC
      </text>
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
        isNtc ? "border border-[#C6E8D8] bg-white" : "bg-[#5C2483]",
        className,
      )}
    >
      {isNtc ? (
        <NtcLogo className="h-8 w-12" />
      ) : (
        <NcellLogo className="h-8 w-12" />
      )}
      {validity ? (
        <span
          className={cn(
            "mt-0.5 max-w-full truncate px-1 text-center text-[9px] font-bold uppercase leading-tight",
            isNtc ? "text-[#0A7A4B]" : "text-white/95",
          )}
        >
          {validity}
        </span>
      ) : null}
    </div>
  );
}
