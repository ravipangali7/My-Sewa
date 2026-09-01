import type { ActivityItem, WalletTransactions } from "./types";
import { buildActivity, formatTdsRate, hasTdsCharge } from "./activity";
import { formatNPR, formatDateTime } from "./format";
import type { TranslateFn } from "./i18n";
import { userFacingChargeExtra } from "./user-charge";
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

function chargeBreakdownRows(
  t: TranslateFn,
  opts: {
    amount: string;
    charge?: string | null | undefined;
    cashback?: string | null | undefined;
    totalDebited?: string | null | undefined;
    chargeLabel: string;
  },
): NotificationDetailRow[] {
  const rows: NotificationDetailRow[] = [
    { label: t("common.amount"), value: formatNPR(opts.amount) },
  ];
  const extra = userFacingChargeExtra(opts);
  if (extra > 0) {
    rows.push({ label: opts.chargeLabel, value: formatNPR(extra) });
  }
  if (opts.totalDebited != null && String(opts.totalDebited).trim() !== "") {
    rows.push({ label: t("common.totalDebited"), value: formatNPR(opts.totalDebited) });
  }
  return rows;
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
      ...chargeBreakdownRows(t, {
        amount: top.amount,
        charge: top.charge,
        cashback: top.cashback,
        totalDebited: top.total_debited,
        chargeLabel: t("topup.serviceCharge"),
      }),
      { label: t("common.status"), value: translateStatus(top.status, t) },
      { label: t("common.txnId"), value: top.merchant_txn_id, mono: true },
      { label: t("common.date"), value: formatDateTime(top.created_at) },
    ];
  }
  if (item.kind === "wallet_adjustment") {
    const adj = (tx.wallet_adjustments ?? []).find((x) => `adj-${x.id}` === item.id);
    if (!adj) return [];
    const isDealerCommission = adj.kind === "dealer_commission";
    const isCashback = adj.kind === "cashback";
    const isSystemCharge = adj.kind === "system_charge";
    const typeValue = isDealerCommission
      ? t("activity.dealerCommission")
      : isSystemCharge
        ? t("activity.systemCharge")
        : isCashback
        ? adj.adjustment_type === "credit"
          ? t("activity.cashbackReturn")
          : t("activity.cashbackCharge")
        : adj.adjustment_type === "credit"
          ? t("notif.typeManualLoad")
          : t("notif.typeWalletDebit");
    const rows: NotificationDetailRow[] = [
      { label: t("common.type"), value: typeValue },
      {
        label: t("history.adjustmentType"),
        value: isDealerCommission
          ? t("activity.dealerCommission")
          : isCashback
            ? typeValue
            : adj.adjustment_type === "credit"
              ? t("notif.manualLoadAddFund")
              : t("activity.walletDebit"),
      },
    ];
    if (isDealerCommission && hasTdsCharge(adj) && adj.gross_commission) {
      const rate = formatTdsRate(adj.tds_rate);
      rows.push({ label: t("history.grossCommission"), value: formatNPR(adj.gross_commission) });
      rows.push({
        label: rate ? t("history.tdsChargeRate", { rate }) : t("history.tdsCharge"),
        value: formatNPR(adj.tds_amount),
      });
      rows.push({
        label: t("history.netCommissionCredited"),
        value: formatNPR(adj.net_commission || adj.display_amount || adj.amount),
      });
    }
    rows.push(
      { label: t("common.amount"), value: formatNPR(adj.display_amount || adj.amount) },
      { label: t("history.balanceBefore"), value: formatNPR(adj.balance_before) },
      { label: t("history.balanceAfter"), value: formatNPR(adj.balance_after) },
      { label: t("common.note"), value: adj.reason || "—" },
      { label: t("common.date"), value: formatDateTime(adj.created_at) },
    );
    return rows;
  }
  if (item.kind === "wallet_transfer") {
    const wt = (tx.wallet_transfers ?? []).find((x) => `wt-${x.id}` === item.id);
    if (!wt) return [];
    const received = wt.direction === "received";
    return [
      {
        label: t("common.type"),
        value: received
          ? t("activity.walletTransferReceived")
          : t("activity.walletTransferSent"),
      },
      {
        label: received ? t("transfer.walletFrom") : t("transfer.walletTo"),
        value: wt.counterparty_name
          ? `${wt.counterparty_name} · ${wt.counterparty_phone}`
          : wt.counterparty_phone,
      },
      { label: t("common.amount"), value: formatNPR(wt.amount) },
      ...(received
        ? []
        : chargeBreakdownRows(t, {
            amount: wt.amount,
            charge: wt.charge,
            cashback: wt.cashback,
            totalDebited: wt.total_debited,
            chargeLabel: t("transfer.walletCharge"),
          }).filter((row) => row.label !== t("common.amount"))),
      { label: t("common.status"), value: translateStatus(wt.status, t) },
      { label: t("common.remarks"), value: wt.remarks || "—" },
      { label: t("common.txnId"), value: wt.reference, mono: true },
      { label: t("common.date"), value: formatDateTime(wt.created_at) },
    ];
  }
  if (item.kind === "internet") {
    const bill = (tx.internet_bills ?? []).find((x) => `isp-${x.id}` === item.id);
    if (!bill) return [];
    return [
      { label: t("common.type"), value: t("activity.internetBill", { isp: bill.isp_name }) },
      { label: t("internet.isp"), value: bill.isp_name },
      { label: t("internet.customerId"), value: bill.customer_id, mono: true },
      ...chargeBreakdownRows(t, {
        amount: bill.amount,
        charge: bill.charge,
        cashback: bill.cashback,
        totalDebited: bill.total_debited,
        chargeLabel: t("internet.serviceCharge"),
      }),
      { label: t("common.status"), value: translateStatus(bill.status, t) },
      { label: t("common.date"), value: formatDateTime(bill.created_at) },
    ];
  }
  if (item.kind === "data_pack") {
    const dp = (tx.data_packs ?? []).find((x) => `data-${x.id}` === item.id);
    if (!dp) return [];
    return [
      { label: t("common.type"), value: t("activity.dataPack", { operator: dp.operator }) },
      { label: t("common.operator"), value: dp.operator },
      { label: t("common.mobile"), value: dp.mobile_number },
      ...chargeBreakdownRows(t, {
        amount: dp.amount,
        charge: dp.charge,
        cashback: dp.cashback,
        totalDebited: dp.total_debited,
        chargeLabel: t("dataTopup.serviceCharge"),
      }),
      { label: t("common.status"), value: translateStatus(dp.status, t) },
      { label: t("common.date"), value: formatDateTime(dp.created_at) },
    ];
  }
  if (item.kind === "water") {
    const bill = (tx.water_bills ?? []).find((x) => `water-${x.id}` === item.id);
    if (!bill) return [];
    return [
      { label: t("common.type"), value: t("activity.waterBill") },
      { label: t("water.connectionNo"), value: bill.connection_no, mono: true },
      ...chargeBreakdownRows(t, {
        amount: bill.amount,
        charge: bill.charge,
        cashback: bill.cashback,
        totalDebited: bill.total_debited,
        chargeLabel: t("water.serviceCharge"),
      }),
      { label: t("common.status"), value: translateStatus(bill.status, t) },
      { label: t("common.date"), value: formatDateTime(bill.created_at) },
    ];
  }
  if (item.kind === "electricity") {
    const bill = (tx.electricity_bills ?? []).find((x) => `nea-${x.id}` === item.id);
    if (!bill) return [];
    return [
      { label: t("common.type"), value: t("activity.electricityBill") },
      { label: t("electricity.scNumber"), value: bill.sc_no, mono: true },
      { label: t("electricity.consumerId"), value: bill.consumer_id, mono: true },
      ...chargeBreakdownRows(t, {
        amount: bill.amount,
        charge: bill.charge,
        cashback: bill.cashback,
        totalDebited: bill.total_debited,
        chargeLabel: t("electricity.serviceCharge"),
      }),
      { label: t("common.status"), value: translateStatus(bill.status, t) },
      { label: t("common.date"), value: formatDateTime(bill.created_at) },
    ];
  }
  if (item.kind === "community_electricity") {
    const bill = (tx.community_electricity ?? []).find((x) => `ce-${x.id}` === item.id);
    if (!bill) return [];
    return [
      {
        label: t("common.type"),
        value: t("activity.communityElectricity", { provider: bill.platform_name }),
      },
      { label: t("communityElectricity.provider"), value: bill.platform_name },
      ...chargeBreakdownRows(t, {
        amount: bill.amount,
        charge: bill.charge,
        cashback: bill.cashback,
        totalDebited: bill.total_debited,
        chargeLabel: t("communityElectricity.serviceCharge"),
      }),
      { label: t("common.status"), value: translateStatus(bill.status, t) },
      { label: t("common.date"), value: formatDateTime(bill.created_at) },
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
    ...chargeBreakdownRows(t, {
      amount: b.amount,
      charge: b.charge,
      cashback: b.cashback,
      totalDebited: b.total_debited,
      chargeLabel: t("transfer.charge"),
    }),
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
    const isDealerCommission = adj?.kind === "dealer_commission";
    const isCashback = adj?.kind === "cashback";
    const isSystemCharge = adj?.kind === "system_charge";
    const isCredit = adj?.adjustment_type === "credit" || item.credit;
    if (isSystemCharge) {
      return {
        title: t("activity.systemCharge"),
        body: t("notif.walletAdjustmentBody", {
          amount: formatNPR(item.amount),
          note: item.subtitle || adj?.reason || "—",
        }),
      };
    }
    if (isDealerCommission) {
      return {
        title: t("activity.dealerCommission"),
        body: item.subtitle
          ? t("notif.walletAdjustmentBody", {
              amount: formatNPR(item.amount),
              note: item.subtitle,
            })
          : t("notif.walletAdjustmentBody", {
              amount: formatNPR(item.amount),
              note: adj?.reason || "—",
            }),
      };
    }
    if (isCashback) {
      return {
        title: isCredit ? t("activity.cashbackReturn") : t("activity.cashbackCharge"),
        body: t("notif.walletAdjustmentBody", {
          amount: formatNPR(item.amount),
          note: item.subtitle || adj?.reason || "—",
        }),
      };
    }
    return {
      title: isCredit ? t("notif.manualLoadAddFund") : t("notif.walletDebitTitle"),
      body: t("notif.walletAdjustmentBody", {
        amount: formatNPR(item.amount),
        note: item.subtitle || "—",
      }),
    };
  }
  if (item.kind === "wallet_transfer") {
    const received = item.credit;
    return {
      title: received
        ? t("activity.walletTransferReceived")
        : t("activity.walletTransferSent"),
      body: t("notif.walletTransferBody", {
        subtitle: item.subtitle,
        amount: formatNPR(item.amount),
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
