import type { ActivityItem, WalletTransactions } from "./types";
import { buildActivity } from "./activity";
import { formatNPR, formatDateTime } from "./format";
import type { TranslateFn } from "./i18n";
import { translateStatus } from "./status";

export interface NotificationDetailRow {
  label: string;
  value: string;
  /** Long unbroken IDs — wrap with break-all and show a copy control. */
  mono?: boolean;
}

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
  details: NotificationDetailRow[];
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

function pushBalanceDetail(
  rows: NotificationDetailRow[],
  t: TranslateFn,
  before: string | null | undefined,
  after: string | null | undefined,
) {
  if (before != null && before !== "") {
    rows.push({ label: t("history.balanceBefore"), value: formatNPR(before) });
  }
  if (after != null && after !== "") {
    rows.push({ label: t("history.balanceAfter"), value: formatNPR(after) });
  }
}

function detailRows(
  item: ActivityItem,
  tx: WalletTransactions,
  t: TranslateFn,
): NotificationDetailRow[] {
  if (item.kind === "deposit") {
    const d = tx.deposits.find((x) => `dep-${x.id}` === item.id);
    if (!d) return [];
    const rows: NotificationDetailRow[] = [
      { label: t("common.type"), value: t("notif.typeDeposit") },
      { label: t("common.amount"), value: formatNPR(d.amount) },
      { label: t("common.status"), value: translateStatus(d.status, t) },
      { label: t("common.note"), value: d.note || "—" },
      ...(d.rejection_reason
        ? [{ label: t("notif.rejectionReason"), value: d.rejection_reason }]
        : []),
    ];
    pushBalanceDetail(rows, t, d.balance_before, d.balance_after);
    rows.push({ label: t("common.date"), value: formatDateTime(d.created_at) });
    return rows;
  }
  if (item.kind === "remittance") {
    const r = (tx.remittances ?? []).find((x) => `rem-${x.id}` === item.id);
    if (!r) return [];
    const rows: NotificationDetailRow[] = [
      { label: t("common.type"), value: t("notif.typeRemittance") },
      { label: t("remittance.refNo"), value: r.ref_no, mono: true },
      { label: t("remittance.sender"), value: r.sender_name || "—" },
      { label: t("common.amount"), value: formatNPR(r.amount) },
      {
        label: t("history.totalCredited"),
        value: formatNPR(r.total_credited),
      },
      { label: t("common.status"), value: translateStatus(r.status, t) },
      { label: t("common.txnId"), value: r.merchant_txn_id, mono: true },
    ];
    pushBalanceDetail(rows, t, r.balance_before, r.balance_after);
    rows.push({ label: t("common.date"), value: formatDateTime(r.created_at) });
    return rows;
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
      { label: t("common.txnId"), value: top.merchant_txn_id, mono: true },
      { label: t("common.date"), value: formatDateTime(top.created_at) },
    ];
  }
  if (item.kind === "wallet_adjustment") {
    const adj = (tx.wallet_adjustments ?? []).find((x) => `adj-${x.id}` === item.id);
    if (!adj) return [];
    return [
      {
        label: t("common.type"),
        value:
          adj.adjustment_type === "credit"
            ? t("notif.typeManualLoad")
            : t("notif.typeWalletDebit"),
      },
      {
        label: t("history.adjustmentType"),
        value:
          adj.adjustment_type === "credit"
            ? t("notif.manualLoadAddFund")
            : t("activity.walletDebit"),
      },
      { label: t("common.amount"), value: formatNPR(adj.display_amount || adj.amount) },
      { label: t("history.balanceBefore"), value: formatNPR(adj.balance_before) },
      { label: t("history.balanceAfter"), value: formatNPR(adj.balance_after) },
      { label: t("common.note"), value: adj.reason || "—" },
      { label: t("common.date"), value: formatDateTime(adj.created_at) },
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
    { label: t("common.txnId"), value: b.merchant_txn_id, mono: true },
    { label: t("common.date"), value: formatDateTime(b.created_at) },
  ];
}

function notificationCopy(
  item: ActivityItem,
  t: TranslateFn,
  tx?: WalletTransactions,
): { title: string; body: string } {
  if (item.kind === "deposit") {
    if (item.status === "approved") {
      return {
        title: t("notif.depositCredited"),
        body: t("notif.depositCreditedBody", {
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
  if (item.kind === "wallet_adjustment") {
    const adj = tx?.wallet_adjustments?.find((x) => `adj-${x.id}` === item.id);
    const isCredit = adj?.adjustment_type === "credit" || item.credit;
    return {
      title: isCredit ? t("notif.manualLoadAddFund") : t("notif.walletDebitTitle"),
      body: t("notif.walletAdjustmentBody", {
        amount: formatNPR(item.amount),
        note: item.subtitle || "—",
      }),
    };
  }
  if (item.kind === "water" || item.kind === "electricity" || item.kind === "community_electricity" || item.kind === "internet" || item.kind === "data_pack") {
    return {
      title:
        item.status === "failed"
          ? t("notif.utilityFailed", { title: item.title })
          : t("notif.utilityUpdate", { title: item.title }),
      body: t("notif.utilityBody", {
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
      amount: formatNPR(item.amount),
    }),
  };
}

export function buildNotifications(
  tx: WalletTransactions,
  t: TranslateFn = (key) => key,
): AppNotification[] {
  const read = readIds();
  return buildActivity(tx, t).map((item) => {
    const copy = notificationCopy(item, t, tx);
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
