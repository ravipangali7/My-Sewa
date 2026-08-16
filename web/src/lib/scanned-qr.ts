const SCANNED_QR_KEY = "mysewa.scanned_qr";

export function stashScannedQr(raw: string) {
  if (typeof sessionStorage === "undefined") return;
  const value = String(raw || "").trim();
  if (!value) return;
  sessionStorage.setItem(SCANNED_QR_KEY, value);
}

export function peekStashedQr(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  const value = sessionStorage.getItem(SCANNED_QR_KEY)?.trim();
  return value || null;
}

export function takeStashedQr(): string | null {
  const value = peekStashedQr();
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(SCANNED_QR_KEY);
  }
  return value;
}
