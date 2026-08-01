export const OPERATORS: Record<1 | 2, string> = { 1: "NTC", 2: "NCELL" };

/** Nepal NTC prepaid/postpaid prefixes */
export const NTC_PREFIXES = ["984", "985", "986", "974", "975", "976"] as const;

/** Nepal Ncell prefixes */
export const NCELL_PREFIXES = ["980", "981", "982", "970"] as const;

/**
 * Normalize a Nepal mobile input to 10 local digits (strip +977 / 977).
 */
export function normalizeNepalMobile(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("977") && digits.length >= 13) {
    digits = digits.slice(3);
  }
  return digits;
}

/**
 * Returns null when the number looks valid for the operator,
 * or "Invalid Number" when the prefix does not match.
 * Incomplete numbers (under 10 digits) return null so the UI can stay quiet while typing.
 */
export function validateOperatorMobile(
  productId: 1 | 2,
  value: string,
): "Invalid Number" | null {
  const digits = normalizeNepalMobile(value);
  if (digits.length < 10) return null;
  const local = digits.slice(-10);
  if (local.length !== 10) return "Invalid Number";
  const prefixes = productId === 1 ? NTC_PREFIXES : NCELL_PREFIXES;
  const ok = prefixes.some((p) => local.startsWith(p));
  return ok ? null : "Invalid Number";
}

export const TOKEN_KEY = "mysewa_token";
