import type { ActivityItem, WalletTransactions } from "./types";
import { buildActivity } from "./activity";
import { formatNPR, formatDateTime } from "./format";
import type { TranslateFn } from "./i18n";
import { translateStatus } from "./status";

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

function detailRows(
  item: ActivityItem,
  tx: WalletTransactions,
  t: TranslateFn,
): Array<{ label: string; value: string }> {
  if (item.kind === "deposit") {
    const d = tx.deposits.find((x) => `dep-${x.id}` === item.id);
    if (!d) return [];
    return [
      { label: t("common.type"), value: t("notif.typeDeposit") },
      { label: t("common.amount"), value: formatNPR(d.amount) },
      { label: t("common.status"), value: translateStatus(d.status, t) },
      { label: t("common.note"), value: d.note || "—" },
      ...(d.rejection_reason
        ? [{ label: t("notif.rejectionReason"), value: d.rejection_reason }]
        : []),
      { label: t("common.date"), value: formatDateTime(d.created_at) },
    ];
  }
  if (item.kind === "remittance") {
    const r = (tx.remittances ?? []).find((x) => `rem-${x.id}` === item.id);
    if (!r) return [];
    return [
      { label: t("common.type"), value: t("notif.typeRemittance") },
      { label: t("remittance.refNo"), value: r.ref_no },
      { label: t("remittance.sender"), value: r.sender_name || "—" },
      { label: t("common.amount"), value: formatNPR(r.amount) },
      {
        label: t("history.totalCredited"),
        value: formatNPR(r.total_credited),
      },
      { label: t("common.status"), value: translateStatus(r.status, t) },
      { label: t("common.txnId"), value: r.merchant_txn_id },
      { label: t("common.date"), value: formatDateTime(r.created_at) },
    ];
  }
  if (item.kind === "topup") {
    const top = tx.topups.find((x) => `top-${x.id}` === item.id);
    if (!top) return [];
    return [
      { label: t("common.type"), value: t("notif.typeTopup") },
      { label: t("common.operator"), value: top.product_name },
      { label: t("common.mobile"), value: top.mobile_number },
      { label: t("common.amount"), value: formatNPR(top.amount) },
      { label: t("common.charge"), value: formatNPR(top.charge) },
      { label: t("common.cashback"), value: formatNPR(top.cashback) },
      { label: t("common.totalDebited"), value: formatNPR(top.total_debited) },
      { label: t("common.status"), value: translateStatus(top.status, t) },
      { label: t("common.txnId"), value: top.merchant_txn_id },
      { label: t("common.date"), value: formatDateTime(top.created_at) },
    ];
  }
  const b = tx.bank_transfers.find((x) => `bt-${x.id}` === item.id);
  if (!b) return [];
  return [
    {
      label: t("common.type"),
      value: b.is_destination_mobile
        ? t("notif.typePhoneTransfer")
        : t("notif.typeBankTransfer"),
    },
    { label: t("common.recipient"), value: b.destination_acc_name },
    {
      label: b.is_destination_mobile
        ? t("common.phoneNumber")
        : t("common.accountNumber"),
      value: b.destination_acc_no,
    },
    { label: t("common.bank"), value: b.destination_bank_name || b.destination_bank },
    { label: t("common.amount"), value: formatNPR(b.amount) },
    { label: t("common.charge"), value: formatNPR(b.charge) },
    { label: t("common.cashback"), value: formatNPR(b.cashback) },
    { label: t("common.totalDebited"), value: formatNPR(b.total_debited) },
    { label: t("common.remarks"), value: b.transaction_remarks || "—" },
    { label: t("common.status"), value: translateStatus(b.status, t) },
    { label: t("common.txnId"), value: b.merchant_txn_id },
    { label: t("common.date"), value: formatDateTime(b.created_at) },
  ];
}

function notificationCopy(
  item: ActivityItem,
  t: TranslateFn,
): { title: string; body: string } {
  if (item.kind === "deposit") {
    if (item.status === "approved") {
      return {
        title: t("notif.remittanceCredited"),
        body: t("notif.remittanceCreditedBody", {
          amount: formatNPR(item.amount),
        }),
      };
    }
    if (item.status === "rejected") {
      return {
        title: t("notif.depositRejected"),
        body: item.subtitle || t("notif.depositRejectedBody"),
      };
    }
    return {
      title: t("notif.depositReview"),
      body: t("notif.depositReviewBody", { amount: formatNPR(item.amount) }),
    };
  }
  if (item.kind === "remittance") {
    if (item.status === "success") {
      return {
        title: t("notif.remittanceCredited"),
        body: t("notif.remittanceCreditedBody", {
          amount: formatNPR(item.amount),
        }),
      };
    }
    if (item.status === "failed") {
      return {
        title: t("remittance.failed"),
        body: t("notif.remittanceFailedBody", {
          subtitle: item.subtitle,
          amount: formatNPR(item.amount),
        }),
      };
    }
    return {
      title: t("notif.remittancePending"),
      body: t("notif.remittancePendingBody", {
        subtitle: item.subtitle,
        amount: formatNPR(item.amount),
      }),
    };
  }
  if (item.kind === "topup") {
    return {
      title:
        item.status === "failed" ? t("notif.topupFailed") : t("notif.topupUpdate"),
      body: t("notif.topupBody", {
        title: item.title,
        subtitle: item.subtitle,
        amount: formatNPR(item.amount),
      }),
    };
  }
  return {
    title:
      item.status === "failed"
        ? t("notif.transferFailed")
        : t("notif.transferUpdate"),
    body: t("notif.transferBody", {
      subtitle: item.subtitle,
      amount:
        item.charge && Number(item.charge) > 0
          ? `${formatNPR(item.amount)} + ${formatNPR(item.charge)}`
          : formatNPR(item.amount),
    }),
  };
}

export function buildNotifications(
  tx: WalletTransactions,
  t: TranslateFn = (key) => key,
): AppNotification[] {
  const read = readIds();
  return buildActivity(tx, t).map((item) => {
    const copy = notificationCopy(item, t);
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
      details: detailRows(item, tx, t),
    };
  });
}

export function findNotification(
  tx: WalletTransactions,
  id: string,
  t: TranslateFn = (key) => key,
): AppNotification | undefined {
  return buildNotifications(tx, t).find((n) => n.id === id);
}
