/**
 * Push / device-token registration for authenticated sessions.
 *
 * Flutter WebView delivers the real FCM token via:
 *   - window.__mysewaFcmToken (set as soon as the native shell has it)
 *   - CustomEvent `mysewa-fcm-token`
 *
 * React POSTs that token to /api/auth/device-token/. The API stores each
 * token only once (unique). Stub / placeholder tokens are never sent.
 */
import { toast } from "sonner";
import { apiClient, getToken } from "./api";
import {
  isMySewaNativeApp,
  requestNativePushToken,
  waitForNativePushBridge,
} from "./native-app";

const LAST_REGISTERED_KEY = "mysewa_last_device_token";
const PENDING_TOKEN_KEY = "mysewa_pending_fcm_token";
const PENDING_PLATFORM_KEY = "mysewa_pending_fcm_platform";

let listenerAttached = false;

function isRealFcmToken(token: string): boolean {
  const value = token.trim();
  if (value.length < 20) return false;
  const lowered = value.toLowerCase();
  return !(
    lowered.startsWith("flutter-stub") ||
    lowered.startsWith("web:") ||
    lowered.startsWith("stub:")
  );
}

function detectPlatform(explicit?: string): "android" | "ios" | "web" | "unknown" {
  if (explicit === "android" || explicit === "ios" || explicit === "web") {
    return explicit;
  }
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (isMySewaNativeApp()) return "unknown";
  return "web";
}

function cachePendingToken(token: string, platform?: string) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(PENDING_TOKEN_KEY, token);
  if (platform) sessionStorage.setItem(PENDING_PLATFORM_KEY, platform);
}

function readPendingToken(): { token: string; platform?: string } | null {
  if (typeof window === "undefined") return null;
  const injected = String(
    (window as Window & { __mysewaFcmToken?: string }).__mysewaFcmToken || "",
  ).trim();
  const injectedPlatform = String(
    (window as Window & { __mysewaFcmPlatform?: string }).__mysewaFcmPlatform || "",
  ).trim();
  const stored =
    typeof sessionStorage !== "undefined"
      ? (sessionStorage.getItem(PENDING_TOKEN_KEY) || "").trim()
      : "";
  const token = injected || stored;
  if (!token || !isRealFcmToken(token)) return null;
  const platform =
    injectedPlatform ||
    (typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem(PENDING_PLATFORM_KEY) || undefined
      : undefined);
  return { token, ...(platform ? { platform } : {}) };
}

export async function registerPushDeviceToken(opts?: {
  token?: string;
  platform?: string;
}): Promise<boolean> {
  const token = (opts?.token || "").trim();
  if (!token || !isRealFcmToken(token)) return false;
  if (!getToken()) {
    cachePendingToken(token, opts?.platform);
    return false;
  }
  const platform = detectPlatform(opts?.platform);
  try {
    await apiClient.registerDeviceToken({ token, platform });
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LAST_REGISTERED_KEY, token);
    }
    return true;
  } catch (err) {
    console.warn("[push] device token registration failed", err);
    cachePendingToken(token, platform);
    return false;
  }
}

export async function unregisterStoredDeviceToken(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const token = localStorage.getItem(LAST_REGISTERED_KEY);
  if (!token) return;
  try {
    await apiClient.unregisterDeviceToken(token);
  } catch {
    // ignore — logout should still proceed
  } finally {
    localStorage.removeItem(LAST_REGISTERED_KEY);
  }
}

function handleNativeTokenEvent(ev: Event) {
  const detail = (ev as CustomEvent<{ token?: string; platform?: string; stub?: boolean }>)
    .detail;
  const token = (detail?.token || "").trim();
  if (!token || detail?.stub || !isRealFcmToken(token)) return;
  cachePendingToken(token, detail?.platform);
  void registerPushDeviceToken({
    token,
    ...(detail?.platform ? { platform: detail.platform } : {}),
  });
}

function handleForegroundPush(ev: Event) {
  const detail = (ev as CustomEvent<{ title?: string; body?: string }>).detail;
  const title = (detail?.title || "").trim();
  const body = (detail?.body || "").trim();
  if (!title && !body) return;
  if (title && body) {
    toast.info(title, { description: body });
    return;
  }
  toast.info(title || body);
}

/**
 * Start listening for the native FCM token as soon as the SPA boots —
 * before login — so the first app-open event is not missed.
 */
export function listenForNativePushToken(): void {
  if (typeof window === "undefined" || listenerAttached) return;
  listenerAttached = true;
  window.addEventListener("mysewa-fcm-token", handleNativeTokenEvent);
  window.addEventListener("mysewa-push-received", handleForegroundPush);
  window.addEventListener("mysewa-app-resume", () => {
    requestNativePushToken();
    const pending = readPendingToken();
    if (pending) void registerPushDeviceToken(pending);
  });

  const pending = readPendingToken();
  if (pending) {
    void registerPushDeviceToken(pending);
  }
  if (isMySewaNativeApp()) {
    void waitForNativePushBridge(2500).then((ok) => {
      if (ok) requestNativePushToken();
    });
  }
}

/**
 * Call once after the user is authenticated.
 * Safe to call repeatedly; registration is idempotent on the server.
 */
export async function setupPushNotifications(): Promise<void> {
  if (typeof window === "undefined") return;
  listenForNativePushToken();

  if (isMySewaNativeApp()) {
    await waitForNativePushBridge(2000);
    requestNativePushToken();
    const pending = readPendingToken();
    if (pending) {
      await registerPushDeviceToken(pending);
    }
    return;
  }

  // Browser sessions do not receive Firebase app pushes. Native FCM only.
}
