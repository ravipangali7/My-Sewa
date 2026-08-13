/** Detects the MySewa Flutter WebView shell. */
export function isMySewaNativeApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return /MySewaApp\//i.test(navigator.userAgent);
}

/** True when running inside any WebView-like mobile shell. */
export function isEmbeddedWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    isMySewaNativeApp() ||
    /\bwv\b/i.test(ua) ||
    /WebView/i.test(ua)
  );
}

/**
 * Mark the document for native CSS and release leftover overflow traps
 * (overflow-x:hidden → overflow-y:auto pairing) that freeze Android WebView.
 *
 * Do NOT force height/min-height inline — that inflates document scrollHeight
 * past the real content and creates blank overscroll on every page.
 * Also clears stale inline height locks left by older unlock scripts.
 * Safe to call on every route change.
 */
export function ensureNativeDocumentScroll(): void {
  if (typeof document === "undefined") return;
  if (!isMySewaNativeApp()) return;

  document.documentElement.classList.add("mysewa-native");

  const clearStaleHeightLocks = (el: HTMLElement | null) => {
    if (!el) return;
    // Older unlock scripts set these with !important and left blank overscroll.
    if (el.style.getPropertyValue("height") || el.style.getPropertyValue("min-height") || el.style.getPropertyValue("max-height")) {
      el.style.removeProperty("height");
      el.style.removeProperty("min-height");
      el.style.removeProperty("max-height");
    }
  };

  const releaseOverflowTrap = (el: HTMLElement | null) => {
    if (!el) return;
    const style = window.getComputedStyle(el);
    if (style.position === "fixed" || style.position === "absolute") return;
    clearStaleHeightLocks(el);
    // Never leave overflow-x:hidden on expanding shells — it pairs to
    // overflow-y:auto and Android WebView swallows the gesture.
    if (style.overflowX === "hidden") {
      el.style.setProperty("overflow-x", "clip", "important");
      // Only clear a paired y-scroller when it was not intentionally scrollable
      // via an explicit max-height / flex min-height trap on mobile shells.
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        const maxH = style.maxHeight;
        const isBounded = maxH && maxH !== "none" && maxH !== "auto";
        if (!isBounded) {
          el.style.setProperty("overflow-y", "visible", "important");
        }
      }
    }
  };

  const mains = document.getElementsByTagName("main");
  for (let i = 0; i < Math.min(mains.length, 4); i++) {
    let node: HTMLElement | null = mains[i] ?? null;
    while (node && node !== document.body) {
      releaseOverflowTrap(node);
      node = node.parentElement;
    }
  }

  if (mains.length === 0) {
    const top = document.body?.firstElementChild as HTMLElement | null;
    releaseOverflowTrap(top);
  }
}

declare global {
  interface Window {
    MySewaNative?: {
      hasBridge?: boolean;
      downloadFile?: (payload: string | Record<string, unknown>) => boolean;
      /** Ask Flutter to obtain an FCM token and dispatch mysewa-fcm-token. */
      requestPushToken?: () => boolean;
      hasPushBridge?: boolean;
    };
    MySewaBridge?: {
      postMessage: (message: string) => void;
    };
    __mysewaFcmToken?: string;
    __mysewaFcmPlatform?: string;
    __mysewaApiBase?: string;
  }
}

export function hasNativeFileBridge(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.MySewaBridge?.postMessage || window.MySewaNative?.downloadFile);
}

export function hasNativePushBridge(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.MySewaNative?.requestPushToken ||
      window.MySewaNative?.hasPushBridge ||
      window.MySewaBridge?.postMessage,
  );
}

/** Ask the Flutter shell for an FCM (or stub) token via JS channel. */
export function requestNativePushToken(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.MySewaNative?.requestPushToken === "function") {
    try {
      return Boolean(window.MySewaNative.requestPushToken());
    } catch {
      return false;
    }
  }
  if (window.MySewaBridge?.postMessage) {
    try {
      window.MySewaBridge.postMessage(
        JSON.stringify({ type: "request_push_token" }),
      );
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Wait briefly for the Flutter push bridge after load. */
export async function waitForNativePushBridge(timeoutMs = 2500): Promise<boolean> {
  if (hasNativePushBridge()) return true;
  if (!isMySewaNativeApp()) return false;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
    if (hasNativePushBridge()) return true;
  }
  return hasNativePushBridge();
}

/** Wait briefly for the Flutter JS channel to appear after load. */
export async function waitForNativeFileBridge(timeoutMs = 2500): Promise<boolean> {
  if (hasNativeFileBridge()) return true;
  if (!isMySewaNativeApp()) return false;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
    if (hasNativeFileBridge()) return true;
  }
  return hasNativeFileBridge();
}
