import { IdentityLockedBanner } from "@/components/IdentityLockedBanner";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Shown in the KYC document section when verified — hide replace/delete controls
 * and surface a clear lock message. Import from KYC upload routes (Tasks 13–14).
 */
export function KycDocumentsLockedNotice({ className }: { className?: string }) {
  const t = useT();

  return (
    <div className={cn("space-y-2", className)}>
      <IdentityLockedBanner />
      <p className="px-0.5 text-[13px] text-muted-foreground">{t("profile.kycDocumentsLocked")}</p>
    </div>
  );
}
