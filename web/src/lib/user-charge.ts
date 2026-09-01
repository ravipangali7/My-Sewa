import type { TranslateFn } from "./i18n";
import type { MessageKey } from "./i18n/messages";

/** Extra the user pays on top of the principal (service charge + HimalPay). */
export function userFacingChargeExtra(opts: {
  amount?: string | number | null | undefined;
  charge?: string | number | null | undefined;
  cashback?: string | number | null | undefined;
  totalDebited?: string | number | null | undefined;
}): number {
  const amount = Number(opts.amount) || 0;
  const total = Number(opts.totalDebited);
  if (Number.isFinite(total) && total > 0) {
    const extra = total - amount;
    return extra > 0.004 ? extra : 0;
  }
  const extra = (Number(opts.charge) || 0) + (Number(opts.cashback) || 0);
  return extra > 0.004 ? extra : 0;
}

export const USER_SERVICE_CHARGE_KEYS: MessageKey[] = [
  "transfer.charge",
  "transfer.walletCharge",
  "topup.serviceCharge",
  "dataTopup.serviceCharge",
  "internet.serviceCharge",
  "water.serviceCharge",
  "electricity.serviceCharge",
  "communityElectricity.serviceCharge",
  "common.charge",
];

export function userServiceChargeLabels(t: TranslateFn): string[] {
  return USER_SERVICE_CHARGE_KEYS.map((key) => t(key));
}
