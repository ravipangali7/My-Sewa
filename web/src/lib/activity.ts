import type {
  ActivityItem,
  Deposit,
  TopupTransaction,
  BankTransferTransaction,
  WalletTransactions,
} from "./types";
import { OPERATORS } from "./constants";
import type { TranslateFn } from "./i18n";

export function buildActivity(
  tx: WalletTransactions,
  t: TranslateFn = (key) => key,
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...tx.deposits.map((d: Deposit) => ({
      id: `dep-${d.id}`,
      kind: "deposit" as const,
      title: t("activity.remittanceReceived"),
      subtitle:
        d.status === "rejected" && d.rejection_reason
          ? t("activity.rejected", { reason: d.rejection_reason })
          : (d.note ?? t("activity.walletLoad")),
      amount: d.amount,
      credit: true,
      status: d.status,
      created_at: d.created_at,
    })),
    ...tx.topups.map((top: TopupTransaction) => ({
      id: `top-${top.id}`,
      kind: "topup" as const,
      title: t("activity.topUp", {
        operator: top.product_name || OPERATORS[top.product_id],
      }),
      subtitle: top.mobile_number,
      amount: top.total_debited !== "0.00" ? top.total_debited : top.amount,
      credit: false,
      status: top.status,
      created_at: top.created_at,
    })),
    ...tx.bank_transfers.map((b: BankTransferTransaction) => ({
      id: `bt-${b.id}`,
      kind: "transfer" as const,
      title: t("activity.fundTransfer"),
      subtitle: `${b.destination_acc_name} · ${b.destination_bank_name || b.destination_bank}`,
      amount: b.total_debited !== "0.00" ? b.total_debited : b.amount,
      credit: false,
      status: b.status,
      created_at: b.created_at,
    })),
  ];
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
