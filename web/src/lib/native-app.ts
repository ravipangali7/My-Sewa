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
 * Mark the document for native CSS and release any leftover shell
 * overflow traps (overflow-x:hidden → overflow-y:auto pairing).
 * Safe to call on every route change.
 */
export function ensureNativeDocumentScroll(): void {
  if (typeof document === "undefined") return;
  if (!isMySewaNativeApp()) return;

  document.documentElement.classList.add("mysewa-native");

  const release = (el: HTMLElement | null) => {
    if (!el) return;
    const style = window.getComputedStyle(el);
    if (style.position === "fixed" || style.position === "absolute") return;
    // Never leave overflow-x:hidden on expanding shells — it pairs to
    // overflow-y:auto and Android WebView swallows the gesture.
    if (style.overflowX === "hidden" || style.overflowY === "auto" || style.overflowY === "scroll") {
      el.style.setProperty("overflow-x", "clip", "important");
      el.style.setProperty("overflow-y", "visible", "important");
    }
    el.style.setProperty("height", "auto", "important");
    el.style.setProperty("max-height", "none", "important");
  };

  const mains = document.getElementsByTagName("main");
  for (let i = 0; i < Math.min(mains.length, 4); i++) {
    let node: HTMLElement | null = mains[i];
    while (node && node !== document.body) {
      release(node);
      if (node.parentElement === document.body) {
        node.style.setProperty("min-height", "100dvh", "important");
        break;
      }
      node = node.parentElement;
    }
  }

  if (mains.length === 0) {
    const top = document.body?.firstElementChild as HTMLElement | null;
    if (top) {
      release(top);
      top.style.setProperty("min-height", "100dvh", "important");
    }
  }
}

declare global {
  interface Window {
    MySewaNative?: {
      hasBridge?: boolean;
      downloadFile?: (payload: string | Record<string, unknown>) => boolean;
    };
    MySewaBridge?: {
      postMessage: (message: string) => void;
    };
  }
}

export function hasNativeFileBridge(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.MySewaBridge?.postMessage || window.MySewaNative?.downloadFile);
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
