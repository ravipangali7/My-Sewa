import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Compact EN ↔ NE language toggle for the mobile home header. */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, toggleLocale, t } = useI18n();
  const nextIsEn = locale === "ne";

  return (
    <button
      type="button"
      onClick={toggleLocale}
      aria-label={nextIsEn ? t("lang.switchToEn") : t("lang.switchToNe")}
      title={nextIsEn ? t("lang.switchToEn") : t("lang.switchToNe")}
      className={cn(
        "relative mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full",
        "text-white transition-transform active:scale-95",
        "hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-[30px] items-center justify-center rounded-full border border-white/45 bg-white/15 text-[11px] font-bold tracking-wide shadow-sm backdrop-blur-sm"
      >
        {nextIsEn ? t("lang.en") : t("lang.ne")}
      </span>
    </button>
  );
}
