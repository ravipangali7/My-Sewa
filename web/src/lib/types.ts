export type DepositStatus = "pending" | "approved" | "rejected";
export type TxnStatus = "pending" | "success" | "failed";
export type ActivityKind = "deposit" | "topup" | "transfer";

export interface UserProfile {
  id: number;
  phone: string;
  email: string | null;
  first_name: string;
  last_name: string;
  avatar: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  date_joined: string;
  last_login: string | null;
}

export interface Wallet {
  id: number;
  user: string;
  phone: string;
  balance: string;
  created_at: string;
  updated_at: string;
}

export interface BankDetails {
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  branch?: string;
  [key: string]: string | undefined;
}

export interface SiteConfig {
  site_name: string;
  tagline: string;
  support_email: string;
  support_phone: string;
  address: string;
  currency: string;
  timezone: string;
}

export interface PaymentConfig {
  deposits_enabled: boolean;
  topups_enabled: boolean;
  transfers_enabled: boolean;
  min_deposit: number;
  max_deposit: number;
  deposit_instructions: string;
}

export interface TransactionsConfig {
  min_topup: number;
  max_topup: number;
  min_transfer: number;
  max_transfer: number;
  topup_charge_percent: number;
  transfer_charge_enabled: boolean;
  transfer_charge_flat: number;
  cashback_enabled: boolean;
  transfer_cashback_flat: number;
  transfer_cashback_percent: number;
  daily_transfer_limit: number;
  /** When true, deposit/top-up/transfer finalize as approved/success without admin review */
  auto_status_verified: boolean;
}

export interface NotificationsConfig {
  email_on_deposit: boolean;
  email_on_topup: boolean;
  sms_on_deposit_approved: boolean;
  admin_alert_email: string;
  notify_low_balance: boolean;
  low_balance_threshold: number;
}

export interface SecurityConfig {
  require_deposit_screenshot: boolean;
  max_failed_logins: number;
  session_timeout_minutes: number;
  maintenance_mode: boolean;
  maintenance_message: string;
  allow_new_registrations: boolean;
}

export interface IntegrationsConfig {
  himalpay_api_key: string;
  himalpay_base_url: string;
}

export interface AppConfig {
  site: SiteConfig;
  payment: PaymentConfig;
  transactions: TransactionsConfig;
  notifications: NotificationsConfig;
  security: SecurityConfig;
  integrations?: IntegrationsConfig;
}

export interface AppSettings {
  id: number;
  qr_code: string | null;
  qr_code_url: string | null;
  logo: string | null;
  logo_url: string | null;
  bank_details: BankDetails;
  config: AppConfig;
  created_at: string;
  updated_at: string;
}

export interface Deposit {
  id: number;
  user: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  amount: string;
  status: DepositStatus;
  status_display: string;
  screenshot_proof: string | null;
  note: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopupTransaction {
  id: number;
  user: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  mobile_number: string;
  amount: string;
  product_id: 1 | 2;
  product_name: string;
  status: TxnStatus;
  status_display: string;
  service_hub_txn_id: string | null;
  merchant_txn_id: string;
  charge: string;
  cashback: string;
  total_debited: string;
  reference_id: string | null;
  provider_response?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface BankTransferTransaction {
  id: number;
  user: string;
  phone: string;
  amount: string;
  destination_bank: string;
  destination_bank_name: string;
  destination_acc_no: string;
  destination_acc_name: string;
  is_destination_mobile: boolean;
  transaction_remarks: string;
  transaction_remarks_2: string;
  transaction_remarks_3: string;
  status: TxnStatus;
  status_display: string;
  merchant_txn_id: string;
  provider_txn_id: string | null;
  reference_id: string | null;
  charge: string;
  cashback: string;
  total_debited: string;
  verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface WalletTransactions {
  deposits: Deposit[];
  topups: TopupTransaction[];
  bank_transfers: BankTransferTransaction[];
}

export interface BankOption {
  bank_code: string;
  bank_name: string;
}

export interface ChargePreview {
  amount: string;
  charge: string;
  cashback: string;
  total_debited: string;
  platform_charge?: string;
  charge_enabled?: boolean;
  cashback_enabled?: boolean;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  subtitle: string;
  amount: string;
  credit: boolean;
  status: DepositStatus | TxnStatus;
  created_at: string;
}

export interface AdminUser extends UserProfile {
  wallet_id: number | null;
  wallet_balance: string;
}

export interface AdminUserWritePayload {
  phone: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  is_active?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  password?: string;
  password2?: string;
}

export interface AdminWallet {
  id: number;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  balance: string;
  created_at: string;
  updated_at: string;
}

export interface AdminDashboard {
  kpis: {
    total_users: number;
    wallet_float: string;
    pending_deposits: number;
    topups_today: number;
    transfers_today: number;
  };
  volume_series: Array<{
    day: string;
    date?: string;
    deposits: number;
    topups: number;
    transfers: number;
  }>;
  operator_split: Array<{ name: string; value: number }>;
  pending_deposits: Deposit[];
}
