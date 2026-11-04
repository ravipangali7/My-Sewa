import { useEffect, useState } from "react";
import { SAVED_ACCOUNTS_KEY } from "./constants";
import { getApiBase } from "./api";

export interface SavedAccount {
  id: number;
  phone: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  role?: string;
  token: string;
  deviceId?: string;
  deviceSecret?: string;
  savedAt: number;
  lastUsedAt: number;
}

const SAVED_ACCOUNTS_EVENT = "mysewa_saved_accounts_changed";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "browser-device";
  try {
    let id = localStorage.getItem("mysewa_device_id");
    if (!id || id.trim() === "") {
      id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("mysewa_device_id", id);
    }
    return id;
  } catch {
    return "fallback-device";
  }
}

function syncToNativeBridge(accounts: SavedAccount[]) {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(accounts);
    const win = window as unknown as {
      MySewaBridge?: { postMessage: (msg: string) => void };
      MySewaNative?: { isFlutterWebView?: boolean };
    };
    if (win.MySewaBridge?.postMessage) {
      win.MySewaBridge.postMessage(
        JSON.stringify({
          type: "save_saved_accounts",
          accounts: raw,
        }),
      );
    }
  } catch {
    // ignore bridge errors
  }
}

function notifyChange(accounts?: SavedAccount[]) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SAVED_ACCOUNTS_EVENT));
    if (accounts) {
      syncToNativeBridge(accounts);
    }
  }
}

export function getSavedAccounts(): SavedAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (a): a is SavedAccount =>
          Boolean(a && typeof a === "object" && a.id && a.token && (a.phone || a.email)),
      )
      .sort((a, b) => (b.lastUsedAt || b.savedAt || 0) - (a.lastUsedAt || a.savedAt || 0));
  } catch {
    return [];
  }
}

export function saveAccount(account: {
  id: number;
  phone: string;
  email?: string | null;
  name: string;
  avatarUrl?: string | null;
  role?: string;
  token: string;
  deviceId?: string;
  deviceSecret?: string;
}): SavedAccount[] {
  if (typeof window === "undefined") return [];
  const current = getSavedAccounts();
  const now = Date.now();

  const existingIdx = current.findIndex(
    (a) => a.id === account.id || (account.phone && a.phone === account.phone),
  );

  const existing = existingIdx >= 0 ? current[existingIdx] : null;

  const entry: SavedAccount = {
    id: account.id,
    phone: account.phone,
    email: account.email ?? null,
    name: account.name.trim() || account.phone || "Account",
    avatarUrl: account.avatarUrl ?? null,
    role: account.role,
    token: account.token,
    deviceId: account.deviceId || existing?.deviceId || getDeviceId(),
    deviceSecret: account.deviceSecret || existing?.deviceSecret,
    savedAt: existing ? existing.savedAt : now,
    lastUsedAt: now,
  };

  let next: SavedAccount[];
  if (existingIdx >= 0) {
    next = [...current];
    next[existingIdx] = entry;
  } else {
    next = [entry, ...current];
  }

  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(next));
    notifyChange(next);
  } catch (err) {
    console.error("Failed to save account to localStorage", err);
  }
  return next;
}

export function updateSavedAccountProfile(
  id: number,
  updates: Partial<Pick<SavedAccount, "name" | "avatarUrl" | "role" | "token" | "deviceSecret">>,
): void {
  if (typeof window === "undefined") return;
  const current = getSavedAccounts();
  const idx = current.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const updated = {
    ...current[idx]!,
    ...updates,
    lastUsedAt: Date.now(),
  };
  current[idx] = updated;
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(current));
    notifyChange(current);
  } catch {
    // ignore
  }
}

export function removeSavedAccount(
  id: number,
  options?: { revokeOnServer?: boolean },
): SavedAccount[] {
  if (typeof window === "undefined") return [];
  const current = getSavedAccounts();
  const target = current.find((a) => a.id === id);

  if (target) {
    // Notify server to remove saved device binding and optionally logout session
    try {
      const base = getApiBase().replace(/\/$/, "");
      const deviceId = target.deviceId || getDeviceId();

      // 1. Remove saved device record
      fetch(`${base}/api/auth/remove-saved-device/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: target.id, device_id: deviceId }),
      }).catch(() => {});

      // 2. Revoke active session token if requested
      if (options?.revokeOnServer && target.token) {
        fetch(`${base}/api/auth/logout/`, {
          method: "POST",
          headers: {
            Authorization: `Token ${target.token}`,
            "Content-Type": "application/json",
          },
        }).catch(() => {});
      }
    } catch {
      // ignore network errors on cleanup
    }
  }

  const next = current.filter((a) => a.id !== id);
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(next));
    notifyChange(next);
  } catch (err) {
    console.error("Failed to update saved accounts in localStorage", err);
  }
  return next;
}

export function isAccountSaved(id: number): boolean {
  return getSavedAccounts().some((a) => a.id === id);
}

export function clearSavedAccounts(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SAVED_ACCOUNTS_KEY);
    notifyChange([]);
  } catch {
    // ignore
  }
}

/**
 * React hook that returns the live list of saved accounts on this device,
 * updating automatically when accounts are added or removed.
 */
export function useSavedAccounts(): SavedAccount[] {
  const [accounts, setAccounts] = useState<SavedAccount[]>(() => getSavedAccounts());

  useEffect(() => {
    const update = () => setAccounts(getSavedAccounts());
    window.addEventListener(SAVED_ACCOUNTS_EVENT, update);
    window.addEventListener("storage", update);
    window.addEventListener("mysewa-native-saved-accounts", update);
    return () => {
      window.removeEventListener(SAVED_ACCOUNTS_EVENT, update);
      window.removeEventListener("storage", update);
      window.removeEventListener("mysewa-native-saved-accounts", update);
    };
  }, []);

  return accounts;
}
