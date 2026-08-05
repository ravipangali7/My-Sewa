import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NoInternetScreen } from "@/components/NoInternetScreen";

const DEBOUNCE_MS = 250;
const PROBE_TIMEOUT_MS = 4_000;
/** Same-origin lightweight asset — any HTTP response means the network works. */
const PROBE_URL = "/favicon.png";

export type OnlineStatus = {
  /** Confirmed reachable (browser online + optional probe). */
  isOnline: boolean;
  /** True while a connectivity check is in flight. */
  isChecking: boolean;
  /** Raw `navigator.onLine` (can be a false positive). */
  browserOnline: boolean;
  /** Re-probe connectivity (for Retry). Resolves to the new online state. */
  check: () => Promise<boolean>;
};

const OnlineContext = createContext<OnlineStatus | null>(null);

function readBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/**
 * Lightweight reachability probe. Treats any HTTP response as online;
 * only network failures / timeouts count as offline.
 */
export async function probeConnectivity(
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return false;
  }
  if (typeof fetch === "undefined") {
    return readBrowserOnline();
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(`${PROBE_URL}?_online=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function OnlineProvider({ children }: { children: ReactNode }) {
  // Assume online until mounted / probed — avoids SSR/hydration mismatch.
  const [browserOnline, setBrowserOnline] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  const debounceRef = useRef<number | null>(null);
  const checkSeq = useRef(0);

  const runCheck = useCallback(async (assumeBrowser?: boolean): Promise<boolean> => {
    const browser =
      assumeBrowser !== undefined ? assumeBrowser : readBrowserOnline();
    setBrowserOnline(browser);

    if (!browser) {
      setIsOnline(false);
      setIsChecking(false);
      return false;
    }

    const seq = ++checkSeq.current;
    setIsChecking(true);
    const ok = await probeConnectivity();
    if (seq !== checkSeq.current) {
      // A newer check superseded this one.
      return ok;
    }
    setIsOnline(ok);
    setIsChecking(false);
    return ok;
  }, []);

  const scheduleCheck = useCallback(
    (assumeBrowser?: boolean) => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void runCheck(assumeBrowser);
      }, DEBOUNCE_MS);
    },
    [runCheck],
  );

  const check = useCallback(() => runCheck(), [runCheck]);

  useEffect(() => {
    // Confirm reachability on mount (navigator.onLine alone is insufficient).
    void runCheck();

    const onOnline = () => scheduleCheck(true);
    const onOffline = () => {
      // Go offline immediately; debounce only applies to recovery probes.
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      checkSeq.current += 1;
      setBrowserOnline(false);
      setIsOnline(false);
      setIsChecking(false);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        scheduleCheck();
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      checkSeq.current += 1;
    };
  }, [runCheck, scheduleCheck]);

  const value = useMemo<OnlineStatus>(
    () => ({ isOnline, isChecking, browserOnline, check }),
    [isOnline, isChecking, browserOnline, check],
  );

  return (
    <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>
  );
}

export function useOnlineStatus(): OnlineStatus {
  const ctx = useContext(OnlineContext);
  if (!ctx) {
    throw new Error("useOnlineStatus must be used within OnlineProvider");
  }
  return ctx;
}

/**
 * Full-screen offline overlay. Children stay mounted underneath
 * (mirrors Flutter WebView + NoInternetScreen stacking).
 */
export function OfflineGate({ children }: { children: ReactNode }) {
  const { isOnline, isChecking, check } = useOnlineStatus();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <>
      {children}
      {ready && !isOnline ? (
        <NoInternetScreen
          onRetry={() => {
            void check();
          }}
          isChecking={isChecking}
        />
      ) : null}
    </>
  );
}
