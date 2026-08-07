import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BsDatePicker } from "@/components/BsDatePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth";
import { apiClient, ApiError } from "@/lib/api";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot Password — MySewa" },
      {
        name: "description",
        content:
          "Reset your MySewa account password using a verification code sent to your registered email.",
      },
      { property: "og:title", content: "Forgot Password — MySewa" },
    ],
  }),
  component: ForgotPasswordPage,
});

type ForgotStep = "request" | "verify_dob" | "reset";

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { token, user, isStaff, isLoading } = useAuth();
  const { logoUrl } = useSiteBranding();
  const t = useT();
  const [step, setStep] = useState<ForgotStep>("request");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [debugOtp, setDebugOtp] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);

  useEffect(() => {
    if (token && !isLoading && user) {
      navigate({ to: isStaff ? "/admin" : "/app" });
    }
  }, [token, isLoading, user, isStaff, navigate]);

  const title =
    step === "request"
      ? t("auth.forgotTitle")
      : step === "verify_dob"
        ? t("auth.verifyDobTitle")
        : t("auth.setNewPassword");

  const subtitle =
    step === "request"
      ? t("auth.sendCodeSubtitle")
      : step === "verify_dob"
        ? t("auth.verifyDobSubtitle")
        : t("auth.enterCode", { email: emailHint || "your email" });

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-hero-gradient p-12 lg:flex">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" className="size-11 rounded-2xl object-cover" />
          <span className="text-2xl font-bold text-primary-foreground">MySewa</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-4xl leading-tight font-bold text-primary-foreground">
            {t("auth.resetPassword")}
          </h2>
          <p className="mt-4 text-primary-foreground/80">{t("auth.resetBlurb")}</p>
        </div>
        <p className="text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} MySewa Pvt. Ltd. · Kathmandu, Nepal
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center lg:items-start">
            <img src={logoUrl} alt="MySewa" className="size-14 rounded-2xl object-cover lg:hidden" />
            <h1 className="mt-4 text-[34px] font-bold tracking-tight lg:mt-0">{title}</h1>
            <p className="mt-1 text-[15px] text-muted-foreground">{subtitle}</p>
          </div>

          {step === "request" ? (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setSubmitting(true);
                setDebugOtp(null);
                setEmailHint(null);
                try {
                  const res = await apiClient.forgotPassword(phone.trim());
                  if (res.debug_otp) setDebugOtp(res.debug_otp);
                  if (res.email_hint) setEmailHint(res.email_hint);
                  toast.success(t("auth.checkEmail"), { description: res.message });
                  setStep("verify_dob");
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : t("common.requestFailed"));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("auth.phone")}</Label>
                <Input
                  id="phone"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-12 rounded-xl"
                  placeholder="98XXXXXXXX"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={submitting}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                {submitting ? t("auth.sending") : t("auth.sendCode")}
              </Button>
            </form>
          ) : step === "verify_dob" ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!dateOfBirth) {
                  toast.error(t("auth.dobRequired"));
                  return;
                }
                setStep("reset");
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="date_of_birth">{t("auth.dateOfBirth")}</Label>
                <BsDatePicker
                  id="date_of_birth"
                  value={dateOfBirth}
                  onChange={setDateOfBirth}
                  placeholder={t("auth.dobPlaceholder")}
                  disableFuture
                  required
                  className="h-12"
                />
              </div>
              <Button type="submit" className="h-12 w-full rounded-xl text-[17px]">
                {t("auth.continueToReset")}
              </Button>
              <button
                type="button"
                className="w-full text-center text-[13px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setStep("request")}
              >
                {t("auth.useDifferentPhone")}
              </button>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!dateOfBirth) {
                  toast.error(t("auth.dobRequired"));
                  setStep("verify_dob");
                  return;
                }
                if (password !== password2) {
                  toast.error(t("auth.passwordsMismatch"));
                  return;
                }
                setSubmitting(true);
                try {
                  const res = await apiClient.resetPassword({
                    phone: phone.trim(),
                    otp: otp.trim(),
                    date_of_birth: dateOfBirth,
                    new_password: password,
                    confirm_password: password2,
                  });
                  toast.success(res.message);
                  navigate({ to: "/" });
                } catch (err) {
                  toast.error(err instanceof ApiError ? err.message : t("auth.resetFailed"));
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {debugOtp && (
                <p className="rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                  {t("auth.devCode")} <span className="font-semibold text-foreground">{debugOtp}</span>
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="otp">{t("auth.verificationCode")}</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="off"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="h-12 rounded-xl tracking-widest"
                  placeholder={t("auth.codePlaceholder")}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t("profile.newPassword")}</Label>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-xl"
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password2">{t("profile.confirmPassword")}</Label>
                <PasswordInput
                  id="password2"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className="h-12 rounded-xl"
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </div>
              <Button
                type="submit"
                disabled={submitting}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                {submitting ? t("common.saving") : t("auth.resetPassword")}
              </Button>
              <button
                type="button"
                className="w-full text-center text-[13px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setStep("verify_dob")}
              >
                {t("auth.backToDob")}
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            {t("auth.remembered")}{" "}
            <Link to="/" className="font-semibold text-foreground underline-offset-2 hover:underline">
              {t("auth.backToLogin")}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
