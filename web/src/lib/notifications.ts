import type { ActivityItem, WalletTransactions } from "./types";
import { buildActivity } from "./activity";
import { formatNPR, formatDateTime } from "./format";

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  amount: string;
  credit: boolean;
  status: ActivityItem["status"];
  kind: ActivityItem["kind"];
  created_at: string;
  unread: boolean;
  details: Array<{ label: string; value: string }>;
}

const READ_KEY = "mysewa_read_notifications";

function readIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(READ_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function markNotificationRead(id: string) {
  if (typeof window === "undefined") return;
  const ids = readIds();
  ids.add(id);
  localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
}

export function markAllNotificationsRead(ids: string[]) {
  if (typeof window === "undefined") return;
  const existing = readIds();
  ids.forEach((id) => existing.add(id));
  localStorage.setItem(READ_KEY, JSON.stringify([...existing]));
}

function detailRows(item: ActivityItem, tx: WalletTransactions): Array<{ label: string; value: string }> {
  if (item.kind === "deposit") {
    const d = tx.deposits.find((x) => `dep-${x.id}` === item.id);
    if (!d) return [];
    return [
      { label: "Type", value: "Remittance / Wallet load" },
      { label: "Amount", value: formatNPR(d.amount) },
      { label: "Status", value: d.status_display || d.status },
      { label: "Note", value: d.note || "—" },
      ...(d.rejection_reason
        ? [{ label: "Rejection reason", value: d.rejection_reason }]
        : []),
      { label: "Date", value: formatDateTime(d.created_at) },
    ];
  }
  if (item.kind === "topup") {
    const t = tx.topups.find((x) => `top-${x.id}` === item.id);
    if (!t) return [];
    return [
      { label: "Type", value: "Mobile top-up" },
      { label: "Operator", value: t.product_name },
      { label: "Mobile", value: t.mobile_number },
      { label: "Amount", value: formatNPR(t.amount) },
      { label: "Charge", value: formatNPR(t.charge) },
      { label: "Cashback", value: formatNPR(t.cashback) },
      { label: "Total debited", value: formatNPR(t.total_debited) },
      { label: "Status", value: t.status_display || t.status },
      { label: "Txn ID", value: t.merchant_txn_id },
      { label: "Date", value: formatDateTime(t.created_at) },
    ];
  }
  const b = tx.bank_transfers.find((x) => `bt-${x.id}` === item.id);
  if (!b) return [];
  return [
    { label: "Type", value: b.is_destination_mobile ? "Phone transfer" : "Bank transfer" },
    { label: "Recipient", value: b.destination_acc_name },
    {
      label: b.is_destination_mobile ? "Phone number" : "Account number",
      value: b.destination_acc_no,
    },
    { label: "Bank", value: b.destination_bank_name || b.destination_bank },
    { label: "Amount", value: formatNPR(b.amount) },
    { label: "Charge", value: formatNPR(b.charge) },
    { label: "Cashback", value: formatNPR(b.cashback) },
    { label: "Total debited", value: formatNPR(b.total_debited) },
    { label: "Remarks", value: b.transaction_remarks || "—" },
    { label: "Status", value: b.status_display || b.status },
    { label: "Txn ID", value: b.merchant_txn_id },
    { label: "Date", value: formatDateTime(b.created_at) },
  ];
}

function notificationCopy(item: ActivityItem): { title: string; body: string } {
  if (item.kind === "deposit") {
    if (item.status === "approved") {
      return {
        title: "Remittance credited",
        body: `${formatNPR(item.amount)} has been added to your MySewa wallet.`,
      };
    }
    if (item.status === "rejected") {
      return {
        title: "Deposit rejected",
        body: item.subtitle || "Your remittance request was rejected.",
      };
    }
    return {
      title: "Deposit under review",
      body: `Your remittance of ${formatNPR(item.amount)} is pending approval.`,
    };
  }
  if (item.kind === "topup") {
    return {
      title: item.status === "failed" ? "Top-up failed" : "Top-up update",
      body: `${item.title} for ${item.subtitle} — ${formatNPR(item.amount)}.`,
    };
  }
  return {
    title: item.status === "failed" ? "Transfer failed" : "Fund transfer update",
    body: `${item.subtitle} — ${formatNPR(item.amount)}.`,
  };
}

export function buildNotifications(tx: WalletTransactions): AppNotification[] {
  const read = readIds();
  return buildActivity(tx).map((item) => {
    const copy = notificationCopy(item);
    return {
      id: item.id,
      title: copy.title,
      body: copy.body,
      amount: item.amount,
      credit: item.credit,
      status: item.status,
      kind: item.kind,
      created_at: item.created_at,
      unread: !read.has(item.id),
      details: detailRows(item, tx),
    };
  });
}

export function findNotification(
  tx: WalletTransactions,
  id: string,
): AppNotification | undefined {
  return buildNotifications(tx).find((n) => n.id === id);
}
