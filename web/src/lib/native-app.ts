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
