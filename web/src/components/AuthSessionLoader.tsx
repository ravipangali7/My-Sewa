import { useSiteBranding } from "@/hooks/use-site-branding";
import { useT } from "@/lib/i18n";

/** Full-screen loader while restoring a stored session (avoids login form flash). */
export function AuthSessionLoader() {
  const { logoUrl } = useSiteBranding();
  const t = useT();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6">
      <img src={logoUrl} alt="MySewa" className="size-16 animate-pulse rounded-2xl object-cover" />
      <p className="text-sm text-muted-foreground">{t("auth.restoringSession")}</p>
    </div>
  );
}
