import { TOKEN_KEY } from "./constants";

// Production must use same-origin (empty string) so nginx can proxy /api → Django.
// Dev defaults to local Django. Override anytime with VITE_API_BASE_URL.
const configuredBase = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.trim();
const API_BASE =
  configuredBase !== undefined && configuredBase !== ""
    ? configuredBase.replace(/\/$/, "")
    : import.meta.env.DEV
      ? "http://127.0.0.1:8000"
      : "";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function extractMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const b = body as Record<string, unknown>;
  if (typeof b["message"] === "string") return b["message"];
  if (typeof b["error"] === "string") return b["error"];
  if (typeof b["detail"] === "string") return b["detail"];
  if (b["errors"] && typeof b["errors"] === "object") {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(b["errors"] as Record<string, unknown>)) {
      const msg = Array.isArray(v) ? v.join(" ") : String(v);
      parts.push(`${k}: ${msg}`);
    }
    if (parts.length) return parts.join(" ");
  }
  return fallback;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  auth?: boolean;
  headers?: Record<string, string>;
};

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, formData, auth = true, headers = {} } = options;
  const h: Record<string, string> = { ...headers };

  if (auth) {
    const token = getToken();
    if (token) h["Authorization"] = `Token ${token}`;
  }

  const init: RequestInit = { method, headers: h };
  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(
      "Cannot reach the MySewa server. Check your connection and try again.",
      0,
    );
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(extractMessage(data, res.statusText || "Request failed"), res.status, data);
  }

  return data as T;
}

export const apiClient = {
  login: (phone: string, password: string) =>
    api<{
      message: string;
      token: string;
      user: {
        id: number;
        phone: string;
        email: string;
        first_name: string;
        last_name: string;
        is_staff?: boolean;
        is_superuser?: boolean;
      };
    }>("/api/auth/login/", { method: "POST", body: { phone, password }, auth: false }),

  logout: () => api<{ message: string }>("/api/auth/logout/", { method: "POST" }),

  profile: () => api<import("./types").UserProfile>("/api/auth/profile/"),

  updateProfile: (formData: FormData) =>
    api<{ message: string; user: import("./types").UserProfile }>("/api/auth/profile/", {
      method: "PATCH",
      formData,
    }),

  changePassword: (body: {
    current_password: string;
    new_password: string;
    confirm_password: string;
  }) =>
    api<{ message: string; token: string }>("/api/auth/change-password/", {
      method: "POST",
      body,
    }),

  changePhone: (body: { new_phone: string; current_password: string }) =>
    api<{ message: string; user: import("./types").UserProfile }>("/api/auth/change-phone/", {
      method: "POST",
      body,
    }),

  walletBalance: () => api<import("./types").Wallet>("/api/wallet/balance/"),

  walletTransactions: () =>
    api<import("./types").WalletTransactions>("/api/wallet/transactions/"),

  settings: () => api<import("./types").AppSettings>("/api/settings/", { auth: false }),

  createDeposit: (formData: FormData) =>
    api<{ message: string; data: import("./types").Deposit }>("/api/deposit/create/", {
      method: "POST",
      formData,
    }),

  listDeposits: () => api<import("./types").Deposit[]>("/api/deposit/list/"),

  calculateCharge: (wallet_service_name: "NTC" | "NCELL" | "BANK_TRANSFER", amount: number) =>
    api<{
      wallet_service_name: string;
      amount: string;
      charge: string;
      cashback: string;
      total_debited: string;
    }>("/api/topup/calculate-charge/", {
      method: "POST",
      body: { wallet_service_name, amount },
    }),

  topupNtc: (body: { mobile_number: string; amount: number; product_id: 1 }) =>
    api<{ message: string; data: import("./types").TopupTransaction }>("/api/topup/ntc/", {
      method: "POST",
      body,
    }),

  topupNcell: (body: { mobile_number: string; amount: number; product_id: 2 }) =>
    api<{ message: string; data: import("./types").TopupTransaction }>("/api/topup/ncell/", {
      method: "POST",
      body,
    }),

  topupHistory: () => api<import("./types").TopupTransaction[]>("/api/topup/history/"),

  listBanks: () =>
    api<{
      banks: import("./types").BankOption[];
      data?: { banks: import("./types").BankOption[] };
    }>("/api/bank-transfer/banks/"),

  verifyBank: (body: {
    bank_code: string;
    account_name: string;
    account_number: string;
    is_mobile?: boolean;
    merchant_txn_id?: string;
  }) =>
    api<{
      message: string;
      data: { verified: boolean; merchant_txn_id?: string; provider?: unknown };
    }>("/api/bank-transfer/verify/", { method: "POST", body }),

  calculateTransfer: (amount: number) =>
    api<{
      data: import("./types").ChargePreview;
      raw?: unknown;
    }>("/api/bank-transfer/calculate/", { method: "POST", body: { amount } }),

  createTransfer: (body: Record<string, unknown>) =>
    api<{ message: string; data: import("./types").BankTransferTransaction }>(
      "/api/bank-transfer/create/",
      { method: "POST", body },
    ),

  transferHistory: () =>
    api<import("./types").BankTransferTransaction[]>("/api/bank-transfer/history/"),

  adminDashboard: () => api<import("./types").AdminDashboard>("/api/admin/dashboard/"),
  adminUsers: () => api<import("./types").AdminUser[]>("/api/admin/users/"),
  adminGetUser: (id: number) => api<import("./types").AdminUser>(`/api/admin/users/${id}/`),
  adminCreateUser: (body: import("./types").AdminUserWritePayload) =>
    api<{ message: string; data: import("./types").AdminUser }>("/api/admin/users/", {
      method: "POST",
      body,
    }),
  adminUpdateUser: (id: number, body: import("./types").AdminUserWritePayload) =>
    api<{ message: string; data: import("./types").AdminUser }>(`/api/admin/users/${id}/`, {
      method: "PATCH",
      body,
    }),
  adminDeleteUser: (id: number) =>
    api<{ message: string }>(`/api/admin/users/${id}/`, { method: "DELETE" }),
  adminWallets: () =>
    api<{ wallet_float: string; wallets: import("./types").AdminWallet[] }>("/api/admin/wallets/"),
  adminGetWallet: (id: number) =>
    api<import("./types").AdminWallet>(`/api/admin/wallets/${id}/`),
  adminUpdateWallet: (id: number, body: { balance: string | number }) =>
    api<{ message: string; data: import("./types").AdminWallet }>(`/api/admin/wallets/${id}/`, {
      method: "PATCH",
      body,
    }),
  adminDeleteWallet: (id: number) =>
    api<{ message: string }>(`/api/admin/wallets/${id}/`, { method: "DELETE" }),
  adminDeposits: (status?: string) =>
    api<import("./types").Deposit[]>(
      status ? `/api/admin/deposits/?status=${status}` : "/api/admin/deposits/",
    ),
  adminApproveDeposit: (id: number) =>
    api<{ message: string; data: import("./types").Deposit }>(
      `/api/admin/deposits/${id}/approve/`,
      { method: "POST" },
    ),
  adminRejectDeposit: (id: number) =>
    api<{ message: string; data: import("./types").Deposit }>(
      `/api/admin/deposits/${id}/reject/`,
      { method: "POST" },
    ),
  adminTopups: () => api<import("./types").TopupTransaction[]>("/api/admin/topups/"),
  adminTransfers: () =>
    api<import("./types").BankTransferTransaction[]>("/api/admin/transfers/"),
  adminGetSettings: () => api<import("./types").AppSettings>("/api/admin/settings/"),
  adminUpdateSettings: (formData: FormData) =>
    api<{ message: string; data: import("./types").AppSettings }>("/api/admin/settings/", {
      method: "PATCH",
      formData,
    }),
};
