import type { UserProfile } from "./types";

/** Backend stores Active accounts as `approved`. */
export type AccountStatus = "pending" | "approved";

export function isAccountActive(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  if (user.is_staff || user.is_superuser) return true;
  return (user.account_status ?? "approved") === "approved";
}

export function isAccountPending(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  if (user.is_staff || user.is_superuser) return false;
  return (user.account_status ?? "approved") === "pending";
}

export const ACCOUNT_PENDING_MESSAGE =
  "Your account is pending approval. You can browse the app, but remittance, top-up, fund transfer and other transactions stay disabled until an admin activates your account.";
