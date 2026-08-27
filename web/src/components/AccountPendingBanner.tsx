import { useAuth } from "@/lib/auth";
import { isAccountPending, isWalletBlocked, isWalletFrozen } from "@/lib/account-status";
import { useT } from "@/lib/i18n";

/** Compact notice when the account is pending or the wallet is locked. */
export function AccountPendingBanner() {
  const t = useT();
  const { user, wallet } = useAuth();
  const pending = isAccountPending(user);
  const blocked = isWalletBlocked(wallet);
  const frozen = isWalletFrozen(wallet, user);

  if (!pending && !blocked && !frozen) return null;

  return (
    <div className="space-y-2">
      {pending ? (
        <div
          role="status"
          className="rounded-2xl border border-[#F59E0B]/35 bg-[#FFFBEB] px-3.5 py-3 text-[13px] leading-snug text-[#92400E]"
        >
          {t("account.pending")}
        </div>
      ) : null}
      {frozen ? (
        <div
          role="status"
          className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-[13px] leading-snug text-destructive"
        >
          {wallet?.freeze_reason?.trim() || t("account.walletFrozen")}
        </div>
      ) : null}
      {blocked && !frozen ? (
        <div
          role="status"
          className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-[13px] leading-snug text-destructive"
        >
          {wallet?.blocked_reason?.trim() || t("account.walletBlocked")}
        </div>
      ) : null}
    </div>
  );
}
