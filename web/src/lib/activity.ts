import type {
  ActivityItem,
  ActivityKind,
  Deposit,
  RemittanceTransaction,
  TopupTransaction,
  BankTransferTransaction,
  InternetBillTransaction,
  DataPackTransaction,
  WalletAdjustment,
  WalletTransactions,
} from "./types";
import { OPERATORS } from "./constants";
import type { TranslateFn } from "./i18n";
import { formatNPR, formatDateTime } from "./format";
import { translateStatus } from "./status";

export type { ActivityKind };

export type ActivityDirection = "credit" | "debit";

const DEBIT_KINDS = new Set<ActivityKind>([
  "topup",
  "transfer",
  "internet",
  "data_pack",
  "wallet_adjustment",
]);

function adjustmentDisplayAmount(a: WalletAdjustment): string {
  if (a.display_amount !== undefined && a.display_amount !== null) {
    return String(a.display_amount);
  }
  const n = Math.abs(Number(a.amount));
  return Number.isNaN(n) ? a.amount : String(n);
}

export function buildActivity(
  tx: WalletTransactions,
  t: TranslateFn = (key) => key,
): ActivityItem[] {
  const remittances = tx.remittances ?? [];
  const adjustments = tx.wallet_adjustments ?? [];
  const items: ActivityItem[] = [
    ...tx.deposits.map((d: Deposit) => ({
      id: `dep-${d.id}`,
      kind: "deposit" as const,
      title: t("activity.walletLoad"),
      subtitle:
        d.status === "rejected" && d.rejection_reason
          ? t("activity.rejected", { reason: d.rejection_reason })
          : (d.note ?? t("activity.walletLoad")),
      amount: d.amount,
      credit: true,
      status: d.status,
      created_at: d.created_at,
    })),
    ...remittances.map((r: RemittanceTransaction) => ({
      id: `rem-${r.id}`,
      kind: "remittance" as const,
      title: t("activity.remittanceReceived"),
      subtitle: r.sender_name
        ? `${r.ref_no} · ${r.sender_name}`
        : r.ref_no,
      amount: r.total_credited !== "0.00" ? r.total_credited : r.amount,
      credit: true,
      status: r.status,
      created_at: r.created_at,
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
      // Show amount + charge as one total (e.g. 105), never "100 + 5".
      amount: b.total_debited !== "0.00" ? b.total_debited : b.amount,
      credit: false,
      status: b.status,
      created_at: b.created_at,
    })),
    ...(tx.internet_bills ?? []).map((bill: InternetBillTransaction) => ({
      id: `isp-${bill.id}`,
      kind: "internet" as const,
      title: t("activity.internetBill", { isp: bill.isp_name }),
      subtitle: bill.customer_id,
      amount: bill.total_debited !== "0.00" ? bill.total_debited : bill.amount,
      credit: false,
      status: bill.status,
      created_at: bill.created_at,
    })),
    ...(tx.data_packs ?? []).map((dp: DataPackTransaction) => ({
      id: `data-${dp.id}`,
      kind: "data_pack" as const,
      title: t("activity.dataPack", { operator: dp.operator }),
      subtitle: dp.mobile_number,
      amount: dp.total_debited !== "0.00" ? dp.total_debited : dp.amount,
      credit: false,
      status: dp.status,
      created_at: dp.created_at,
    })),
    ...adjustments.map((a: WalletAdjustment) => {
      const isCredit = a.adjustment_type === "credit";
      return {
        id: `adj-${a.id}`,
        kind: "wallet_adjustment" as const,
        title: isCredit
          ? t("activity.walletCredit")
          : t("activity.walletDebit"),
        subtitle:
          a.reason?.trim() || a.reference || t("activity.walletAdjustment"),
        amount: adjustmentDisplayAmount(a),
        credit: isCredit,
        status: "success" as const,
        created_at: a.created_at,
      };
    }),
  ];
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** True when the item should appear in wallet Credit History. */
export function isWalletCredit(item: ActivityItem): boolean {
  if (!item.credit) return false;
  if (item.kind === "deposit") return item.status === "approved";
  if (item.kind === "remittance") return item.status === "success";
  if (item.kind === "wallet_adjustment") return true;
  return false;
}

/** True when the item should appear in wallet Debit History. */
export function isWalletDebit(item: ActivityItem): boolean {
  if (item.credit) return false;
  return DEBIT_KINDS.has(item.kind);
}

export function activityDirection(item: ActivityItem): ActivityDirection | null {
  if (isWalletCredit(item)) return "credit";
  if (isWalletDebit(item)) return "debit";
  return null;
}

export function filterWalletCredits(items: ActivityItem[]): ActivityItem[] {
  return items.filter(isWalletCredit);
}

export function filterWalletDebits(items: ActivityItem[]): ActivityItem[] {
  return items.filter(isWalletDebit);
}

export function findActivity(
  tx: WalletTransactions,
  id: string,
  t: TranslateFn = (key) => key,
): ActivityItem | undefined {
  return buildActivity(tx, t).find((item) => item.id === id);
}

export type StatementRow = { label: string; value: string; mono?: boolean; danger?: boolean };

export interface ActivityStatement {
  item: ActivityItem;
  reference: string;
  headlineAmount: string;
  amountCaption: string;
  /** Flat receipt rows (label left / value right), matching the statement view layout. */
  details: StatementRow[];
  proofUrl?: string | null;
  footer: string;
}

function pushDetail(
  rows: StatementRow[],
  label: string,
  value: string | null | undefined,
  opts?: { mono?: boolean; danger?: boolean; skipEmpty?: boolean },
) {
  const trimmed = value?.trim();
  if (opts?.skipEmpty && (!trimmed || trimmed === "—")) return;
  const row: StatementRow = { label, value: trimmed || "—" };
  if (opts?.mono) row.mono = true;
  if (opts?.danger) row.danger = true;
  rows.push(row);
}

function pushBalanceRows(
  rows: StatementRow[],
  t: TranslateFn,
  balanceBefore: string | null | undefined,
  balanceAfter: string | null | undefined,
) {
  if (balanceBefore != null && String(balanceBefore).trim() !== "") {
    pushDetail(rows, t("history.balanceBefore"), formatNPR(balanceBefore));
  }
  if (balanceAfter != null && String(balanceAfter).trim() !== "") {
    pushDetail(rows, t("history.balanceAfter"), formatNPR(balanceAfter));
  }
}

export function buildActivityStatement(
  tx: WalletTransactions,
  id: string,
  t: TranslateFn = (key) => key,
  initiator?: string,
): ActivityStatement | undefined {
  const item = findActivity(tx, id, t);
  if (!item) return undefined;

  if (item.kind === "deposit") {
    const d = tx.deposits.find((x) => `dep-${x.id}` === id);
    if (!d) return undefined;
    const reference = `#${d.id}`;
    const details: StatementRow[] = [];
    pushDetail(details, t("history.referenceCode"), reference, { mono: true });
    pushDetail(details, t("history.dateTime"), formatDateTime(d.created_at));
    pushDetail(details, t("history.channel"), t("history.channelOnline"));
    pushDetail(details, t("history.serviceName"), t("notif.typeDeposit"));
    pushDetail(details, t("common.status"), translateStatus(d.status, t));
    pushDetail(details, t("common.amountNpr"), formatNPR(d.amount));
    pushDetail(details, t("common.note"), d.note?.trim() || "—");
    if (d.rejection_reason) {
      pushDetail(details, t("history.rejection"), d.rejection_reason, {
        danger: true,
      });
    }
    pushBalanceRows(details, t, d.balance_before, d.balance_after);
    pushDetail(details, t("history.updated"), formatDateTime(d.updated_at));
    pushDetail(details, t("history.initiator"), initiator, { skipEmpty: true });
    return {
      item,
      reference,
      headlineAmount: formatNPR(d.amount),
      amountCaption: t("history.walletCredit"),
      proofUrl: d.screenshot_proof,
      footer: t("history.footer"),
      details,
    };
  }

  if (item.kind === "remittance") {
    const r = (tx.remittances ?? []).find((x) => `rem-${x.id}` === id);
    if (!r) return undefined;
    const reference = r.ref_no || r.merchant_txn_id || `#${r.id}`;
    const details: StatementRow[] = [];
    pushDetail(details, t("history.referenceCode"), reference, { mono: true });
    pushDetail(details, t("history.dateTime"), formatDateTime(r.created_at));
    pushDetail(details, t("history.channel"), t("history.channelOnline"));
    pushDetail(details, t("history.serviceName"), t("notif.typeRemittance"));
    pushDetail(details, t("common.status"), translateStatus(r.status, t));
    pushDetail(details, t("remittance.sender"), r.sender_name || "—");
    pushDetail(details, t("remittance.receiver"), r.receiver_name || "—");
    pushDetail(details, t("remittance.receiverPhone"), r.receiver_phone || "—");
    pushDetail(details, t("remittance.purpose"), r.remittance_purpose, {
      skipEmpty: true,
    });
    pushDetail(details, t("common.amountNpr"), formatNPR(r.amount));
    pushDetail(details, t("common.charge"), formatNPR(r.charge));
    pushDetail(details, t("common.cashback"), formatNPR(r.cashback));
    pushDetail(details, t("history.totalCredited"), formatNPR(r.total_credited));
    pushBalanceRows(details, t, r.balance_before, r.balance_after);
    pushDetail(details, t("history.merchantTxn"), r.merchant_txn_id, {
      mono: true,
      skipEmpty: true,
    });
    pushDetail(details, t("history.providerTxn"), r.provider_txn_id, {
      mono: true,
      skipEmpty: true,
    });
    pushDetail(details, t("history.reference"), r.reference_id, {
      skipEmpty: true,
    });
    pushDetail(details, t("history.initiator"), initiator, { skipEmpty: true });
    return {
      item,
      reference,
      headlineAmount: formatNPR(
        r.total_credited !== "0.00" ? r.total_credited : r.amount,
      ),
      amountCaption: t("history.walletCredit"),
      footer: t("history.footer"),
      details,
    };
  }

  if (item.kind === "topup") {
    const top = tx.topups.find((x) => `top-${x.id}` === id);
    if (!top) return undefined;
    const operator = top.product_name || OPERATORS[top.product_id];
    const reference =
      top.merchant_txn_id || top.reference_id || top.service_hub_txn_id || `#${top.id}`;
    const details: StatementRow[] = [];
    pushDetail(details, t("history.referenceCode"), reference, { mono: true });
    pushDetail(details, t("history.dateTime"), formatDateTime(top.created_at));
    pushDetail(details, t("history.channel"), t("history.channelOnline"));
    pushDetail(details, t("history.paymentAttribute"), top.mobile_number);
    pushDetail(
      details,
      t("history.serviceName"),
      t("activity.topUp", { operator }),
    );
    pushDetail(details, t("common.status"), translateStatus(top.status, t));
    pushDetail(details, t("common.amountNpr"), formatNPR(top.amount));
    pushDetail(details, t("common.charge"), formatNPR(top.charge));
    pushDetail(details, t("common.cashback"), formatNPR(top.cashback));
    pushDetail(details, t("common.totalDebited"), formatNPR(top.total_debited));
    pushBalanceRows(details, t, top.balance_before, top.balance_after);
    pushDetail(details, t("history.merchantTxn"), top.merchant_txn_id, {
      mono: true,
      skipEmpty: true,
    });
    pushDetail(details, t("history.providerTxn"), top.service_hub_txn_id, {
      mono: true,
      skipEmpty: true,
    });
    pushDetail(details, t("history.reference"), top.reference_id, {
      skipEmpty: true,
    });
    pushDetail(details, t("history.initiator"), initiator, { skipEmpty: true });
    return {
      item,
      reference,
      headlineAmount: formatNPR(
        top.total_debited !== "0.00" ? top.total_debited : top.amount,
      ),
      amountCaption: t("history.totalDebited"),
      footer: t("history.footer"),
      details,
    };
  }

  if (item.kind === "internet") {
    const bill = (tx.internet_bills ?? []).find((x) => `isp-${x.id}` === id);
    if (!bill) return undefined;
    const reference =
      bill.merchant_txn_id ||
      bill.reference_id ||
      bill.service_hub_txn_id ||
      `#${bill.id}`;
    const details: StatementRow[] = [];
    pushDetail(details, t("history.referenceCode"), reference, { mono: true });
    pushDetail(details, t("history.dateTime"), formatDateTime(bill.created_at));
    pushDetail(details, t("history.channel"), t("history.channelOnline"));
    pushDetail(
      details,
      t("history.serviceName"),
      t("activity.internetBill", { isp: bill.isp_name }),
    );
    pushDetail(details, t("common.status"), translateStatus(bill.status, t));
    pushDetail(details, t("internet.isp"), bill.isp_name);
    pushDetail(details, t("internet.customerId"), bill.customer_id, {
      mono: true,
    });
    pushDetail(details, t("internet.customerName"), bill.customer_name || "—");
    pushDetail(details, t("internet.currentPackage"), bill.package_name || "—");
    pushDetail(details, t("common.amountNpr"), formatNPR(bill.amount));
    pushDetail(details, t("common.charge"), formatNPR(bill.charge));
    pushDetail(details, t("common.cashback"), formatNPR(bill.cashback));
    pushDetail(details, t("common.totalDebited"), formatNPR(bill.total_debited));
    pushBalanceRows(details, t, bill.balance_before, bill.balance_after);
    pushDetail(details, t("history.merchantTxn"), bill.merchant_txn_id, {
      mono: true,
      skipEmpty: true,
    });
    pushDetail(details, t("history.providerTxn"), bill.service_hub_txn_id, {
      mono: true,
      skipEmpty: true,
    });
    pushDetail(details, t("history.reference"), bill.reference_id, {
      skipEmpty: true,
    });
    pushDetail(details, t("history.initiator"), initiator, { skipEmpty: true });
    return {
      item,
      reference,
      headlineAmount: formatNPR(
        bill.total_debited !== "0.00" ? bill.total_debited : bill.amount,
      ),
      amountCaption: t("history.totalDebited"),
      footer: t("history.footer"),
      details,
    };
  }

  if (item.kind === "data_pack") {
    const dp = (tx.data_packs ?? []).find((x) => `data-${x.id}` === id);
    if (!dp) return undefined;
    const reference =
      dp.merchant_txn_id || dp.reference_id || dp.service_hub_txn_id || `#${dp.id}`;
    const details: StatementRow[] = [];
    pushDetail(details, t("history.referenceCode"), reference, { mono: true });
    pushDetail(details, t("history.dateTime"), formatDateTime(dp.created_at));
    pushDetail(details, t("history.channel"), t("history.channelOnline"));
    pushDetail(details, t("history.paymentAttribute"), dp.mobile_number);
    pushDetail(
      details,
      t("history.serviceName"),
      t("activity.dataPack", { operator: dp.operator }),
    );
    pushDetail(details, t("common.status"), translateStatus(dp.status, t));
    pushDetail(details, t("common.operator"), dp.operator);
    pushDetail(details, t("internet.currentPackage"), dp.package_name || "—");
    pushDetail(details, t("common.amountNpr"), formatNPR(dp.amount));
    pushDetail(details, t("common.charge"), formatNPR(dp.charge));
    pushDetail(details, t("common.cashback"), formatNPR(dp.cashback));
    pushDetail(details, t("common.totalDebited"), formatNPR(dp.total_debited));
    pushBalanceRows(details, t, dp.balance_before, dp.balance_after);
    pushDetail(details, t("history.merchantTxn"), dp.merchant_txn_id, {
      mono: true,
      skipEmpty: true,
    });
    pushDetail(details, t("history.providerTxn"), dp.service_hub_txn_id, {
      mono: true,
      skipEmpty: true,
    });
    pushDetail(details, t("history.reference"), dp.reference_id, {
      skipEmpty: true,
    });
    pushDetail(details, t("history.initiator"), initiator, { skipEmpty: true });
    return {
      item,
      reference,
      headlineAmount: formatNPR(
        dp.total_debited !== "0.00" ? dp.total_debited : dp.amount,
      ),
      amountCaption: t("history.totalDebited"),
      footer: t("history.footer"),
      details,
    };
  }

  if (item.kind === "wallet_adjustment") {
    const adj = (tx.wallet_adjustments ?? []).find((x) => `adj-${x.id}` === id);
    if (!adj) return undefined;
    const reference = adj.reference || `#${adj.id}`;
    const displayAmount = adjustmentDisplayAmount(adj);
    const details: StatementRow[] = [];
    pushDetail(details, t("history.referenceCode"), reference, { mono: true });
    pushDetail(details, t("history.dateTime"), formatDateTime(adj.created_at));
    pushDetail(details, t("history.channel"), t("history.channelAdmin"));
    pushDetail(details, t("history.serviceName"), t("notif.typeWalletAdjustment"));
    pushDetail(details, t("common.status"), translateStatus("success", t));
    pushDetail(
      details,
      t("history.adjustmentType"),
      adj.adjustment_type === "credit"
        ? t("activity.walletCredit")
        : t("activity.walletDebit"),
    );
    pushDetail(details, t("common.amountNpr"), formatNPR(displayAmount));
    pushDetail(details, t("history.balanceBefore"), formatNPR(adj.balance_before));
    pushDetail(details, t("history.balanceAfter"), formatNPR(adj.balance_after));
    pushDetail(details, t("common.note"), adj.reason?.trim() || "—");
    pushDetail(details, t("history.adminPhone"), adj.created_by_phone, {
      skipEmpty: true,
    });
    pushDetail(details, t("history.initiator"), initiator, { skipEmpty: true });
    return {
      item,
      reference,
      headlineAmount: formatNPR(displayAmount),
      amountCaption:
        adj.adjustment_type === "credit"
          ? t("history.walletCredit")
          : t("history.walletDebit"),
      footer: t("history.footer"),
      details,
    };
  }

  if (item.kind !== "transfer") return undefined;

  const b = tx.bank_transfers.find((x) => `bt-${x.id}` === id);
  if (!b) return undefined;
  const reference =
    b.merchant_txn_id || b.reference_id || b.provider_txn_id || `#${b.id}`;
  const details: StatementRow[] = [];
  pushDetail(details, t("history.referenceCode"), reference, { mono: true });
  pushDetail(details, t("history.dateTime"), formatDateTime(b.created_at));
  pushDetail(details, t("history.channel"), t("history.channelOnline"));
  pushDetail(
    details,
    t("history.serviceName"),
    b.is_destination_mobile
      ? t("notif.typePhoneTransfer")
      : t("notif.typeBankTransfer"),
  );
  pushDetail(details, t("common.status"), translateStatus(b.status, t));
  pushDetail(details, t("common.recipient"), b.destination_acc_name);
  pushDetail(
    details,
    b.is_destination_mobile ? t("history.destPhone") : t("history.destAccount"),
    b.destination_acc_no,
    { mono: true },
  );
  pushDetail(
    details,
    t("common.bank"),
    b.destination_bank_name || b.destination_bank,
  );
  pushDetail(
    details,
    t("history.verified"),
    b.verified ? t("history.yes") : t("history.no"),
  );
  pushDetail(details, t("common.amountNpr"), formatNPR(b.amount));
  pushDetail(details, t("common.charge"), formatNPR(b.charge));
  pushDetail(details, t("common.cashback"), formatNPR(b.cashback));
  pushDetail(details, t("common.totalDebited"), formatNPR(b.total_debited));
  pushBalanceRows(details, t, b.balance_before, b.balance_after);
  pushDetail(details, t("common.remarks"), b.transaction_remarks?.trim() || "—");
  pushDetail(details, t("history.merchantTxn"), b.merchant_txn_id, {
    mono: true,
    skipEmpty: true,
  });
  pushDetail(details, t("history.providerTxn"), b.provider_txn_id, {
    mono: true,
    skipEmpty: true,
  });
  pushDetail(details, t("history.reference"), b.reference_id, {
    skipEmpty: true,
  });
  pushDetail(details, t("history.initiator"), initiator, { skipEmpty: true });
  return {
    item,
    reference,
    headlineAmount: formatNPR(
      b.total_debited !== "0.00" ? b.total_debited : b.amount,
    ),
    amountCaption: t("history.totalDebited"),
    footer: t("history.footer"),
    details,
  };
}
