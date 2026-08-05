import { WifiOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type NoInternetScreenProps = {
  onRetry: () => void;
  isChecking?: boolean;
  className?: string;
};

/**
 * Full-screen offline gate matching the Flutter NoInternetScreen UX.
 */
export function NoInternetScreen({
  onRetry,
  isChecking = false,
  className,
}: NoInternetScreenProps) {
  const t = useT();

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "fixed inset-0 z-[200] flex min-h-dvh flex-col bg-background px-7 pt-[max(16px,var(--safe-area-top,env(safe-area-inset-top,0px)))] pb-[max(24px,var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))]",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center">
        <div className="flex flex-[2] items-end" aria-hidden />
        <div className="flex w-full flex-col items-center text-center">
          <div className="flex size-[88px] items-center justify-center rounded-full bg-brand/12">
            <WifiOff className="size-[42px] text-brand" strokeWidth={1.75} aria-hidden />
          </div>
          <h1 className="mt-7 text-[22px] font-bold tracking-tight text-foreground">
            {t("offline.title")}
          </h1>
          <p className="mt-3 text-[15px] leading-[1.45] text-muted-foreground">
            {t("offline.message")}
          </p>
          <Button
            type="button"
            disabled={isChecking}
            onClick={onRetry}
            className="mt-8 h-[52px] w-full rounded-[14px] bg-brand text-[16px] font-semibold text-white shadow-none hover:bg-brand-dark disabled:bg-brand/50 disabled:opacity-100 [&_svg]:size-[22px]"
          >
            {isChecking ? (
              <Loader2 className="animate-spin text-white" aria-hidden />
            ) : (
              t("offline.tryAgain")
            )}
          </Button>
        </div>
        <div className="flex flex-[3] flex-col items-center justify-end">
          <p className="text-[13px] font-semibold text-muted-foreground">
            <span className="text-ocean">My</span>
            <span className="text-brand">Sewa</span>
          </p>
        </div>
      </div>
    </div>
  );
}
