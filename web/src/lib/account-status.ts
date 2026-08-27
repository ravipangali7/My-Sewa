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

/** Per-user fund transfer access. Missing field is treated as allowed. */
export function canFundTransfer(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  return user.can_fund_transfer !== false;
}

/** Per-user wallet adjustment access. Missing field is treated as allowed. */
export function canWalletAdjust(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  return user.can_wallet_adjust !== false;
}

/** Per-user remittance fund transfer access. Missing field is treated as allowed. */
export function canRemittanceTransfer(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  return user.can_remittance_transfer !== false;
}

/** True when HimalPay deducted but MySewa did not apply — admin must unblock. */
export function isWalletBlocked(wallet: { transactions_blocked?: boolean } | null | undefined): boolean {
  return Boolean(wallet?.transactions_blocked);
}

export function isWalletFrozen(
  wallet?: { is_frozen?: boolean; wallet_status?: string } | null,
  user?: UserProfile | null,
): boolean {
  if (wallet?.is_frozen || wallet?.wallet_status === "frozen") return true;
  return Boolean(user?.wallet_frozen || user?.wallet_status === "frozen");
}

export function isOutboundLocked(
  user: UserProfile | null | undefined,
  wallet?: { transactions_blocked?: boolean; is_frozen?: boolean; wallet_status?: string } | null,
): boolean {
  return isAccountPending(user) || isWalletBlocked(wallet) || isWalletFrozen(wallet, user);
}

export const ACCOUNT_PENDING_MESSAGE =
  "Your account is pending approval. You can browse the app, but remittance, top-up, fund transfer and other transactions stay disabled until an admin activates your account.";
