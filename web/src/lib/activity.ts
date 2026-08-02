import type {
  ActivityItem,
  Deposit,
  TopupTransaction,
  BankTransferTransaction,
  WalletTransactions,
} from "./types";
import { OPERATORS } from "./constants";
import type { TranslateFn } from "./i18n";
import { formatNPR, formatDateTime } from "./format";
import { translateStatus } from "./status";

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
  sections: Array<{ title: string; rows: StatementRow[] }>;
  proofUrl?: string | null;
  footer: string;
}

export function buildActivityStatement(
  tx: WalletTransactions,
  id: string,
  t: TranslateFn = (key) => key,
): ActivityStatement | undefined {
  const item = findActivity(tx, id, t);
  if (!item) return undefined;

  if (item.kind === "deposit") {
    const d = tx.deposits.find((x) => `dep-${x.id}` === id);
    if (!d) return undefined;
    return {
      item,
      reference: `#${d.id}`,
      headlineAmount: formatNPR(d.amount),
      amountCaption: t("history.walletCredit"),
      proofUrl: d.screenshot_proof,
      footer: t("history.footer"),
      sections: [
        {
          title: t("history.sectionTxn"),
          rows: [
            { label: t("common.type"), value: t("notif.typeRemittance") },
            { label: t("common.status"), value: translateStatus(d.status, t) },
            { label: t("history.submitted"), value: formatDateTime(d.created_at) },
            { label: t("history.updated"), value: formatDateTime(d.updated_at) },
          ],
        },
        {
          title: t("history.sectionNarrative"),
          rows: [
            { label: t("common.note"), value: d.note?.trim() || "—" },
            ...(d.rejection_reason
              ? [
                  {
                    label: t("history.rejection"),
                    value: d.rejection_reason,
                    danger: true,
                  },
                ]
              : []),
          ],
        },
      ],
    };
  }

  if (item.kind === "topup") {
    const top = tx.topups.find((x) => `top-${x.id}` === id);
    if (!top) return undefined;
    const operator = top.product_name || OPERATORS[top.product_id];
    return {
      item,
      reference: `#${top.id}`,
      headlineAmount: formatNPR(
        top.total_debited !== "0.00" ? top.total_debited : top.amount,
      ),
      amountCaption: t("history.totalDebited"),
      footer: t("history.footer"),
      sections: [
        {
          title: t("history.sectionParty"),
          rows: [
            { label: t("common.operator"), value: operator },
            { label: t("common.mobile"), value: top.mobile_number },
            { label: t("history.product"), value: String(top.product_id) },
          ],
        },
        {
          title: t("history.sectionTxn"),
          rows: [
            { label: t("common.type"), value: t("notif.typeTopup") },
            { label: t("common.status"), value: translateStatus(top.status, t) },
            {
              label: t("history.merchantTxn"),
              value: top.merchant_txn_id || "—",
              mono: true,
            },
            {
              label: t("history.providerTxn"),
              value: top.service_hub_txn_id || "—",
              mono: true,
            },
            { label: t("history.reference"), value: top.reference_id || "—" },
            { label: t("history.submitted"), value: formatDateTime(top.created_at) },
            { label: t("history.updated"), value: formatDateTime(top.updated_at) },
          ],
        },
        {
          title: t("history.sectionSettlement"),
          rows: [
            { label: t("common.amount"), value: formatNPR(top.amount) },
            { label: t("common.charge"), value: formatNPR(top.charge) },
            { label: t("common.cashback"), value: formatNPR(top.cashback) },
            {
              label: t("common.totalDebited"),
              value: formatNPR(top.total_debited),
            },
          ],
        },
      ],
    };
  }

  const b = tx.bank_transfers.find((x) => `bt-${x.id}` === id);
  if (!b) return undefined;
  return {
    item,
    reference: `#${b.id}`,
    headlineAmount: formatNPR(
      b.total_debited !== "0.00" ? b.total_debited : b.amount,
    ),
    amountCaption: t("history.totalDebited"),
    footer: t("history.footer"),
    sections: [
      {
        title: t("history.sectionParty"),
        rows: [
          { label: t("common.recipient"), value: b.destination_acc_name },
          {
            label: b.is_destination_mobile
              ? t("history.destPhone")
              : t("history.destAccount"),
            value: b.destination_acc_no,
            mono: true,
          },
          {
            label: t("common.bank"),
            value: b.destination_bank_name || b.destination_bank,
          },
          {
            label: t("history.verified"),
            value: b.verified ? t("history.yes") : t("history.no"),
          },
        ],
      },
      {
        title: t("history.sectionTxn"),
        rows: [
          {
            label: t("common.type"),
            value: b.is_destination_mobile
              ? t("notif.typePhoneTransfer")
              : t("notif.typeBankTransfer"),
          },
          { label: t("common.status"), value: translateStatus(b.status, t) },
          {
            label: t("history.merchantTxn"),
            value: b.merchant_txn_id || "—",
            mono: true,
          },
          {
            label: t("history.providerTxn"),
            value: b.provider_txn_id || "—",
            mono: true,
          },
          { label: t("history.reference"), value: b.reference_id || "—" },
          { label: t("history.submitted"), value: formatDateTime(b.created_at) },
          { label: t("history.updated"), value: formatDateTime(b.updated_at) },
        ],
      },
      {
        title: t("history.sectionSettlement"),
        rows: [
          { label: t("common.amount"), value: formatNPR(b.amount) },
          { label: t("common.charge"), value: formatNPR(b.charge) },
          { label: t("common.cashback"), value: formatNPR(b.cashback) },
          {
            label: t("common.totalDebited"),
            value: formatNPR(b.total_debited),
          },
        ],
      },
      {
        title: t("history.sectionNarrative"),
        rows: [
          {
            label: t("common.remarks"),
            value: b.transaction_remarks?.trim() || "—",
          },
        ],
      },
    ],
  };
}
