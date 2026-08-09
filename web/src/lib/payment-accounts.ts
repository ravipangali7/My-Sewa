import type { BankDetails, PaymentAccount, PaymentMethod } from "./types";

export function newPaymentAccountId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `acc_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `acc_${Date.now().toString(36)}`;
}

export function emptyPaymentAccount(method: PaymentMethod = "bank"): PaymentAccount {
  const labels: Record<PaymentMethod, string> = {
    bank: "Bank account",
    khalti: "Khalti",
    esewa: "eSewa",
  };
  return {
    id: newPaymentAccountId(),
    method,
    label: labels[method],
    bank_name: "",
    account_name: "",
    account_number: "",
    branch: "",
    enabled: true,
    qr_code: "",
    qr_code_url: null,
  };
}

/** Normalize API bank_details (legacy flat or accounts[]) into a stable list. */
export function normalizePaymentAccounts(details?: BankDetails | null): PaymentAccount[] {
  if (!details) return [];
  const raw = Array.isArray(details.accounts) ? details.accounts : [];
  const fromAccounts = raw
    .filter((a): a is PaymentAccount => Boolean(a && typeof a === "object"))
    .map((a) => {
      const method: PaymentMethod =
        a.method === "khalti" || a.method === "esewa" || a.method === "bank" ? a.method : "bank";
      return {
        id: a.id || newPaymentAccountId(),
        method,
        label:
          (a.label || "").trim() ||
          (method === "khalti" ? "Khalti" : method === "esewa" ? "eSewa" : a.bank_name || "Bank account"),
        bank_name: method === "bank" ? a.bank_name || "" : "",
        account_name: a.account_name || "",
        account_number: a.account_number || "",
        branch: method === "bank" ? a.branch || "" : "",
        enabled: a.enabled !== false,
        qr_code: a.qr_code || "",
        qr_code_url: a.qr_code_url || null,
      };
    });

  if (fromAccounts.length) return fromAccounts;

  if (details.bank_name || details.account_name || details.account_number) {
    return [
      {
        id: newPaymentAccountId(),
        method: "bank",
        label: details.bank_name || "Bank account",
        bank_name: details.bank_name || "",
        account_name: details.account_name || "",
        account_number: details.account_number || "",
        branch: details.branch || "",
        enabled: true,
        qr_code: "",
        qr_code_url: null,
      },
    ];
  }
  return [];
}

export function enabledPaymentAccounts(details?: BankDetails | null): PaymentAccount[] {
  return normalizePaymentAccounts(details).filter((a) => a.enabled !== false);
}

export function paymentAccountsToBankDetails(accounts: PaymentAccount[]): BankDetails {
  const cleaned = accounts.map((a) => {
    const base: PaymentAccount = {
      id: a.id || newPaymentAccountId(),
      method: a.method,
      label:
        (a.label || "").trim() ||
        (a.method === "khalti" ? "Khalti" : a.method === "esewa" ? "eSewa" : a.bank_name || "Bank account"),
      bank_name: a.method === "bank" ? a.bank_name || "" : "",
      account_name: a.account_name || "",
      account_number: a.account_number || "",
      branch: a.method === "bank" ? a.branch || "" : "",
      enabled: a.enabled !== false,
    };
    if (a.qr_code) {
      base.qr_code = a.qr_code;
    }
    return base;
  });
  const primary =
    cleaned.find((a) => a.enabled && a.method === "bank") ||
    cleaned.find((a) => a.enabled) ||
    cleaned[0];
  return {
    bank_name: primary?.method === "bank" ? primary.bank_name || "" : primary?.label || "",
    account_name: primary?.account_name || "",
    account_number: primary?.account_number || "",
    branch: primary?.method === "bank" ? primary.branch || "" : "",
    accounts: cleaned,
  };
}

export function methodLabel(method: PaymentMethod): string {
  if (method === "khalti") return "Khalti";
  if (method === "esewa") return "eSewa";
  return "Bank";
}

export function accountQrUploadKey(accountId: string): string {
  return `account_qr_${accountId}`;
}

export function accountQrClearKey(accountId: string): string {
  return `clear_account_qr_${accountId}`;
}
