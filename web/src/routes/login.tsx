import { createFileRoute } from "@tanstack/react-router";
import { LoginView } from "@/components/auth/LoginView";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign In — MySewa Nepal" },
      {
        name: "description",
        content:
          "Sign in to your MySewa digital wallet to send bank transfers, recharge mobile, or pay utility bills.",
      },
      { property: "og:title", content: "Sign In — MySewa Nepal" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { logoUrl } = useSiteBranding();
  const t = useT();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-hero-gradient p-12 lg:flex">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" className="size-11 rounded-md object-cover" />
          <span className="text-2xl font-bold text-primary-foreground">MySewa</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-4xl leading-tight font-bold text-primary-foreground">
            {t("auth.tagline")}
          </h2>
          <p className="mt-4 text-primary-foreground/80">{t("auth.heroBlurb")}</p>
        </div>
        <p className="text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} MySewa Pvt. Ltd. · Kathmandu, Nepal
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-12 pt-[max(3rem,calc(3rem+var(--safe-area-top,env(safe-area-inset-top,0px))))] pb-[max(3rem,calc(3rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px))))] lg:py-12">
        <LoginView />
      </section>
    </div>
  );
}
