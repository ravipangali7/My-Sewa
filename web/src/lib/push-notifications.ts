/**
 * Push / device-token registration for authenticated sessions.
 *
 * Flutter WebView delivers the real FCM token via:
 *   - window.__mysewaFcmToken (set as soon as the native shell has it)
 *   - CustomEvent `mysewa-fcm-token`
 *
 * After login, React POSTs that token to /api/auth/device-token/ and also
 * tells Flutter (`auth_ready`) so the native shell can POST it as a backup.
 * Stub / placeholder tokens are never sent.
 */
import { toast } from "sonner";
import { apiClient, getApiBase, getToken } from "./api";
import { notifyLiveRefresh } from "./refresh";
import {
  hasNativePushBridge,
  isMySewaNativeApp,
  requestNativePushToken,
  waitForNativePushBridge,
} from "./native-app";

const LAST_REGISTERED_KEY = "mysewa_last_device_token";
const PENDING_TOKEN_KEY = "mysewa_pending_fcm_token";
const PENDING_PLATFORM_KEY = "mysewa_pending_fcm_platform";

let listenerAttached = false;
let setupInFlight: Promise<void> | null = null;
let lastRegisteredForAuth: string | null = null;

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

function storageGet(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return (localStorage.getItem(key) || sessionStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function storageSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function cachePendingToken(token: string, platform?: string) {
  storageSet(PENDING_TOKEN_KEY, token);
  if (platform) storageSet(PENDING_PLATFORM_KEY, platform);
}

function readPendingToken(): { token: string; platform?: string } | null {
  if (typeof window === "undefined") return null;
  const injected = String(
    (window as Window & { __mysewaFcmToken?: string }).__mysewaFcmToken || "",
  ).trim();
  const injectedPlatform = String(
    (window as Window & { __mysewaFcmPlatform?: string }).__mysewaFcmPlatform || "",
  ).trim();
  const stored = storageGet(PENDING_TOKEN_KEY);
  const token = injected || stored;
  if (!token || !isRealFcmToken(token)) return null;
  const platform = injectedPlatform || storageGet(PENDING_PLATFORM_KEY) || undefined;
  return { token, ...(platform ? { platform } : {}) };
}

export function notifyNativeLogout() {
  if (typeof window === "undefined") return;
  try {
    window.MySewaBridge?.postMessage(JSON.stringify({ type: "logout" }));
  } catch {
    /* native channel may not exist in the browser */
  }
}

function notifyNativeAuthReady() {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({
    type: "auth_ready",
    apiBase: getApiBase(),
  });
  try {
    window.MySewaBridge?.postMessage(payload);
  } catch {
    /* native channel may not exist in the browser */
  }
}

async function waitForPendingToken(timeoutMs: number): Promise<{
  token: string;
  platform?: string;
} | null> {
  const started = Date.now();
  let pending = readPendingToken();
  if (pending) return pending;

  requestNativePushToken();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 250));
    pending = readPendingToken();
    if (pending) return pending;
    const elapsed = Date.now() - started;
    if (elapsed >= 1500 && elapsed < 1800) {
      requestNativePushToken();
    }
  }
  return readPendingToken();
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
  const authKey = `${getToken()}::${token}`;
  cachePendingToken(token, platform);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await apiClient.registerDeviceToken({ token, platform });
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(LAST_REGISTERED_KEY, token);
      }
      lastRegisteredForAuth = authKey;
      return true;
    } catch (err) {
      if (attempt === 2) {
        console.warn("[push] device token registration failed", err);
        return false;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return false;
}

export async function unregisterStoredDeviceToken(): Promise<void> {
  lastRegisteredForAuth = null;
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
  const detail = (ev as CustomEvent<{ title?: string; body?: string; data?: Record<string, string> }>)
    .detail;
  const title = (detail?.title || "").trim();
  const body = (detail?.body || "").trim();
  notifyLiveRefresh();
  // The native app shows a sounding Firebase/local heads-up notification.
  if (isMySewaNativeApp()) return;
  if (!title && !body) return;
  if (title && body) {
    toast.info(title, { description: body });
    return;
  }
  toast.info(title || body);
}

function supportChatPathForLocation(threadId?: string): string {
  if (typeof window === "undefined") return "/app/support-chat";
  const path = window.location.pathname.startsWith("/admin")
    ? "/admin/support-chat"
    : "/app/support-chat";
  const id = (threadId || "").trim();
  return id ? `${path}?thread=${encodeURIComponent(id)}` : path;
}

function threadIdFromPushData(data: Record<string, string>): string {
  return String(data.thread_id || data.conversation_id || "").trim();
}

function persistOpenedThread(threadId: string) {
  if (!threadId || typeof window === "undefined") return;
  try {
    sessionStorage.setItem("mysewa-support-chat-thread", threadId);
  } catch {
    /* private mode */
  }
}

function isSupportChatPush(data: Record<string, string>): boolean {
  const event = (data.event || data.type || "").toLowerCase();
  return event === "support_chat" || event === "support_message";
}

function handleOpenedPush(ev: Event) {
  const detail = (ev as CustomEvent<{ data?: Record<string, string> }>).detail;
  const data = detail?.data || {};
  notifyLiveRefresh();
  const threadId = threadIdFromPushData(data);
  if (threadId) persistOpenedThread(threadId);
  if (!isSupportChatPush(data)) return;
  const target = supportChatPathForLocation();
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith(target.split("?")[0])) {
    window.dispatchEvent(
      new CustomEvent("mysewa-open-support-thread", { detail: { threadId } }),
    );
    return;
  }
  window.location.assign(supportChatPathForLocation(threadId));
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
  window.addEventListener("mysewa-push-opened", handleOpenedPush);
  window.addEventListener("mysewa-app-resume", () => {
    requestNativePushToken();
    const pending = readPendingToken();
    if (pending) void registerPushDeviceToken(pending);
  });

  const pending = readPendingToken();
  if (pending) {
    void registerPushDeviceToken(pending);
  }
  if (isMySewaNativeApp() || hasNativePushBridge()) {
    void waitForNativePushBridge(2500).then((ok) => {
      if (ok) requestNativePushToken();
    });
  }
}

/**
 * Call once after the user is authenticated.
 * Safe to call repeatedly; registration is idempotent on the server.
 * Waits for the native FCM token instead of giving up if it is not
 * already sitting on window from the first page load.
 */
export async function setupPushNotifications(): Promise<void> {
  if (typeof window === "undefined") return;
  if (setupInFlight) return setupInFlight;

  setupInFlight = (async () => {
    listenForNativePushToken();
    if (!getToken()) return;

    notifyNativeAuthReady();

    const native = isMySewaNativeApp() || hasNativePushBridge();
    if (native) {
      await waitForNativePushBridge(2500);
      requestNativePushToken();
    }

    const pending = await waitForPendingToken(native ? 8000 : 400);
    if (!pending) return;

    const authKey = `${getToken()}::${pending.token}`;
    if (lastRegisteredForAuth === authKey) return;
    await registerPushDeviceToken(pending);
  })().finally(() => {
    setupInFlight = null;
  });

  return setupInFlight;
}
