import { BadgeCheck, Lock } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Banner shown on profile edit / KYC when identity fields are locked after verification. */
export function IdentityLockedBanner({ className }: { className?: string }) {
  const t = useT();

  return (
    <div
      role="status"
      className={cn(
        "flex gap-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-3.5 py-3 text-[13px] leading-snug text-[#1E3A8A]",
        className,
      )}
    >
      <Lock className="mt-0.5 size-4 shrink-0 text-[#2563EB]" strokeWidth={2.25} aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold text-[#1D4ED8]">{t("profile.identityLockedTitle")}</p>
        <p className="text-[#1E40AF]/90">{t("profile.identityLockedBody")}</p>
      </div>
    </div>
  );
}

/** Compact verified chip for profile header / settings rows. */
export function KycVerifiedBadge({ className }: { className?: string }) {
  const t = useT();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[12px] font-semibold text-[#15803D] ring-1 ring-[#86EFAC]/80",
        className,
      )}
    >
      <BadgeCheck className="size-3.5" strokeWidth={2.25} aria-hidden />
      {t("profile.kycVerified")}
    </span>
  );
}
