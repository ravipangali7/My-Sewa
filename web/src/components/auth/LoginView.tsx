import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AuthSessionLoader } from "@/components/AuthSessionLoader";
import { BiometricFingerprintButton } from "@/components/BiometricFingerprintButton";
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
import { homePathForUser } from "@/lib/auth-destination";
import { ApiError } from "@/lib/api";
import {
  biometricErrorMessage,
  getBiometricCapability,
  isFlutterWebView,
  requestBiometric,
} from "@/lib/biometric";
import { useSiteBranding } from "@/hooks/use-site-branding";
import { useOtpCountdown } from "@/hooks/use-otp-countdown";
import { useT } from "@/lib/i18n";
import { SavedAccountsView } from "@/components/SavedAccountsView";
import { useSavedAccounts } from "@/lib/saved-accounts";
import { ArrowLeft } from "lucide-react";

function isPhoneLoginChallenge(challenge: LoginOtpChallenge) {
  return (
    challenge.channels.includes("sms") && !challenge.channels.includes("email")
  );
}

function otpDeliveredViaEmail(challenge: LoginOtpChallenge) {
  return challenge.channels.includes("email") || Boolean(challenge.email_hint);
}

export interface LoginViewProps {
  onSuccess?: () => void;
  compact?: boolean;
}

export function LoginView({ onSuccess, compact = false }: LoginViewProps) {
  const navigate = useNavigate();
  const { beginLogin, verifyLoginOtp, resendLoginOtp, token, user, isLoading, hydrateSessionFromStorage } =
    useAuth();
  const { logoUrl } = useSiteBranding();
  const t = useT();
  const savedAccounts = useSavedAccounts();
  const [viewMode, setViewMode] = useState<"saved" | "credentials">("saved");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(null);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);

  const { expired: otpExpired, formatted: otpCountdown } = useOtpCountdown(otpExpiresAt);
  const { secondsLeft: resendWaitSeconds } = useOtpCountdown(resendAvailableAt);

  const destinationHint = useMemo(() => {
    if (!challenge) return "";
    if (otpDeliveredViaEmail(challenge)) {
      return challenge.email_hint || t("auth.yourEmail");
    }
    if (isPhoneLoginChallenge(challenge)) {
      return challenge.phone_hint || t("auth.yourPhone");
    }
    const parts = [challenge.email_hint, challenge.phone_hint].filter(Boolean);
    return parts.join(" · ") || t("auth.registeredContacts");
  }, [challenge, t]);

  useEffect(() => {
    if (token && !isLoading && user) {
      if (onSuccess) {
        onSuccess();
      } else {
        navigate({ to: homePathForUser(user) });
      }
    }
  }, [token, isLoading, user, navigate, onSuccess]);

  useEffect(() => {
    let cancelled = false;
    void getBiometricCapability().then((cap) => {
      if (cancelled) return;
      setBiometricReady(Boolean(isFlutterWebView() && cap.biometricAvailable));
      setBiometricEnrolled(Boolean(cap.loginEnrolled));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (token && (isLoading || user)) {
    return <AuthSessionLoader />;
  }

  const notifyOtpSent = (next: LoginOtpChallenge, options?: { resent?: boolean }) => {
    const title = options?.resent ? t("auth.otpResent") : t("auth.otpSent");
    if (otpDeliveredViaEmail(next)) {
      toast.success(title, {
        description:
          next.message ||
          t("auth.otpSentToEmail", {
            email: next.email_hint || t("auth.yourEmail"),
          }),
      });
      return;
    }
    if (isPhoneLoginChallenge(next)) {
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
      description: next.message || t("auth.otpSent"),
    });
  };

  const applyChallenge = (next: LoginOtpChallenge) => {
    const now = Date.now();
    setChallenge(next);
    setOtp("");
    setOtpExpiresAt(now + next.expires_in * 1000);
    setResendAvailableAt(now + 30_000);
  };

  const resetToCredentials = () => {
    setChallenge(null);
    setOtp("");
    setOtpExpiresAt(null);
    setResendAvailableAt(null);
  };

  const canResend = otpExpired || resendWaitSeconds <= 0;

  return (
    <div className={`w-full ${!challenge && savedAccounts.length > 0 && viewMode === "saved" ? "max-w-md" : "max-w-sm"} mx-auto`}>
      {!challenge && savedAccounts.length > 0 && viewMode === "saved" ? (
        <SavedAccountsView
          onAddAccount={() => setViewMode("credentials")}
          onSessionExpiredPrefill={(prefill) => {
            setIdentifier(prefill);
            setViewMode("credentials");
          }}
        />
      ) : (
        <>
          {!challenge && savedAccounts.length > 0 && (
            <button
              type="button"
              onClick={() => setViewMode("saved")}
              className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <ArrowLeft className="size-3.5" />
              {t("auth.backToSavedAccounts")} ({savedAccounts.length})
            </button>
          )}
          <div className="mb-6 flex flex-col items-center lg:items-start text-center lg:text-left">
            <img src={logoUrl} alt="MySewa" className={`size-12 rounded-md object-cover ${compact ? "mb-2" : "mb-3"}`} />
            <h1 className="text-2xl font-bold tracking-tight">
              {challenge ? t("auth.verifyLoginTitle") : t("auth.welcomeBack")}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
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
                    toast.success(t("auth.loginSuccess"));
                    if (onSuccess) {
                      onSuccess();
                    } else {
                      navigate({ to: homePathForUser(result.user) });
                    }
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
                <Label htmlFor="identifier" className="text-xs">{t("auth.emailOrPhone")}</Label>
                <Input
                  id="identifier"
                  name="username"
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="h-11 rounded-md text-sm"
                  placeholder={t("auth.emailOrPhonePlaceholder")}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password" className="text-xs">{t("auth.password")}</Label>
                  <Link
                    to="/forgot-password"
                    className="text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {t("auth.forgotPassword")}
                  </Link>
                </div>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-md text-sm"
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={submitting}
                className="h-11 w-full rounded-md text-sm font-semibold"
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
                  toast.success(t("auth.loginSuccess"));
                  if (onSuccess) {
                    onSuccess();
                  } else {
                    navigate({ to: homePathForUser(profile) });
                  }
                } catch (err) {
                  const msg = err instanceof ApiError ? err.message : t("auth.otpFailed");
                  toast.error(msg);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="login_otp" className="text-xs">{t("auth.verificationCode")}</Label>
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
                          className="size-10 text-sm font-semibold first:rounded-l-lg last:rounded-r-lg"
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <p className="text-center text-[12px] text-muted-foreground">
                  {otpExpired
                    ? t("auth.otpExpired")
                    : t("auth.otpExpiresIn", { time: otpCountdown })}
                </p>
              </div>

              <Button
                type="submit"
                disabled={submitting || otp.length !== 6}
                className="h-11 w-full rounded-md text-sm font-semibold"
              >
                {submitting ? t("auth.verifying") : t("auth.verifyAndLogIn")}
              </Button>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={resending || !canResend}
                  className="w-full text-center text-[12px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
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
                  className="w-full text-center text-[12px] font-medium text-muted-foreground hover:text-foreground"
                  onClick={resetToCredentials}
                >
                  {t("auth.backToCredentials")}
                </button>
              </div>
            </form>
          )}

          {!challenge && (
            <>
              <p className="mt-5 text-center text-xs text-muted-foreground">
                {t("auth.newTo")}{" "}
                <Link
                  to="/register"
                  className="font-semibold text-foreground underline-offset-2 hover:underline"
                >
                  {t("auth.createAccount")}
                </Link>
              </p>
              {biometricReady ? (
                <div className="mt-6 flex flex-col items-center gap-2">
                  <BiometricFingerprintButton
                    label={t("biometric.loginAria")}
                    loading={biometricBusy}
                    disabled={submitting}
                    onClick={async () => {
                      if (biometricBusy || submitting) return;
                      if (!biometricEnrolled) {
                        toast.message(t("biometric.loginNotEnabled"));
                        return;
                      }
                      setBiometricBusy(true);
                      try {
                        const result = await requestBiometric({ action: "login" });
                        if (result.reason === "cancelled") return;
                        if (!result.success || !result.authenticated) {
                          const msg = biometricErrorMessage(result, t("biometric.loginFailed"));
                          if (msg) toast.error(msg);
                          return;
                        }
                        const profile = await hydrateSessionFromStorage();
                        toast.success(t("auth.loginSuccess"));
                        if (onSuccess) {
                          onSuccess();
                        } else {
                          navigate({ to: homePathForUser(profile) });
                        }
                      } catch (err) {
                        const msg =
                          err instanceof ApiError ? err.message : t("biometric.loginFailed");
                        toast.error(msg);
                      } finally {
                        setBiometricBusy(false);
                      }
                    }}
                  />
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {biometricEnrolled ? t("biometric.loginHint") : t("biometric.loginSetupHint")}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
