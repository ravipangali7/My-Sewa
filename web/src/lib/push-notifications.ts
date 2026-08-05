/**
 * Push / device-token registration for authenticated sessions.
 *
 * - Browser: Notification API permission + a stable web placeholder token.
 * - Flutter WebView: prefers FCM token from the native bridge
 *   (`mysewa-fcm-token` event / MySewaNative.requestPushToken).
 *
 * Tokens are posted to POST /api/auth/device-token/.
 */
import { apiClient } from "./api";
import {
  isMySewaNativeApp,
  requestNativePushToken,
  waitForNativePushBridge,
} from "./native-app";

const WEB_TOKEN_KEY = "mysewa_web_device_token";
const LAST_REGISTERED_KEY = "mysewa_last_device_token";

function ensureWebPlaceholderToken(): string {
  if (typeof window === "undefined") return "";
  let token = localStorage.getItem(WEB_TOKEN_KEY);
  if (token && token.length >= 8) return token;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  token = `web:${rand}`;
  localStorage.setItem(WEB_TOKEN_KEY, token);
  return token;
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

export async function registerPushDeviceToken(opts?: {
  token?: string;
  platform?: string;
}): Promise<boolean> {
  const token = (opts?.token || "").trim();
  if (!token) return false;
  const platform = detectPlatform(opts?.platform);
  try {
    await apiClient.registerDeviceToken({ token, platform });
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LAST_REGISTERED_KEY, token);
    }
    return true;
  } catch (err) {
    console.warn("[push] device token registration failed", err);
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

async function requestBrowserNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Best-effort: register SW so future Web Push / showNotification can work.
 * Does not require a VAPID key for MVP.
 */
async function ensureNotificationServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw-notifications.js", { scope: "/" });
  } catch {
    // Optional — ignore failures (e.g. non-HTTPS localhost quirks)
  }
}

/**
 * Call once after the user is authenticated.
 * Safe to call repeatedly; registration is idempotent on the server.
 */
export async function setupPushNotifications(): Promise<void> {
  if (typeof window === "undefined") return;

  // Listen for Flutter / native FCM token delivery
  const onNativeToken = (ev: Event) => {
    const detail = (ev as CustomEvent<{ token?: string; platform?: string }>).detail;
    if (detail?.token) {
      void registerPushDeviceToken({
        token: detail.token,
        ...(detail.platform ? { platform: detail.platform } : {}),
      });
    }
  };
  window.addEventListener("mysewa-fcm-token", onNativeToken);

  if (isMySewaNativeApp()) {
    await waitForNativePushBridge(2000);
    const requested = requestNativePushToken();
    if (!requested) {
      // Stub path: Flutter injects mysewa-fcm-token; if not, register a native placeholder
      await registerPushDeviceToken({
        token: `flutter-stub:${ensureWebPlaceholderToken().replace(/^web:/, "")}`,
        platform: detectPlatform(),
      });
    }
    // Keep listener for late FCM responses; do not remove
    return;
  }

  await requestBrowserNotificationPermission();
  void ensureNotificationServiceWorker();
  await registerPushDeviceToken({
    token: ensureWebPlaceholderToken(),
    platform: "web",
  });
}
