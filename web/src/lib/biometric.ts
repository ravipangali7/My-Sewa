import { isMySewaNativeApp } from "./native-app";

export type BiometricAction =
  | "availability"
  | "login"
  | "enable_login"
  | "disable_login"
  | "transaction_pin"
  | "enable_transaction_pin"
  | "disable_transaction_pin";

export type BiometricReason =
  | "cancelled"
  | "authentication_failed"
  | "not_available"
  | "not_enrolled"
  | "not_supported"
  | "not_enabled"
  | "locked_out"
  | "busy"
  | "bridge_unavailable"
  | "session_expired"
  | "network_unavailable"
  | "backend_failed"
  | "timeout"
  | string;

export type BiometricResult = {
  success: boolean;
  action: string;
  authenticated: boolean;
  reason?: BiometricReason;
  message?: string;
  requestId?: string;
  biometricAvailable?: boolean;
  loginEnrolled?: boolean;
  pinEnrolled?: boolean;
  availableTypes?: string[];
};

type Pending = {
  resolve: (result: BiometricResult) => void;
};

const pending = new Map<string, Pending>();
let listenerAttached = false;
let lastCapability: BiometricResult | null = null;

function native(): Window["MySewaNative"] | undefined {
  if (typeof window === "undefined") return undefined;
  return window.MySewaNative;
}

export function isFlutterWebView(): boolean {
  if (typeof window === "undefined") return false;
  if (!isMySewaNativeApp()) return false;
  const api = native();
  return Boolean(api?.hasBiometricBridge || api?.isFlutterWebView || window.MySewaBridge?.postMessage);
}

export function hasBiometricBridge(): boolean {
  if (!isFlutterWebView()) return false;
  const api = native();
  return Boolean(api?.requestBiometric || api?.hasBiometricBridge || window.MySewaBridge?.postMessage);
}

function attachListener() {
  if (listenerAttached || typeof window === "undefined") return;
  listenerAttached = true;
  window.addEventListener("mysewa-biometric", onBiometricEvent as EventListener);
  window.addEventListener("mysewa-biometric-capability", onCapabilityEvent as EventListener);
}

function onCapabilityEvent(event: Event) {
  const detail = (event as CustomEvent<BiometricResult>).detail;
  if (detail && typeof detail === "object") {
    lastCapability = {
      ...detail,
      action: detail.action || "availability",
    };
  }
}

function onBiometricEvent(event: Event) {
  const detail = (event as CustomEvent<BiometricResult>).detail;
  if (!detail || typeof detail !== "object") return;
  const requestId = detail.requestId;
  if (requestId && pending.has(requestId)) {
    pending.get(requestId)!.resolve(detail);
    pending.delete(requestId);
  }
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `bio_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function post(payload: Record<string, unknown>): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (typeof window.MySewaNative?.requestBiometric === "function") {
      return Boolean(window.MySewaNative.requestBiometric(payload));
    }
    if (window.MySewaBridge?.postMessage) {
      window.MySewaBridge.postMessage(JSON.stringify({ type: "biometric", ...payload }));
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function biometricUnavailableResult(action: string): BiometricResult {
  return {
    success: false,
    action,
    authenticated: false,
    reason: "bridge_unavailable",
    message: "Biometric authentication is only available in the MySewa app.",
  };
}

export async function requestBiometric(options: {
  action: BiometricAction | string;
  userId?: string | number | null;
  reason?: string;
  timeoutMs?: number;
}): Promise<BiometricResult> {
  attachListener();
  const action = options.action;
  if (!hasBiometricBridge()) {
    return biometricUnavailableResult(action);
  }

  const requestId = newRequestId();
  const timeoutMs = options.timeoutMs ?? 90_000;

  const posted = post({
    type: "biometric",
    action,
    requestId,
    ...(options.userId != null ? { userId: String(options.userId) } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
  });
  if (!posted) {
    return biometricUnavailableResult(action);
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      resolve({
        success: false,
        action,
        authenticated: false,
        reason: "timeout",
        message: "Biometric authentication timed out. Please try again.",
      });
    }, timeoutMs);
    pending.set(requestId, {
      resolve: (result) => {
        window.clearTimeout(timer);
        resolve(result);
      },
    });
  });
}

export async function getBiometricCapability(
  timeoutMs = 4000,
  options?: { force?: boolean },
): Promise<BiometricResult> {
  attachListener();
  if (!isFlutterWebView()) {
    return {
      success: false,
      action: "availability",
      authenticated: false,
      biometricAvailable: false,
      reason: "bridge_unavailable",
    };
  }
  if (!options?.force && lastCapability) return lastCapability;
  const started = Date.now();
  if (!options?.force) {
    while (Date.now() - started < Math.min(800, timeoutMs)) {
      await new Promise((r) => setTimeout(r, 80));
      if (lastCapability) return lastCapability;
    }
  }
  const result = await requestBiometric({ action: "availability", timeoutMs });
  lastCapability = result;
  return result;
}

export function biometricErrorMessage(result: BiometricResult, fallback: string): string {
  if (result.reason === "cancelled") return "";
  if (result.message && result.message.trim()) return result.message.trim();
  switch (result.reason) {
    case "not_available":
    case "not_supported":
      return "Biometric authentication is unavailable on this device.";
    case "not_enrolled":
      return "No fingerprint or Face ID is enrolled on this device.";
    case "not_enabled":
      return "Enable biometric authentication from Profile first.";
    case "locked_out":
      return "Too many failed attempts. Use your password or PIN, then try again.";
    case "session_expired":
      return "Your session expired. Please sign in again.";
    case "network_unavailable":
      return "Network unavailable. Please check your connection.";
    case "bridge_unavailable":
      return "Biometric authentication is only available in the MySewa app.";
    case "authentication_failed":
      return "Biometric authentication failed. Please try again.";
    default:
      return fallback;
  }
}

export type TransactionAuthFields = {
  transaction_pin?: string;
  use_biometric?: boolean;
};

export function transactionAuthPayload(input: {
  pin?: string;
  useBiometric?: boolean;
}): TransactionAuthFields {
  if (input.useBiometric) return { use_biometric: true };
  const pin = input.pin?.trim();
  return pin ? { transaction_pin: pin } : {};
}
