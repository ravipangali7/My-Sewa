import { useEffect, useState } from "react";

/** Default phone-change OTP lifetime — keep in sync with server PHONE_CHANGE_OTP_TIMEOUT. */
export const PHONE_CHANGE_OTP_SECONDS = 120;

export function formatOtpCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Countdown from an absolute expiry timestamp (ms since epoch). */
export function useOtpCountdown(expiresAtMs: number | null) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (expiresAtMs == null) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      setSecondsLeft(Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [expiresAtMs]);

  return {
    secondsLeft,
    expired: expiresAtMs != null && secondsLeft <= 0,
    formatted: formatOtpCountdown(secondsLeft),
  };
}
