import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AuthSessionLoader } from "@/components/AuthSessionLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth, type LoginOtpChallenge } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useOtpCountdown } from "@/hooks/use-otp-countdown";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MySewa — Nepal Digital Wallet, Remittance & Top-Up" },
      {
        name: "description",
        content:
          "MySewa is a Nepal digital wallet: load remittance into your wallet, send bank transfers and recharge NTC or NCELL in seconds.",
      },
      { property: "og:title", content: "MySewa — Nepal Digital Wallet, Remittance & Top-Up" },
      {
        property: "og:description",
        content:
          "MySewa is a Nepal digital wallet: load remittance into your wallet, send bank transfers and recharge NTC or NCELL in seconds.",
      },
    ],
  }),
  component: LoginPage,
});

function isEmailIdentifier(value: string) {
  return value.trim().includes("@");
}

function isPhoneLoginChallenge(challenge: LoginOtpChallenge) {
  return (
    challenge.login_via === "phone" ||
    challenge.preferred_channel === "sms" ||
    (challenge.channels.includes("sms") && !challenge.channels.includes("email"))
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const { beginLogin, verifyLoginOtp, resendLoginOtp, token, user, isStaff, isLoading } =
    useAuth();
  const { logoUrl } = useSiteBranding();
  const t = useT();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(null);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const { expired: otpExpired, formatted: otpCountdown } = useOtpCountdown(otpExpiresAt);
  const { secondsLeft: resendWaitSeconds } = useOtpCountdown(resendAvailableAt);

  const destinationHint = useMemo(() => {
    if (!challenge) return "";
    if (isPhoneLoginChallenge(challenge)) {
      const parts = [challenge.phone_hint, challenge.email_hint].filter(Boolean);
      return parts.join(" · ") || t("auth.yourPhone");
    }
    if (challenge.login_via === "email" || challenge.preferred_channel === "email") {
      return challenge.email_hint || t("auth.yourEmail");
    }
    const parts = [challenge.email_hint, challenge.phone_hint].filter(Boolean);
    return parts.join(" · ") || t("auth.registeredContacts");
  }, [challenge, t]);

  useEffect(() => {
    if (token && !isLoading && user) {
      navigate({ to: isStaff ? "/admin" : "/app" });
    }
  }, [token, isLoading, user, isStaff, navigate]);

  // Stored token: show loader until profile resolves and redirect, never flash login form.
  if (token && (isLoading || user)) {
    return <AuthSessionLoader />;
  }

  const notifyOtpSent = (next: LoginOtpChallenge, options?: { resent?: boolean }) => {
    const title = options?.resent ? t("auth.otpResent") : t("auth.otpSent");
    if (isPhoneLoginChallenge(next)) {
      // Phone login: never show the verification code in the UI — toast only.
      toast.success(title, {
        description:
          next.message ||
          t("auth.otpSentToPhone", {
            phone: next.phone_hint || t("auth.yourPhone"),
          }),
      });
      return;
    }
    toast.success(title, {
      description:
        next.message ||
        t("auth.otpSentToEmail", {
          email: next.email_hint || t("auth.yourEmail"),
        }),
    });
  };

  const applyChallenge = (next: LoginOtpChallenge) => {
    const now = Date.now();
    setChallenge(next);
    setOtp("");
    setOtpExpiresAt(now + next.expires_in * 1000);
    // Match backend 30s resend throttle
    setResendAvailableAt(now + 30_000);
  };

  const resetToCredentials = () => {
    setChallenge(null);
    setOtp("");
    setOtpExpiresAt(null);
    setResendAvailableAt(null);
  };

  const canResend = otpExpired || resendWaitSeconds <= 0;
  const identifierLooksLikeEmail = isEmailIdentifier(identifier);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-hero-gradient p-12 lg:flex">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" className="size-11 rounded-2xl object-cover" />
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

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center lg:items-start">
            <img src={logoUrl} alt="MySewa" className="size-14 rounded-2xl object-cover lg:hidden" />
            <h1 className="mt-4 text-[34px] font-bold tracking-tight lg:mt-0">
              {challenge ? t("auth.verifyLoginTitle") : t("auth.welcomeBack")}
            </h1>
            <p className="mt-1 text-[15px] text-muted-foreground">
              {challenge
                ? t("auth.verifyLoginSubtitle", { destination: destinationHint })
                : t("auth.signInWithEmailOrPhone")}
            </p>
          </div>

          {!challenge ? (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const trimmed = identifier.trim();
                if (!trimmed) {
                  toast.error(t("auth.identifierRequired"));
                  return;
                }
                setSubmitting(true);
                try {
                  const result = await beginLogin(trimmed, password);
                  if (result.status === "authenticated") {
                    const staff =
                      result.user.is_staff || result.user.is_superuser;
                    toast.success(t("auth.loginSuccess"));
                    navigate({ to: staff ? "/admin" : "/app" });
                    return;
                  }
                  applyChallenge(result.challenge);
                  notifyOtpSent(result.challenge, { resent: false });
                } catch (err) {
                  const msg = err instanceof ApiError ? err.message : t("auth.loginFailed");
                  toast.error(msg);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="identifier">{t("auth.emailOrPhone")}</Label>
                <Input
                  id="identifier"
                  type={identifierLooksLikeEmail ? "email" : "text"}
                  inputMode={identifierLooksLikeEmail ? "email" : "tel"}
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="h-12 rounded-xl"
                  placeholder={t("auth.emailOrPhonePlaceholder")}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password">{t("auth.password")}</Label>
                  <Link
                    to="/forgot-password"
                    className="text-[13px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {t("auth.forgotPassword")}
                  </Link>
                </div>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-xl"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={submitting}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                {submitting ? t("auth.signingIn") : t("auth.continue")}
              </Button>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (otp.length !== 6) {
                  toast.error(t("auth.otpIncomplete"));
                  return;
                }
                setSubmitting(true);
                try {
                  const profile = await verifyLoginOtp(challenge.challenge_id, otp);
                  const staff = profile.is_staff || profile.is_superuser;
                  toast.success(t("auth.loginSuccess"));
                  navigate({ to: staff ? "/admin" : "/app" });
                } catch (err) {
                  const msg = err instanceof ApiError ? err.message : t("auth.otpFailed");
                  toast.error(msg);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="login_otp">{t("auth.verificationCode")}</Label>
                <div className="flex justify-center">
                  <InputOTP
                    id="login_otp"
                    maxLength={6}
                    value={otp}
                    onChange={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                    autoFocus
                    inputMode="numeric"
                    pattern="[0-9]*"
                    containerClassName="justify-center"
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <InputOTPSlot
                          key={i}
                          index={i}
                          className="size-11 text-[17px] font-semibold first:rounded-l-xl last:rounded-r-xl"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <p className="text-center text-[13px] text-muted-foreground">
                  {otpExpired
                    ? t("auth.otpExpired")
                    : t("auth.otpExpiresIn", { time: otpCountdown })}
                </p>
              </div>

              <Button
                type="submit"
                disabled={submitting || otp.length !== 6}
                className="h-12 w-full rounded-xl text-[17px]"
              >
                {submitting ? t("auth.verifying") : t("auth.verifyAndLogIn")}
              </Button>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={resending || !canResend}
                  className="w-full text-center text-[13px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={async () => {
                    setResending(true);
                    try {
                      const next = await resendLoginOtp(challenge.challenge_id);
                      applyChallenge(next);
                      notifyOtpSent(next, { resent: true });
                    } catch (err) {
                      toast.error(
                        err instanceof ApiError ? err.message : t("common.requestFailed"),
                      );
                    } finally {
                      setResending(false);
                    }
                  }}
                >
                  {resending
                    ? t("auth.sending")
                    : canResend
                      ? t("auth.resendCode")
                      : t("auth.resendIn", { time: `${resendWaitSeconds}s` })}
                </button>
                <button
                  type="button"
                  className="w-full text-center text-[13px] font-medium text-muted-foreground hover:text-foreground"
                  onClick={resetToCredentials}
                >
                  {t("auth.backToCredentials")}
                </button>
              </div>
            </form>
          )}

          {!challenge && (
            <p className="mt-6 text-center text-[13px] text-muted-foreground">
              {t("auth.newTo")}{" "}
              <Link
                to="/register"
                className="font-semibold text-foreground underline-offset-2 hover:underline"
              >
                {t("auth.createAccount")}
              </Link>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
