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
  savedAt: number;
  lastUsedAt: number;
}

const SAVED_ACCOUNTS_EVENT = "mysewa_saved_accounts_changed";

function notifyChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SAVED_ACCOUNTS_EVENT));
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
}): SavedAccount[] {
  if (typeof window === "undefined") return [];
  const current = getSavedAccounts();
  const now = Date.now();

  const existingIdx = current.findIndex(
    (a) => a.id === account.id || (account.phone && a.phone === account.phone),
  );

  const entry: SavedAccount = {
    id: account.id,
    phone: account.phone,
    email: account.email ?? null,
    name: account.name.trim() || account.phone || "Account",
    avatarUrl: account.avatarUrl ?? null,
    role: account.role,
    token: account.token,
    savedAt: existingIdx >= 0 ? current[existingIdx]!.savedAt : now,
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
    notifyChange();
  } catch (err) {
    console.error("Failed to save account to localStorage", err);
  }
  return next;
}

export function updateSavedAccountProfile(
  id: number,
  updates: Partial<Pick<SavedAccount, "name" | "avatarUrl" | "role">>,
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
    notifyChange();
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

  if (options?.revokeOnServer && target?.token) {
    // Best-effort remote revocation
    try {
      const base = getApiBase();
      const url = `${base.replace(/\/$/, "")}/api/auth/logout/`;
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${target.token}`,
          "Content-Type": "application/json",
        },
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  const next = current.filter((a) => a.id !== id);
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(next));
    notifyChange();
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
    notifyChange();
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
    return () => {
      window.removeEventListener(SAVED_ACCOUNTS_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);

  return accounts;
}
