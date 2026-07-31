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
