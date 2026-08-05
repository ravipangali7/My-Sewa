import type { UserProfile } from "./types";

/** Values aligned with CustomUser.KYC_STATUS_* on the server. */
export type KycStatus =
  | "not_submitted"
  | "pending"
  | "approved"
  | "rejected"
  | "verified";

type KycLockSource = Pick<
  UserProfile,
  "kyc_status" | "kyc_verified" | "profile_locked"
> | null | undefined;

/**
 * True when identity fields must stay read-only after KYC verification.
 * Prefers explicit API flags; falls back to `kyc_status === 'approved'|'verified'`.
 */
export function isKycVerified(user: KycLockSource): boolean {
  if (!user) return false;
  if (user.kyc_verified === true || user.profile_locked === true) return true;
  const status = (user.kyc_status || "").toLowerCase();
  return status === "approved" || status === "verified";
}

/** Alias used by profile / KYC document UIs for protected identity fields. */
export function isIdentityLocked(user: KycLockSource): boolean {
  return isKycVerified(user);
}
