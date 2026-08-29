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

export function getApiBase(): string {
  return API_BASE;
}

if (typeof window !== "undefined") {
  (window as Window & { __mysewaApiBase?: string }).__mysewaApiBase = API_BASE;
}

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function stripTechnicalErrorMeta(text: string): string {
  // Remove lines dumped for debugging (provider code / ServiceLevel.* enums).
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^Provider error code:/i.test(t)) return false;
      if (/^Error type:/i.test(t)) return false;
      if (/^ServiceLevel\./i.test(t)) return false;
      if (/^SystemLevel\./i.test(t)) return false;
      if (/IP Allowlist/i.test(t)) return false;
      if (/Do not add the API key UUID/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const b = body as Record<string, unknown>;
  // Prefer a non-empty HimalPay payload; empty `{}` must not block `data`.
  const himapay =
    asRecord(b["himapayResponse"]) || asRecord(b["himalpay_response"]);
  const himapayUseful = himapay && Object.keys(himapay).length > 0 ? himapay : null;
  const nested =
    himapayUseful ||
    asRecord(b["provider"]) ||
    asRecord(b["data"]);
  const deeper = nested ? asRecord(nested["data"]) : null;
  const deepest = deeper ? asRecord(deeper["data"]) : null;

  const primary = firstString(
    b["message"],
    b["provider_message"],
    b["vendor_state"],
    nested?.["ms_message"],
    nested?.["vendor_state"],
    deeper?.["ms_message"],
    deeper?.["vendor_state"],
    deepest?.["ms_message"],
    deepest?.["vendor_state"],
    nested?.["error"],
    nested?.["message"],
    deeper?.["error"],
    deeper?.["message"],
    deepest?.["error"],
    deepest?.["message"],
    b["error"],
    b["detail"],
  );

  const secondary = firstString(b["error"], b["provider_message"]);
  const parts: string[] = [];

  // Local wallet shortfall — surface need vs available clearly.
  const required = b["required"];
  const available = b["available"];
  const isLocalInsufficient =
    (typeof b["error"] === "string" && /insufficient balance/i.test(b["error"])) ||
    (typeof primary === "string" &&
      /^insufficient (mysewa (business )?wallet )?balance/i.test(primary) &&
      required != null &&
      available != null);
  if (isLocalInsufficient && required != null && available != null) {
    const clear =
      firstString(b["message"]) ||
      `Insufficient MySewa business wallet balance. Need Rs. ${required}, have Rs. ${available}.`;
    parts.push(stripTechnicalErrorMeta(clear));
  } else if (primary) {
    parts.push(stripTechnicalErrorMeta(primary));
  }

  // Include a distinct short error label when it adds information
  if (
    !isLocalInsufficient &&
    secondary &&
    primary &&
    secondary !== primary &&
    !primary.includes(secondary) &&
    secondary !== "Bank transfer failed" &&
    secondary !== "Account verification failed" &&
    secondary !== "Insufficient balance"
  ) {
    parts.push(stripTechnicalErrorMeta(secondary));
  }

  if (b["wallet_debited"] === false && !parts.some((p) => /wallet was not charged/i.test(p))) {
    parts.push("Your MySewa business wallet was not charged.");
  }

  if (parts.length) return parts.join("\n\n");

  if (b["errors"] && typeof b["errors"] === "object") {
    const errParts: string[] = [];
    for (const [k, v] of Object.entries(b["errors"] as Record<string, unknown>)) {
      const msg = Array.isArray(v) ? v.join(" ") : String(v);
      errParts.push(`${k}: ${msg}`);
    }
    if (errParts.length) return errParts.join(" ");
  }
  // DRF serializer field errors: { mobile_number: ["Invalid Number"] }
  const fieldParts: string[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (k === "non_field_errors" && Array.isArray(v)) {
      fieldParts.push(v.map(String).join(" "));
      continue;
    }
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      // Prefer the raw message when it's a single known UX string
      if (v.length === 1 && (v[0] === "Invalid Number" || k === "mobile_number")) {
        fieldParts.push(String(v[0]));
      } else {
        fieldParts.push(`${k}: ${v.join(" ")}`);
      }
    }
  }
  if (fieldParts.length) return fieldParts.join(" ");
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

function filenameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return star[1].trim();
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted?.[1]) return quoted[1];
  const plain = /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

const EXPORT_MIME: Record<"xlsx" | "csv" | "sql", string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "application/zip",
  sql: "application/sql;charset=utf-8",
};

async function downloadAdminExport(path: string, format: "xlsx" | "csv" | "sql") {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const fallback =
    format === "xlsx"
      ? `mysewa-all-data-${stamp}.xlsx`
      : format === "csv"
        ? `mysewa-all-data-${stamp}.zip`
        : `mysewa-all-data-${stamp}.sql`;

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Token ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers });
  } catch {
    throw new ApiError(
      "Cannot reach the MySewa server. Check your connection and try again.",
      0,
    );
  }

  if (!res.ok) {
    const text = await res.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    throw new ApiError(extractMessage(data, res.statusText || "Export failed"), res.status, data);
  }

  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), fallback);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { filename, mime: EXPORT_MIME[format] };
}

type AdminListFilters = Partial<{
  q: string;
  status: string;
  startDate: string;
  endDate: string;
  role: string;
  dealer_id: string;
  txn_type: string;
  period: string;
  sub_agent_id: string;
  user_id: string;
}>;

function buildAdminListQuery(filters?: AdminListFilters) {
  const params = new URLSearchParams();
  const q = filters?.q?.trim();
  const status = filters?.status?.trim();
  const startDate = filters?.startDate?.trim();
  const endDate = filters?.endDate?.trim();
  const role = filters?.role?.trim();
  const dealerId = filters?.dealer_id?.trim();
  const txnType = filters?.txn_type?.trim();
  const period = filters?.period?.trim();
  const subAgentId = filters?.sub_agent_id?.trim();
  const userId = filters?.user_id?.trim();
  if (q) params.set("q", q);
  if (status && status !== "all") params.set("status", status);
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  if (role && role !== "all") params.set("role", role);
  if (dealerId) params.set("dealer_id", dealerId);
  if (txnType) params.set("txn_type", txnType);
  if (period && period !== "all") params.set("period", period);
  if (subAgentId) params.set("sub_agent_id", subAgentId);
  if (userId) params.set("user_id", userId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const apiClient = {
  login: (identifier: string, password: string) => {
    const trimmed = identifier.trim();
    const isEmail = trimmed.includes("@");
    return api<{
      message: string;
      requires_otp: boolean;
      challenge_id?: string;
      expires_in?: number;
      channels?: Array<"email" | "sms" | string>;
      email_hint?: string | null;
      phone_hint?: string | null;
      login_via?: "email" | "phone" | string | null;
      preferred_channel?: "email" | "sms" | string | null;
      token?: string;
      user?: {
        id: number;
        phone: string;
        email: string;
        first_name: string;
        last_name: string;
        is_staff?: boolean;
        is_superuser?: boolean;
        account_status?: import("./types").AccountStatus;
      };
    }>("/api/auth/login/", {
      method: "POST",
      body: isEmail
        ? { email: trimmed, identifier: trimmed, password }
        : { phone: trimmed, identifier: trimmed, password },
      auth: false,
    });
  },

  verifyLoginOtp: (body: { challenge_id: string; otp: string }) =>
    api<{
      message: string;
      requires_otp?: false;
      token: string;
      user: {
        id: number;
        phone: string;
        email: string;
        first_name: string;
        last_name: string;
        is_staff?: boolean;
        is_superuser?: boolean;
        account_status?: import("./types").AccountStatus;
      };
    }>("/api/auth/verify-login-otp/", { method: "POST", body, auth: false }),

  resendLoginOtp: (challenge_id: string) =>
    api<{
      message: string;
      requires_otp: true;
      challenge_id: string;
      expires_in: number;
      channels: Array<"email" | "sms" | string>;
      email_hint?: string | null;
      phone_hint?: string | null;
      login_via?: "email" | "phone" | string | null;
      preferred_channel?: "email" | "sms" | string | null;
    }>("/api/auth/resend-login-otp/", {
      method: "POST",
      body: { challenge_id },
      auth: false,
    }),

  register: (body: {
    phone: string;
    email: string;
    password: string;
    password2: string;
    transaction_pin: string;
    date_of_birth: string;
    first_name?: string;
    last_name?: string;
  }) =>
    api<{
      message: string;
      token: string;
      user: {
        id: number;
        phone: string;
        email: string;
        date_of_birth?: string | null;
        has_transaction_pin?: boolean;
      };
    }>("/api/auth/register/", { method: "POST", body, auth: false }),

  setTransactionPin: (body: { transaction_pin: string; confirm_pin: string }) =>
    api<{ message: string; has_pin: boolean }>("/api/auth/set-transaction-pin/", {
      method: "POST",
      body,
    }),

  changeTransactionPin: (body: {
    current_pin: string;
    transaction_pin: string;
    confirm_pin: string;
  }) =>
    api<{ message: string; has_pin: boolean }>("/api/auth/change-transaction-pin/", {
      method: "POST",
      body,
    }),

  requestTransactionPinResetOtp: () =>
    api<{
      message: string;
      email_hint?: string;
      otp_available: boolean;
    }>("/api/auth/request-transaction-pin-reset-otp/", {
      method: "POST",
      body: {},
    }),

  resetTransactionPin: (body: {
    current_password?: string;
    otp?: string;
    transaction_pin: string;
    confirm_pin: string;
  }) =>
    api<{ message: string; has_pin: boolean; otp_available?: boolean }>(
      "/api/auth/reset-transaction-pin/",
      {
        method: "POST",
        body,
      },
    ),

  hasTransactionPin: () =>
    api<{ has_pin: boolean; otp_available?: boolean }>("/api/auth/has-transaction-pin/"),

  verifyTransactionPin: (transaction_pin: string) =>
    api<{ valid: boolean; message: string }>("/api/auth/verify-transaction-pin/", {
      method: "POST",
      body: { transaction_pin },
    }),

  registerDeviceToken: (body: { token: string; platform?: string }) =>
    api<{
      message: string;
      token: string;
      platform: string;
      updated_at?: string | null;
    }>("/api/auth/device-token/", { method: "POST", body }),

  unregisterDeviceToken: (token: string) =>
    api<{ message: string }>("/api/auth/device-token/", {
      method: "DELETE",
      body: { token },
    }),

  adminPushStatus: () =>
    api<import("./types").AdminPushStatus>("/api/admin/push/"),

  adminPushHistory: () =>
    api<{ items: import("./types").AdminPushNotification[]; count: number }>(
      "/api/admin/push/history/",
    ),

  adminSendPush: (body: {
    title: string;
    body: string;
    audience: "all" | "user";
    user_id?: number;
    phone?: string;
  }) =>
    api<import("./types").AdminPushSendResult>("/api/admin/push/send/", {
      method: "POST",
      body,
    }),

  forgotPassword: (phone: string) =>
    api<{ message: string; email_hint?: string }>(
      "/api/auth/forgot-password/",
      {
        method: "POST",
        body: { phone },
        auth: false,
      },
    ),

  resetPassword: (body: {
    phone: string;
    otp: string;
    date_of_birth: string;
    new_password: string;
    confirm_password: string;
  }) =>
    api<{ message: string }>("/api/auth/reset-password/", {
      method: "POST",
      body,
      auth: false,
    }),

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

  changePhone: (body: {
    new_phone: string;
    current_password: string;
    otp: string;
  }) =>
    api<{ message: string; user: import("./types").UserProfile }>("/api/auth/change-phone/", {
      method: "POST",
      body,
    }),

  requestChangePhoneOtp: (body: { new_phone: string; current_password: string }) =>
    api<{
      message: string;
      email_hint?: string;
      expires_in?: number;
    }>("/api/auth/request-change-phone-otp/", { method: "POST", body }),

  requestEmailChange: (body: { new_email: string; current_password: string }) =>
    api<{ message: string; email_hint?: string }>(
      "/api/auth/request-email-change/",
      { method: "POST", body },
    ),

  confirmEmailChange: (body: { otp: string }) =>
    api<{ message: string; user: import("./types").UserProfile }>(
      "/api/auth/confirm-email-change/",
      { method: "POST", body },
    ),

  walletBalance: () => api<import("./types").Wallet>("/api/wallet/balance/"),

  walletTransactions: () =>
    api<import("./types").WalletTransactions>("/api/wallet/transactions/"),

  getKyc: () => api<import("./types").KycStatusPayload>("/api/kyc/"),

  submitKyc: (formData: FormData) =>
    api<{ message: string; data: import("./types").KycStatusPayload }>("/api/kyc/submit/", {
      method: "POST",
      formData,
    }),

  listKycDocuments: () =>
    api<{ items: import("./types").KycDocument[] }>("/api/kyc/documents/"),

  uploadKycDocument: (formData: FormData) =>
    api<{ message: string; data: import("./types").KycDocument }>("/api/kyc/documents/", {
      method: "POST",
      formData,
    }),

  settings: () => api<import("./types").AppSettings>("/api/settings/", { auth: false }),

  createDeposit: (formData: FormData) =>
    api<{ message: string; data: import("./types").Deposit }>("/api/deposit/create/", {
      method: "POST",
      formData,
    }),

  depositDestinations: () =>
    api<import("./types").DepositDestinations>("/api/deposit/destinations/"),

  listDeposits: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").Deposit>>(
      `/api/deposit/list/${buildAdminListQuery(filters)}`,
    ),

  calculateCharge: (
    wallet_service_name: "NTC" | "NCELL" | "BANK_TRANSFER" | string,
    amount: number,
  ) =>
    api<{
      wallet_service_name: string;
      amount: string;
      amount_paisa?: number;
      provider_charge?: string;
      system_charge?: string;
      dealer_commission?: string;
      himalpay_charge?: string;
      charge: string;
      cashback: string;
      cashback_credit?: string;
      total_debited: string;
    }>("/api/topup/calculate-charge/", {
      method: "POST",
      body: { wallet_service_name, amount },
    }),

  topupNtc: (body: {
    mobile_number: string;
    amount: number;
    product_id: 1;
    transaction_pin: string;
  }) =>
    api<{
      message: string;
      pending_message?: string;
      data: import("./types").TopupTransaction;
    }>("/api/topup/ntc/", {
      method: "POST",
      body,
    }),

  topupNcell: (body: {
    mobile_number: string;
    amount: number;
    product_id: 2;
    transaction_pin: string;
  }) =>
    api<{
      message: string;
      pending_message?: string;
      data: import("./types").TopupTransaction;
    }>("/api/topup/ncell/", {
      method: "POST",
      body,
    }),

  topupHistory: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").TopupTransaction>>(
      `/api/topup/history/${buildAdminListQuery(filters)}`,
    ),

  topupStatus: (merchant_transaction_id: string) =>
    api<{
      status: import("./types").TxnStatus;
      himalpay_status?: string;
      message?: string | null;
      data: Record<string, unknown>;
      local_topup: import("./types").TopupTransaction | null;
    }>("/api/topup/status/", {
      method: "POST",
      body: { merchant_transaction_id },
    }),

  topupServices: () =>
    api<{
      services: Array<{ id: number; name: string; logo_image_url?: string | null }>;
    }>("/api/topup/services/"),

  listBanks: () =>
    api<{
      banks: import("./types").BankOption[];
      data?: { banks: import("./types").BankOption[] };
    }>("/api/bank-transfer/banks/"),

  verifyBank: (body: {
    bank_code: string;
    bank_name?: string;
    account_name?: string;
    account_number: string;
    is_mobile?: boolean;
    merchant_txn_id?: string;
  }) =>
    api<{
      message: string;
      error?: string;
      mismatch?: boolean;
      data: {
        verified: boolean;
        account_name?: string;
        account_number?: string;
        bank_code?: string;
        bank_name?: string;
        is_mobile?: boolean;
        merchant_txn_id?: string;
        provider?: unknown;
      };
    }>("/api/bank-transfer/verify/", { method: "POST", body }),

  calculateTransfer: (amount: number) =>
    api<{
      data: import("./types").ChargePreview;
      raw?: unknown;
    }>("/api/bank-transfer/calculate/", { method: "POST", body: { amount } }),

  createTransfer: (body: Record<string, unknown>) =>
    api<{
      message: string;
      pending_message?: string;
      merchant_transaction_id?: string;
      data: import("./types").BankTransferTransaction;
    }>("/api/bank-transfer/create/", { method: "POST", body }),

  transferHistory: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").BankTransferTransaction>>(
      `/api/bank-transfer/history/${buildAdminListQuery(filters)}`,
    ),

  transferStatus: (merchant_transaction_id: string) =>
    api<{
      status: import("./types").TxnStatus;
      himalpay_status?: string;
      message?: string | null;
      data: Record<string, unknown>;
      local_transfer: import("./types").BankTransferTransaction | null;
    }>("/api/bank-transfer/status/", {
      method: "POST",
      body: { merchant_transaction_id },
    }),

  lookupWalletTransfer: (body: { phone: string }) =>
    api<{ phone: string; name: string; business_name?: string }>(
      "/api/wallet-transfer/lookup/",
      { method: "POST", body },
    ),

  createWalletTransfer: (body: {
    recipient_phone: string;
    amount: number | string;
    remarks?: string;
    transaction_pin: string;
  }) =>
    api<{ message: string; data: import("./types").WalletTransfer }>(
      "/api/wallet-transfer/create/",
      { method: "POST", body },
    ),

  walletTransferHistory: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").WalletTransfer>>(
      `/api/wallet-transfer/history/${buildAdminListQuery(filters)}`,
    ),

  lookupRemittance: (body: { ref_no: string }) =>
    api<{
      message: string;
      data: import("./types").RemittanceLookup;
      lookup_response?: unknown;
      himapayResponse?: unknown;
      himalpay_response?: unknown;
    }>("/api/remittance/lookup/", { method: "POST", body }),

  receiveRemittance: (body: Record<string, unknown> | FormData) =>
    api<{
      message: string;
      pending_message?: string;
      code?: string;
      data: import("./types").RemittanceTransaction;
      himapayResponse?: unknown;
      himalpay_response?: unknown;
    }>(
      "/api/remittance/receive/",
      body instanceof FormData
        ? { method: "POST", formData: body }
        : { method: "POST", body },
    ),

  remittanceHistory: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").RemittanceTransaction>>(
      `/api/remittance/history/${buildAdminListQuery(filters)}`,
    ),

  remittanceStatus: (merchant_transaction_id: string) =>
    api<{
      message: string;
      provider_status: string;
      data: import("./types").RemittanceTransaction;
    }>("/api/remittance/status/", {
      method: "POST",
      body: { merchant_transaction_id },
    }),

  internetIsps: () =>
    api<{ isps: import("./types").IspOption[] }>("/api/internet/isps/"),

  internetInquiry: (body: { isp_id: string; customer_id: string }) =>
    api<{ message: string; data: import("./types").InternetBillInquiry }>(
      "/api/internet/inquiry/",
      { method: "POST", body },
    ),

  internetPay: (body: {
    isp_id: string;
    customer_id: string;
    amount: number;
    package_name?: string;
    customer_name?: string;
    pay_data: Record<string, unknown>;
    transaction_pin: string;
  }) =>
    api<{
      message: string;
      pending_message?: string;
      data: import("./types").InternetBillTransaction;
    }>("/api/internet/pay/", { method: "POST", body }),

  internetHistory: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").InternetBillTransaction>>(
      `/api/internet/history/${buildAdminListQuery(filters)}`,
    ),

  internetStatus: (merchant_transaction_id: string) =>
    api<{
      status: import("./types").TxnStatus;
      message?: string | null;
      data: Record<string, unknown>;
      local_bill: import("./types").InternetBillTransaction | null;
    }>("/api/internet/status/", {
      method: "POST",
      body: { merchant_transaction_id },
    }),

  waterCounters: () =>
    api<{ message: string; data: unknown }>("/api/water/counters/"),

  waterInquiry: (body: {
    connection_no: string;
    customer_code: string;
    counter: string;
  }) =>
    api<{ message: string; data: import("./types").UtilityInquiry }>(
      "/api/water/inquiry/",
      { method: "POST", body },
    ),

  waterPay: (body: {
    connection_no: string;
    customer_code: string;
    counter: string;
    amount: number;
    session_id?: string;
    payment_type?: string;
    customer_name?: string;
    pay_data?: Record<string, unknown>;
    transaction_pin: string;
  }) =>
    api<{
      message: string;
      pending_message?: string;
      data: import("./types").WaterBillTransaction;
    }>("/api/water/pay/", { method: "POST", body }),

  waterHistory: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").WaterBillTransaction>>(
      `/api/water/history/${buildAdminListQuery(filters)}`,
    ),

  waterStatus: (merchant_transaction_id: string) =>
    api<{
      status: import("./types").TxnStatus;
      message?: string | null;
      data: Record<string, unknown>;
      local_bill: import("./types").WaterBillTransaction | null;
    }>("/api/water/status/", {
      method: "POST",
      body: { merchant_transaction_id },
    }),

  electricityCounters: () =>
    api<{ message: string; data: unknown }>("/api/electricity/counters/"),

  electricityInquiry: (body: {
    sc_no: string;
    consumer_id: string;
    office_code: string;
  }) =>
    api<{ message: string; data: import("./types").UtilityInquiry }>(
      "/api/electricity/inquiry/",
      { method: "POST", body },
    ),

  electricityPay: (body: {
    sc_no: string;
    consumer_id: string;
    office_code: string;
    office_name?: string;
    amount: number;
    session_id?: string;
    customer_name?: string;
    pay_data?: Record<string, unknown>;
    transaction_pin: string;
  }) =>
    api<{
      message: string;
      pending_message?: string;
      data: import("./types").ElectricityBillTransaction;
    }>("/api/electricity/pay/", { method: "POST", body }),

  electricityHistory: (filters?: AdminListFilters) =>
    api<
      import("./types").AdminListResponse<import("./types").ElectricityBillTransaction>
    >(`/api/electricity/history/${buildAdminListQuery(filters)}`),

  electricityStatus: (merchant_transaction_id: string) =>
    api<{
      status: import("./types").TxnStatus;
      message?: string | null;
      data: Record<string, unknown>;
      local_bill: import("./types").ElectricityBillTransaction | null;
    }>("/api/electricity/status/", {
      method: "POST",
      body: { merchant_transaction_id },
    }),

  communityElectricityProviders: () =>
    api<{ providers: import("./types").CommunityProviderOption[] }>(
      "/api/community-electricity/providers/",
    ),

  communityElectricityCounters: (body: {
    platform_id: string;
    customer_code?: string;
    service_slug?: string;
    customer_ref?: string;
  }) =>
    api<{
      message: string;
      platform_id: string;
      data: unknown;
    }>("/api/community-electricity/counters/", { method: "POST", body }),

  communityElectricityInquiry: (body: {
    platform_id: string;
    customer_ref?: string;
    customer_number?: string;
    customer_code?: string;
    customer_no?: string;
    consumer_no?: string;
    consumer_id?: string;
    service_slug?: string;
    counter_code?: string;
    month?: number | null;
  }) =>
    api<{ message: string; data: import("./types").UtilityInquiry }>(
      "/api/community-electricity/inquiry/",
      { method: "POST", body },
    ),

  communityElectricityPay: (body: {
    platform_id: string;
    amount: number;
    session_id?: string;
    customer_ref?: string;
    customer_number?: string;
    customer_code?: string;
    customer_no?: string;
    consumer_no?: string;
    consumer_id?: string;
    service_slug?: string;
    counter_code?: string;
    month?: number | null;
    customer_name?: string;
    pay_data?: Record<string, unknown>;
    transaction_pin: string;
  }) =>
    api<{
      message: string;
      pending_message?: string;
      data: import("./types").CommunityElectricityTransaction;
    }>("/api/community-electricity/pay/", { method: "POST", body }),

  communityElectricityHistory: (filters?: AdminListFilters) =>
    api<
      import("./types").AdminListResponse<import("./types").CommunityElectricityTransaction>
    >(`/api/community-electricity/history/${buildAdminListQuery(filters)}`),

  communityElectricityStatus: (merchant_transaction_id: string) =>
    api<{
      status: import("./types").TxnStatus;
      message?: string | null;
      data: Record<string, unknown>;
      local_bill: import("./types").CommunityElectricityTransaction | null;
    }>("/api/community-electricity/status/", {
      method: "POST",
      body: { merchant_transaction_id },
    }),

  dataPackInquiry: (body: { operator: "NTC" | "NCELL"; mobile_number?: string }) =>
    api<{
      message: string;
      data: {
        operator: string;
        mobile_number: string;
        packages: import("./types").DataPackOption[];
      };
    }>("/api/data-pack/inquiry/", { method: "POST", body }),

  dataPackPay: (body: {
    operator: "NTC" | "NCELL";
    mobile_number: string;
    amount: number;
    package_name?: string;
    package_id?: string;
    product_code?: string;
    transaction_pin: string;
  }) =>
    api<{
      message: string;
      pending_message?: string;
      data: import("./types").DataPackTransaction;
    }>("/api/data-pack/pay/", { method: "POST", body }),

  dataPackHistory: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").DataPackTransaction>>(
      `/api/data-pack/history/${buildAdminListQuery(filters)}`,
    ),

  dataPackStatus: (merchant_transaction_id: string) =>
    api<{
      status: import("./types").TxnStatus;
      message?: string | null;
      data: Record<string, unknown>;
      local_data_pack: import("./types").DataPackTransaction | null;
    }>("/api/data-pack/status/", {
      method: "POST",
      body: { merchant_transaction_id },
    }),

  adminDashboard: () => api<import("./types").AdminDashboard>("/api/admin/dashboard/"),
  adminReports: (filters?: { startDate?: string; endDate?: string }) => {
    const params = new URLSearchParams();
    if (filters?.startDate?.trim()) params.set("start_date", filters.startDate.trim());
    if (filters?.endDate?.trim()) params.set("end_date", filters.endDate.trim());
    const query = params.toString();
    return api<import("./types").AdminReports>(
      `/api/admin/reports/${query ? `?${query}` : ""}`,
    );
  },
  adminUsers: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").AdminUser>>(
      `/api/admin/users/${buildAdminListQuery(filters)}`,
    ),
  adminGetUser: (id: number) => api<import("./types").AdminUser>(`/api/admin/users/${id}/`),
  adminUserReport: (
    id: number,
    filters?: { startDate?: string; endDate?: string },
  ) => {
    const params = new URLSearchParams();
    if (filters?.startDate?.trim()) params.set("start_date", filters.startDate.trim());
    if (filters?.endDate?.trim()) params.set("end_date", filters.endDate.trim());
    const query = params.toString();
    return api<import("./types").AdminUserReport>(
      `/api/admin/users/${id}/report/${query ? `?${query}` : ""}`,
    );
  },
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
  /** Soft-delete account via GET /api/auth/delete-account/<phone>/<password>/ */
  deleteAccount: (phone: string, password: string) =>
    api<{ message: string; detail?: string }>(
      `/api/auth/delete-account/${encodeURIComponent(phone.trim())}/${encodeURIComponent(password)}/`,
      { method: "GET", auth: false },
    ),
  adminGetUserFees: (id: number) =>
    api<import("./types").AdminUserFeesResponse>(`/api/admin/users/${id}/fees/`),
  adminUpdateUserFees: (id: number, body: import("./types").UserFeeConfigPayload) =>
    api<import("./types").AdminUserFeesResponse>(`/api/admin/users/${id}/fees/`, {
      method: "PUT",
      body,
    }),
  adminSetUserTransactionPin: (
    id: number,
    body: { transaction_pin: string; confirm_pin: string },
  ) =>
    api<{ message: string; user_id: number; has_transaction_pin: boolean }>(
      `/api/admin/users/${id}/set-transaction-pin/`,
      { method: "POST", body },
    ),
  adminWallets: (filters?: AdminListFilters) =>
    api<
      import("./types").AdminListResponse<import("./types").AdminWallet> & {
        wallet_float: string;
      }
    >(`/api/admin/wallets/${buildAdminListQuery(filters)}`),
  adminGetWallet: (id: number) =>
    api<import("./types").AdminWallet>(`/api/admin/wallets/${id}/`),
  adminUpdateWallet: (
    id: number,
    body:
      | { balance: string | number; reason: string; reference?: string }
      | {
          amount: string | number;
          adjustment_type: "credit" | "debit";
          reason: string;
          reference?: string;
        },
  ) =>
    api<{ message: string; data: import("./types").AdminWallet }>(`/api/admin/wallets/${id}/`, {
      method: "PATCH",
      body,
    }),
  adminDeleteWallet: (id: number) =>
    api<{ message: string }>(`/api/admin/wallets/${id}/`, { method: "DELETE" }),
  adminUnblockWallet: (id: number) =>
    api<{ message: string; data: import("./types").AdminWallet }>(
      `/api/admin/wallets/${id}/unblock/`,
      { method: "POST" },
    ),
  adminFreezeWallet: (id: number, body?: { reason?: string }) =>
    api<{ message: string; data: import("./types").AdminWallet }>(
      `/api/admin/wallets/${id}/freeze/`,
      { method: "POST", body: body ?? {} },
    ),
  adminUnfreezeWallet: (id: number) =>
    api<{ message: string; data: import("./types").AdminWallet }>(
      `/api/admin/wallets/${id}/unfreeze/`,
      { method: "POST" },
    ),
  adminWalletTransactions: (
    id: number,
    filters?: AdminListFilters & { type?: string },
  ) => {
    const params = new URLSearchParams(buildAdminListQuery(filters).replace(/^\?/, ""));
    const type = filters?.type?.trim();
    if (type && type !== "all") params.set("type", type);
    const query = params.toString();
    return api<
      import("./types").WalletTransactions & { wallet_id?: number; user_id?: number }
    >(`/api/admin/wallets/${id}/transactions/${query ? `?${query}` : ""}`);
  },
  adminTransactionHistory: (filters?: AdminListFilters & { type?: string }) => {
    const params = new URLSearchParams(buildAdminListQuery(filters).replace(/^\?/, ""));
    const type = filters?.type?.trim();
    if (type && type !== "all") params.set("type", type);
    const query = params.toString();
    return api<import("./types").AdminTransactionHistoryResponse>(
      `/api/admin/transactions/${query ? `?${query}` : ""}`,
    );
  },
  adminDeposits: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").Deposit>>(
      `/api/admin/deposits/${buildAdminListQuery(filters)}`,
    ),
  adminGetDeposit: (id: number) =>
    api<import("./types").Deposit>(`/api/admin/deposits/${id}/`),
  adminApproveDeposit: (id: number) =>
    api<{ message: string; data: import("./types").Deposit }>(
      `/api/admin/deposits/${id}/approve/`,
      { method: "POST" },
    ),
  adminRejectDeposit: (id: number, body: { rejection_reason: string }) =>
    api<{ message: string; data: import("./types").Deposit }>(
      `/api/admin/deposits/${id}/reject/`,
      { method: "POST", body },
    ),
  adminPayoutAccounts: (filters?: AdminListFilters) =>
    api<{
      items: import("./types").DealerPayoutAccount[];
      stats?: import("./types").AdminListStats;
    }>(`/api/admin/payout-accounts/${buildAdminListQuery(filters)}`),
  adminGetPayoutAccount: (id: number) =>
    api<import("./types").DealerPayoutAccount>(`/api/admin/payout-accounts/${id}/`),
  adminApprovePayoutAccount: (id: number) =>
    api<{ message: string; data: import("./types").DealerPayoutAccount }>(
      `/api/admin/payout-accounts/${id}/approve/`,
      { method: "POST" },
    ),
  adminRejectPayoutAccount: (id: number, body: { rejection_reason: string }) =>
    api<{ message: string; data: import("./types").DealerPayoutAccount }>(
      `/api/admin/payout-accounts/${id}/reject/`,
      { method: "POST", body },
    ),
  adminKyc: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").KycSubmission>>(
      `/api/admin/kyc/${buildAdminListQuery(filters)}`,
    ),
  adminGetKyc: (id: number) =>
    api<import("./types").KycSubmission>(`/api/admin/kyc/${id}/`),
  adminUpdateKyc: (
    id: number,
    body: {
      citizenship_number?: string;
      first_name?: string;
      last_name?: string;
      date_of_birth?: string | null;
    },
  ) =>
    api<{ message: string; data: import("./types").KycSubmission }>(
      `/api/admin/kyc/${id}/`,
      { method: "PATCH", body },
    ),
  adminApproveKyc: (id: number) =>
    api<{ message: string; data: import("./types").KycSubmission }>(
      `/api/admin/kyc/${id}/approve/`,
      { method: "POST" },
    ),
  adminRejectKyc: (id: number, body: { rejection_reason: string }) =>
    api<{ message: string; data: import("./types").KycSubmission }>(
      `/api/admin/kyc/${id}/reject/`,
      { method: "POST", body },
    ),
  adminTopups: (filters?: AdminListFilters & { productId?: "1" | "2" | "all" }) => {
    const params = new URLSearchParams(buildAdminListQuery(filters).replace(/^\?/, ""));
    if (filters?.productId && filters.productId !== "all") {
      params.set("product_id", filters.productId);
    }
    const query = params.toString();
    return api<import("./types").AdminListResponse<import("./types").TopupTransaction>>(
      `/api/admin/topups/${query ? `?${query}` : ""}`,
    );
  },
  adminGetTopup: (id: number) =>
    api<import("./types").TopupTransaction>(`/api/admin/topups/${id}/`),
  adminUpdateTopupStatus: (id: number, status: import("./types").TxnStatus) =>
    api<{ message: string; data: import("./types").TopupTransaction }>(
      `/api/admin/topups/${id}/status/`,
      { method: "POST", body: { status } },
    ),
  adminDataPacks: (filters?: AdminListFilters & { operator?: "NTC" | "NCELL" | "all" }) => {
    const params = new URLSearchParams(buildAdminListQuery(filters).replace(/^\?/, ""));
    if (filters?.operator && filters.operator !== "all") {
      params.set("operator", filters.operator);
    }
    const query = params.toString();
    return api<import("./types").AdminListResponse<import("./types").DataPackTransaction>>(
      `/api/admin/data-packs/${query ? `?${query}` : ""}`,
    );
  },
  adminGetDataPack: (id: number) =>
    api<import("./types").DataPackTransaction>(`/api/admin/data-packs/${id}/`),
  adminUpdateDataPackStatus: (id: number, status: import("./types").TxnStatus) =>
    api<{ message: string; data: import("./types").DataPackTransaction }>(
      `/api/admin/data-packs/${id}/status/`,
      { method: "POST", body: { status } },
    ),
  adminInternetBills: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").InternetBillTransaction>>(
      `/api/admin/internet-bills/${buildAdminListQuery(filters)}`,
    ),
  adminGetInternetBill: (id: number) =>
    api<import("./types").InternetBillTransaction>(`/api/admin/internet-bills/${id}/`),
  adminUpdateInternetBillStatus: (id: number, status: import("./types").TxnStatus) =>
    api<{ message: string; data: import("./types").InternetBillTransaction }>(
      `/api/admin/internet-bills/${id}/status/`,
      { method: "POST", body: { status } },
    ),
  adminWaterBills: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").WaterBillTransaction>>(
      `/api/admin/water-bills/${buildAdminListQuery(filters)}`,
    ),
  adminGetWaterBill: (id: number) =>
    api<import("./types").WaterBillTransaction>(`/api/admin/water-bills/${id}/`),
  adminUpdateWaterBillStatus: (id: number, status: import("./types").TxnStatus) =>
    api<{ message: string; data: import("./types").WaterBillTransaction }>(
      `/api/admin/water-bills/${id}/status/`,
      { method: "POST", body: { status } },
    ),
  adminCommunityElectricity: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").CommunityElectricityTransaction>>(
      `/api/admin/community-electricity/${buildAdminListQuery(filters)}`,
    ),
  adminGetCommunityElectricity: (id: number) =>
    api<import("./types").CommunityElectricityTransaction>(
      `/api/admin/community-electricity/${id}/`,
    ),
  adminUpdateCommunityElectricityStatus: (id: number, status: import("./types").TxnStatus) =>
    api<{ message: string; data: import("./types").CommunityElectricityTransaction }>(
      `/api/admin/community-electricity/${id}/status/`,
      { method: "POST", body: { status } },
    ),
  adminTransfers: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").BankTransferTransaction>>(
      `/api/admin/transfers/${buildAdminListQuery(filters)}`,
    ),
  adminCommissionHistory: (filters?: AdminListFilters) =>
    api<import("./types").CommissionHistoryResponse>(
      `/api/admin/commission-history/${buildAdminListQuery(filters)}`,
    ),
  adminDealerCommissions: (filters?: AdminListFilters) =>
    api<import("./types").DealerCommissionResponse>(
      `/api/admin/dealer-commissions/${buildAdminListQuery(filters)}`,
    ),
  agentSubAgents: (filters?: AdminListFilters) =>
    api<{ items: import("./types").AdminUser[] }>(
      `/api/agent/sub-agents/${buildAdminListQuery(filters)}`,
    ),
  agentCreateSubAgent: (body: import("./types").AdminUserWritePayload) =>
    api<{ message: string; data: import("./types").AdminUser }>("/api/agent/sub-agents/", {
      method: "POST",
      body,
    }),

  supportChatContacts: (q?: string) => {
    const params = new URLSearchParams();
    const query = q?.trim();
    if (query) params.set("q", query);
    const suffix = params.toString();
    return api<{ items: import("./types").SupportChatUser[]; count: number }>(
      `/api/support-chat/contacts/${suffix ? `?${suffix}` : ""}`,
    );
  },
  supportChatUnread: () => api<{ count: number }>("/api/support-chat/unread/"),
  supportChatThreads: () =>
    api<{ items: import("./types").SupportChatThread[]; count: number }>(
      "/api/support-chat/threads/",
    ),
  supportChatStartThread: (userId: number) =>
    api<import("./types").SupportChatThread>("/api/support-chat/threads/", {
      method: "POST",
      body: { user_id: userId },
    }),
  supportChatMessages: (threadId: number, afterId?: number) => {
    const params = new URLSearchParams();
    if (afterId) params.set("after_id", String(afterId));
    const suffix = params.toString();
    return api<{ items: import("./types").SupportChatMessage[]; count: number }>(
      `/api/support-chat/threads/${threadId}/messages/${suffix ? `?${suffix}` : ""}`,
    );
  },
  supportChatSendMessage: (threadId: number, body: string) =>
    api<import("./types").SupportChatMessage>(
      `/api/support-chat/threads/${threadId}/messages/`,
      { method: "POST", body: { body } },
    ),

  dealerDashboard: () => api<import("./types").NetworkDashboard>("/api/dealer/dashboard/"),
  dealerSubAgents: (filters?: AdminListFilters) =>
    api<{ items: import("./types").AdminUser[] }>(
      `/api/dealer/sub-agents/${buildAdminListQuery(filters)}`,
    ),
  dealerCreateSubAgent: (body: import("./types").AdminUserWritePayload) =>
    api<{ message: string; data: import("./types").AdminUser }>("/api/dealer/sub-agents/", {
      method: "POST",
      body,
    }),
  dealerGetSubAgent: (id: number) =>
    api<import("./types").AdminUser>(`/api/dealer/sub-agents/${id}/`),
  dealerUpdateSubAgent: (id: number, body: Partial<import("./types").AdminUserWritePayload>) =>
    api<{ message: string; data: import("./types").AdminUser }>(`/api/dealer/sub-agents/${id}/`, {
      method: "PATCH",
      body,
    }),
  dealerCustomers: (filters?: AdminListFilters) =>
    api<{ items: import("./types").AdminUser[] }>(
      `/api/dealer/customers/${buildAdminListQuery(filters)}`,
    ),
  dealerCreateCustomer: (body: import("./types").AdminUserWritePayload) =>
    api<{ message: string; data: import("./types").AdminUser }>("/api/dealer/customers/", {
      method: "POST",
      body,
    }),
  dealerGetCustomer: (id: number) =>
    api<import("./types").AdminUser>(`/api/dealer/customers/${id}/`),
  dealerUpdateCustomer: (id: number, body: Partial<import("./types").AdminUserWritePayload>) =>
    api<{ message: string; data: import("./types").AdminUser }>(`/api/dealer/customers/${id}/`, {
      method: "PATCH",
      body,
    }),
  dealerFreezeUser: (id: number, body?: { reason?: string }) =>
    api<{ message: string; data: import("./types").AdminUser }>(`/api/dealer/users/${id}/freeze/`, {
      method: "POST",
      body: body ?? {},
    }),
  dealerUnfreezeUser: (id: number) =>
    api<{ message: string; data: import("./types").AdminUser }>(`/api/dealer/users/${id}/unfreeze/`, {
      method: "POST",
    }),
  dealerLoadUserWallet: (
    id: number,
    body: { amount: string | number; transaction_pin: string; remarks?: string },
  ) =>
    api<{ message: string; data: import("./types").WalletTransfer }>(
      `/api/dealer/users/${id}/load-wallet/`,
      { method: "POST", body },
    ),
  dealerPushBalanceUsers: (filters?: { q?: string }) =>
    api<{ items: import("./types").PushBalanceUser[] }>(
      `/api/dealer/push-balance/users/${buildAdminListQuery(filters)}`,
    ),
  dealerPushBalance: (body: {
    user_id: number;
    amount: number | string;
    remarks?: string;
    transaction_pin: string;
  }) =>
    api<{
      message: string;
      data: import("./types").WalletTransfer;
      recipient: import("./types").PushBalanceUser;
    }>("/api/dealer/push-balance/", { method: "POST", body }),
  dealerPayoutAccounts: () =>
    api<{ items: import("./types").DealerPayoutAccount[] }>("/api/dealer/payout-accounts/"),
  dealerCreatePayoutAccount: (formData: FormData) =>
    api<{ message: string; data: import("./types").DealerPayoutAccount }>(
      "/api/dealer/payout-accounts/",
      { method: "POST", formData },
    ),
  dealerUpdatePayoutAccount: (id: number, formData: FormData) =>
    api<{ message: string; data: import("./types").DealerPayoutAccount }>(
      `/api/dealer/payout-accounts/${id}/`,
      { method: "PATCH", formData },
    ),
  dealerDeposits: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").Deposit>>(
      `/api/dealer/deposits/${buildAdminListQuery(filters)}`,
    ),
  dealerApproveDeposit: (id: number) =>
    api<{ message: string; data: import("./types").Deposit }>(
      `/api/dealer/deposits/${id}/approve/`,
      { method: "POST" },
    ),
  dealerRejectDeposit: (id: number, body: { rejection_reason: string }) =>
    api<{ message: string; data: import("./types").Deposit }>(
      `/api/dealer/deposits/${id}/reject/`,
      { method: "POST", body },
    ),
  dealerCommissions: (filters?: AdminListFilters) =>
    api<{
      items: import("./types").DealerCommissionItem[];
      earnings: import("./types").DealerCommissionEarnings;
    }>(`/api/dealer/commissions/${buildAdminListQuery(filters)}`),
  dealerReport: (filters?: AdminListFilters) =>
    api<import("./types").NetworkReport>(`/api/dealer/report/${buildAdminListQuery(filters)}`),
  adminHierarchy: (filters?: AdminListFilters) =>
    api<{ items: import("./types").HierarchyNode[] }>(
      `/api/admin/hierarchy/${buildAdminListQuery(filters)}`,
    ),
  adminDealerProfit: (filters?: AdminListFilters) => {
    const params = new URLSearchParams(buildAdminListQuery(filters).replace(/^\?/, ""));
    if (filters?.status === "all") params.set("status", "all");
    const query = params.toString();
    return api<{
      items: import("./types").DealerProfitRow[];
      totals: Record<string, string>;
      range: { start_date: string | null; end_date: string | null };
    }>(`/api/admin/dealer-profit/${query ? `?${query}` : ""}`);
  },
  adminServiceCommissionRules: (userId: number) =>
    api<{
      dealer_id: number;
      defaults: {
        commission_rate: string;
        sub_agent_commission_rate: string;
        super_admin_rate: string;
        tds_rate: string | null;
      };
      items: import("./types").ServiceCommissionRule[];
    }>(`/api/admin/users/${userId}/commission-rules/`),
  adminSaveServiceCommissionRules: (
    userId: number,
    items: Array<{
      txn_type: string;
      dealer_rate: string | number;
      sub_agent_rate: string | number;
      super_admin_rate: string | number;
    }>,
  ) =>
    api<{ message: string; items: import("./types").ServiceCommissionRule[] }>(
      `/api/admin/users/${userId}/commission-rules/`,
      { method: "PUT", body: { items } },
    ),
  adminUpdateTransferStatus: (id: number, status: import("./types").TxnStatus) =>
    api<{ message: string; data: import("./types").BankTransferTransaction }>(
      `/api/admin/transfers/${id}/status/`,
      { method: "POST", body: { status } },
    ),
  adminRemittances: (filters?: AdminListFilters) =>
    api<import("./types").AdminListResponse<import("./types").RemittanceTransaction>>(
      `/api/admin/remittances/${buildAdminListQuery(filters)}`,
    ),
  adminGetRemittance: (id: number) =>
    api<import("./types").RemittanceTransaction>(`/api/admin/remittances/${id}/`),
  adminUpdateRemittanceStatus: (id: number, status: import("./types").TxnStatus) =>
    api<{ message: string; data: import("./types").RemittanceTransaction }>(
      `/api/admin/remittances/${id}/status/`,
      { method: "POST", body: { status } },
    ),
  adminGetSettings: () => api<import("./types").AppSettings>("/api/admin/settings/"),
  adminGetServiceCharges: () =>
    api<{ data: import("./types").ServiceChargeConfig[] }>("/api/admin/service-charges/"),
  adminSaveServiceCharges: (data: import("./types").ServiceChargeConfig[]) =>
    api<{ message: string; data: import("./types").ServiceChargeConfig[] }>(
      "/api/admin/service-charges/",
      { method: "PUT", body: { data } },
    ),
  adminCommissionSetupDealers: (q = "") => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    const query = params.toString();
    return api<{ items: import("./types").CommissionSetupDealer[]; count: number }>(
      `/api/admin/commission-setup/dealers/${query ? `?${query}` : ""}`,
    );
  },
  adminCommissionSetupDealer: (dealerId: number) =>
    api<import("./types").CommissionSetupDealerDetail>(
      `/api/admin/commission-setup/dealers/${dealerId}/`,
    ),
  adminSaveCommissionSetupDealer: (
    dealerId: number,
    payload: { commission_amount: string | number },
  ) =>
    api<import("./types").CommissionSetupDealerDetail>(
      `/api/admin/commission-setup/dealers/${dealerId}/`,
      { method: "PUT", body: payload },
    ),
  adminSaveCommissionSetupCashback: (
    dealerId: number,
    payload: {
      apply_to_all?: boolean;
      cashback?: string | number;
      user_id?: number;
      users?: { id: number; cashback: string | number }[];
    },
  ) =>
    api<{ message: string; users: import("./types").CommissionSetupUser[] }>(
      `/api/admin/commission-setup/dealers/${dealerId}/cashback/`,
      { method: "PUT", body: payload },
    ),
  adminUpdateSettings: (payload: FormData | Record<string, unknown>) =>
    api<{ message: string; data: import("./types").AppSettings }>("/api/admin/settings/", {
      method: "PATCH",
      ...(payload instanceof FormData ? { formData: payload } : { body: payload }),
    }),
  adminExportAllData: (format: "xlsx" | "csv" | "sql") =>
    downloadAdminExport(`/api/admin/settings/export/?format=${format}`, format),

  adminPopups: (filters?: { is_active?: string }) => {
    const params = new URLSearchParams();
    if (filters?.is_active) params.set("is_active", filters.is_active);
    const query = params.toString();
    return api<{ items: import("./types").HomePopup[]; count: number }>(
      `/api/admin/popups/${query ? `?${query}` : ""}`,
    );
  },
  adminGetPopup: (id: number) =>
    api<import("./types").HomePopup>(`/api/admin/popups/${id}/`),
  adminCreatePopup: (payload: FormData | Record<string, unknown>) =>
    api<{ message: string; data: import("./types").HomePopup }>("/api/admin/popups/", {
      method: "POST",
      ...(payload instanceof FormData ? { formData: payload } : { body: payload }),
    }),
  adminUpdatePopup: (id: number, payload: FormData | Record<string, unknown>) =>
    api<{ message: string; data: import("./types").HomePopup }>(`/api/admin/popups/${id}/`, {
      method: "PATCH",
      ...(payload instanceof FormData ? { formData: payload } : { body: payload }),
    }),
  adminDeletePopup: (id: number) =>
    api<{ message: string }>(`/api/admin/popups/${id}/`, { method: "DELETE" }),

  activeHomePopup: () =>
    api<{ popup: import("./types").HomePopup | null }>("/api/popups/active/"),
  recordHomePopupShown: (id: number) =>
    api<{ recorded: boolean; message?: string; detail?: string }>(`/api/popups/${id}/shown/`, {
      method: "POST",
    }),

  adminHimalpayStatus: () =>
    api<{
      outbound_ip: string | null;
      base_url: string;
      api_key_configured: boolean;
      portal_login_configured?: boolean;
      bypass_api: boolean;
      ok: boolean;
      message: string;
      error_code?: number | null;
      error_type?: string | null;
      services_count: number;
      balance_ok?: boolean;
      balance_source?: string | null;
      balance_total_rupees?: number | null;
      balance_message?: string;
      inbound_qr_supported?: boolean;
      inbound_qr_reason?: string;
      inbound_qr_hinted_services?: string[];
    }>("/api/admin/himalpay/status/"),

  adminStatement: (filters?: {
    status?: string;
    issue_type?: string;
    start_date?: string;
    end_date?: string;
    q?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.issue_type) params.set("issue_type", filters.issue_type);
    if (filters?.start_date) params.set("start_date", filters.start_date);
    if (filters?.end_date) params.set("end_date", filters.end_date);
    if (filters?.q) params.set("q", filters.q);
    const query = params.toString();
    return api<import("./types").StatementListResponse>(
      `/api/admin/statement/${query ? `?${query}` : ""}`,
    );
  },

  adminStatementRuns: () =>
    api<{ items: import("./types").StatementReconcileRun[]; count: number }>(
      "/api/admin/statement/runs/",
    ),

  adminStatementRun: (payload: { from_date: string; to_date: string }) =>
    api<{
      message: string;
      data: import("./types").StatementReconcileRun;
      statement_logs?: Record<string, unknown>[];
      ledger?: import("./types").StatementLedgerRow[];
      warning?: string;
    }>("/api/admin/statement/run/", {
      method: "POST",
      body: payload,
    }),

  adminStatementBalance: () =>
    api<{
      data: import("./types").HimalPayResellerBalance | null;
      error?: string;
      unavailable?: boolean;
      source?: string;
      api_key_configured?: boolean;
      portal_login_configured?: boolean;
      hint?: string;
    }>("/api/admin/statement/balance/"),

  adminStatementLedger: (filters?: {
    from_date?: string;
    to_date?: string;
    match_state?: string;
    user?: string;
    q?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.from_date) params.set("from_date", filters.from_date);
    if (filters?.to_date) params.set("to_date", filters.to_date);
    if (filters?.match_state) params.set("match_state", filters.match_state);
    if (filters?.user) params.set("user", filters.user);
    if (filters?.q) params.set("q", filters.q);
    const query = params.toString();
    return api<import("./types").StatementLedgerResponse>(
      `/api/admin/statement/ledger/${query ? `?${query}` : ""}`,
    );
  },

  adminStatementHistory: (filters?: {
    from_date?: string;
    to_date?: string;
    direction?: string;
    q?: string;
    live?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (filters?.from_date) params.set("from_date", filters.from_date);
    if (filters?.to_date) params.set("to_date", filters.to_date);
    if (filters?.direction && filters.direction !== "all") {
      params.set("direction", filters.direction);
    }
    if (filters?.q) params.set("q", filters.q);
    if (filters?.live === false) params.set("live", "0");
    const query = params.toString();
    return api<import("./types").HimalPayHistoryResponse>(
      `/api/admin/statement/history/${query ? `?${query}` : ""}`,
    );
  },

  adminStatementSolve: (
    id: number,
    payload?: {
      adjustment_type?: "credit" | "debit";
      amount?: string;
      reason?: string;
    },
  ) =>
    api<{ message: string; data: import("./types").StatementDiscrepancy }>(
      `/api/admin/statement/discrepancies/${id}/solve/`,
      { method: "POST", body: payload || {} },
    ),

  adminStatementCorrect: (payload: {
    user_id: number;
    adjustment_type: "credit" | "debit";
    amount: string;
    reason: string;
    discrepancy_id?: number | null;
    transaction_uuid?: string;
  }) =>
    api<{
      message: string;
      adjustment_id: number;
      balance_before: string;
      balance_after: string;
      data?: import("./types").StatementDiscrepancy;
    }>("/api/admin/statement/correct/", {
      method: "POST",
      body: payload,
    }),

  adminStatementIgnore: (id: number, reason?: string) =>
    api<{ message: string; data: import("./types").StatementDiscrepancy }>(
      `/api/admin/statement/discrepancies/${id}/ignore/`,
      { method: "POST", body: { reason: reason || "" } },
    ),

  adminWalletBeforeAfter: (filters?: {
    status?: string;
    start_date?: string;
    end_date?: string;
    q?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.start_date) params.set("start_date", filters.start_date);
    if (filters?.end_date) params.set("end_date", filters.end_date);
    if (filters?.q) params.set("q", filters.q);
    const query = params.toString();
    return api<import("./types").WalletBeforeAfterListResponse>(
      `/api/admin/statement/before-after/${query ? `?${query}` : ""}`,
    );
  },

  adminWalletBeforeAfterScan: (payload: {
    from_date: string;
    to_date: string;
    user_id?: number;
  }) =>
    api<import("./types").WalletBeforeAfterListResponse>(
      "/api/admin/statement/before-after/scan/",
      { method: "POST", body: payload },
    ),

  adminWalletBeforeAfterShare: (id: number) =>
    api<{
      message: string;
      data: import("./types").WalletBalanceIssue;
      adjustment_id: number | null;
      balance_before: string | null;
      balance_after: string | null;
    }>(`/api/admin/statement/before-after/${id}/share/`, { method: "POST", body: {} }),

  adminTestSmtpEmail: (payload: {
    to_email: string;
    host?: string;
    port?: number;
    encryption?: string;
    smtp_email?: string;
    smtp_password?: string;
    smtp_email_from?: string;
    smtp_name?: string;
    username?: string;
    password?: string;
    from_name?: string;
    from_email?: string;
  }) =>
    api<{ ok: boolean; message: string; to_email?: string }>("/api/admin/settings/test-email/", {
      method: "POST",
      body: payload,
    }),
};
