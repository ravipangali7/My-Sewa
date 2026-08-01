import { ACCOUNT_PENDING_MESSAGE } from "@/lib/account-status";

/** Compact notice shown on transaction screens when account is still Pending. */
export function AccountPendingBanner() {
  return (
    <div
      role="status"
      className="rounded-2xl border border-[#F59E0B]/35 bg-[#FFFBEB] px-3.5 py-3 text-[13px] leading-snug text-[#92400E]"
    >
      {ACCOUNT_PENDING_MESSAGE}
    </div>
  );
}
