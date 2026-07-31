import type {
  ActivityItem,
  Deposit,
  TopupTransaction,
  BankTransferTransaction,
  WalletTransactions,
} from "./types";
import { OPERATORS } from "./constants";

export function buildActivity(tx: WalletTransactions): ActivityItem[] {
  const items: ActivityItem[] = [
    ...tx.deposits.map((d: Deposit) => ({
      id: `dep-${d.id}`,
      kind: "deposit" as const,
      title: "Remittance Received",
      subtitle:
        d.status === "rejected" && d.rejection_reason
          ? `Rejected: ${d.rejection_reason}`
          : (d.note ?? "Wallet load"),
      amount: d.amount,
      credit: true,
      status: d.status,
      created_at: d.created_at,
    })),
    ...tx.topups.map((t: TopupTransaction) => ({
      id: `top-${t.id}`,
      kind: "topup" as const,
      title: `${t.product_name || OPERATORS[t.product_id]} Top-Up`,
      subtitle: t.mobile_number,
      amount: t.total_debited !== "0.00" ? t.total_debited : t.amount,
      credit: false,
      status: t.status,
      created_at: t.created_at,
    })),
    ...tx.bank_transfers.map((b: BankTransferTransaction) => ({
      id: `bt-${b.id}`,
      kind: "transfer" as const,
      title: "Fund Transfer",
      subtitle: `${b.destination_acc_name} · ${b.destination_bank_name || b.destination_bank}`,
      amount: b.total_debited !== "0.00" ? b.total_debited : b.amount,
      credit: false,
      status: b.status,
      created_at: b.created_at,
    })),
  ];
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
