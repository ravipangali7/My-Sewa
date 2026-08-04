import { cn } from "@/lib/utils";
import type { DataPackOperator } from "@/lib/data-packs";

const NTC_LOGO = "/operators/ntc-logo.png";
const NCELL_LOGO = "/operators/ncell-logo.png";

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
        "flex size-[72px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-black shadow-sm",
        className,
      )}
    >
      <img
        src={isNtc ? NTC_LOGO : NCELL_LOGO}
        alt={isNtc ? "Nepal Telecom" : "Ncell"}
        className={cn(
          "object-contain",
          isNtc ? "size-11" : "h-8 w-[52px]",
          validity ? "" : "scale-110",
        )}
        loading="lazy"
        decoding="async"
      />
      {validity ? (
        <span className="mt-0.5 max-w-full truncate px-1 text-center text-[9px] font-bold uppercase leading-tight text-white/95">
          {validity}
        </span>
      ) : null}
    </div>
  );
}
