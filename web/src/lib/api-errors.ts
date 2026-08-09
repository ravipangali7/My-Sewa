import { toast } from "sonner";
import { ApiError } from "@/lib/api";

const FALLBACK =
  "The payment could not be completed. Please try again or contact MySewa support if this continues.";

const TECHNICAL_PATTERNS = [
  /^provider error code:/i,
  /^error type:/i,
  /^servicelevel\./i,
  /^systemlevel\./i,
  /^jsonschema\./i,
  /^requestvalidation\./i,
  /ip allowlist/i,
  /ip whitelist/i,
  /api key uuid/i,
  /x-api-key/i,
  /merchant_transaction_id/i,
  /wallet_service_name/i,
  /traceback/i,
  /himalpay dashboard/i,
];

const CATALOG_JARGON = new Set([
  "wallet service is not allowed for this user",
  "wallet service is currently disabled",
  "wallet service not found",
  "wallet service is invalid or misconfigured",
  "transaction failed to process",
  "an unknown error occurred",
  "access from this ip address has been blocked",
  "access from this ip address is not allowed",
  "the service is currently unavailable",
  "himalpay request failed",
  "request failed",
  "bad request",
  "forbidden",
  "internal server error",
]);

const CODE_MESSAGES: Record<number, string> = {
  1000: "Payment service authentication failed. Please try again later or contact MySewa support.",
  1001: "Payment service authentication failed. Please try again later or contact MySewa support.",
  1002: "Payment service authentication failed. Please try again later or contact MySewa support.",
  1010: "Too many attempts. Please wait a moment and try again.",
  1011: "Transactions are temporarily on hold. Please try again later or contact MySewa support.",
  3001: "This transaction exceeds the allowed limit. Try a smaller amount.",
  6003: "This request was already submitted. Please wait a moment or check your history.",
  7000: "This payment service is not available for your account right now.",
  7001: "This payment service is temporarily disabled. Please try again later.",
  7002: "This payment service is not available right now. Please try again later.",
  7003: "This payment service is not available right now. Please try again later.",
  7004: "The payment could not be completed. Please try again or contact MySewa support.",
  8000: "Something went wrong with the payment service. Please try again later.",
  9000: "Payment service is temporarily unavailable. Please try again later or contact MySewa support.",
  9001: "Payment service is temporarily unavailable. Please try again later or contact MySewa support.",
  9002: "Payment service is temporarily unavailable. Please try again later.",
  9003: "Too many requests. Please wait a moment and try again.",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isTechnicalLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (CATALOG_JARGON.has(t.toLowerCase())) return true;
  if (TECHNICAL_PATTERNS.some((re) => re.test(t))) return true;
  if (/\b[A-Za-z]+(?:Level)?\.[A-Za-z]+\b/.test(t)) return true;
  return false;
}

/** Strip technical HimalPay meta so toasts stay readable for end users. */
export function sanitizeProviderMessage(text: string, fallback = FALLBACK): string {
  const cleaned = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isTechnicalLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned || isTechnicalLine(cleaned)) return fallback;

  // Soften leftover IP / allowlist wording that may arrive in one paragraph.
  if (/ip not allow|allowlist|whitelist/i.test(cleaned)) {
    return (
      "Payment service is temporarily unavailable. " +
      "Please try again later or contact MySewa support."
    );
  }

  if (!cleaned) return cleaned;
  return cleaned[0]!.toUpperCase() + cleaned.slice(1);
}

function errorCodeFromBody(body: unknown): number | null {
  const b = asRecord(body);
  if (!b) return null;
  const nested =
    asRecord(b["himapayResponse"]) ||
    asRecord(b["himalpay_response"]) ||
    asRecord(b["data"]);
  const raw = b["error_code"] ?? nested?.["error_code"];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

export function errorMessageFromUnknown(err: unknown, fallback = FALLBACK): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

/**
 * Resolve a user-friendly message from an API / HimalPay error.
 * Prefer server `message`, then sanitize; never surface enums or allowlist ops.
 */
export function userFriendlyApiMessage(err: unknown, fallback = FALLBACK): string {
  if (err instanceof ApiError) {
    const code = errorCodeFromBody(err.body);
    const body = asRecord(err.body);
    const preferred = firstString(
      body?.["message"],
      body?.["provider_message"],
      body?.["vendor_state"],
      err.message,
    );
    if (preferred) {
      const friendly = sanitizeProviderMessage(preferred, "");
      if (friendly) return friendly;
    }
    if (code != null && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
    return sanitizeProviderMessage(err.message, fallback);
  }
  return sanitizeProviderMessage(errorMessageFromUnknown(err, fallback), fallback);
}

type ToastApiErrorOpts = {
  title?: string;
  fallback?: string;
  /** When true, prefer API `error` (e.g. "Already received") as the toast title. */
  preferErrorTitle?: boolean;
};

/** Prefer remittance / HimalPay `error` labels as toast titles when useful. */
export function apiErrorTitle(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const body = asRecord(err.body);
  const label = firstString(body?.["error"]);
  if (!label) return fallback;
  // Skip generic DRF / HTTP labels — keep the friendly fallback title.
  if (/^(error|bad request|request failed|detail)$/i.test(label)) return fallback;
  return sanitizeProviderMessage(label, fallback);
}

/** Show a HimalPay / API failure as a sonner toast (no technical jargon). */
export function toastApiError(err: unknown, opts?: ToastApiErrorOpts) {
  const message = userFriendlyApiMessage(err, opts?.fallback || FALLBACK);
  const title =
    opts?.title && opts.preferErrorTitle
      ? apiErrorTitle(err, opts.title)
      : opts?.title;
  if (title) {
    // Avoid "Title / Title" when message equals the title (e.g. Already received).
    if (message.toLowerCase() === title.toLowerCase()) {
      toast.error(message);
    } else {
      toast.error(title, { description: message });
    }
  } else {
    toast.error(message);
  }
}

/** Toast a plain string after sanitizing technical crumbs. */
export function toastApiMessage(
  text: string,
  opts?: { title?: string; fallback?: string; tone?: "error" | "message" | "success" },
) {
  const message = sanitizeProviderMessage(text, opts?.fallback || FALLBACK);
  const tone = opts?.tone || "error";
  if (opts?.title) {
    toast[tone](opts.title, { description: message });
  } else {
    toast[tone](message);
  }
}
