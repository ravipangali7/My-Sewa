type KycLockSource = {
  kyc_status?: string | null | undefined;
  kyc_verified?: boolean | null | undefined;
  profile_locked?: boolean | null | undefined;
} | null | undefined;

/**
 * True when identity fields must stay read-only after KYC verification.
 * Prefers explicit API flags (`kyc_verified` / `profile_locked`);
 * falls back to `kyc_status === 'approved'|'verified'`.
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
