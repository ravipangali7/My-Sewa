export type DepositStatus = "pending" | "approved" | "rejected";
export type TxnStatus = "pending" | "success" | "failed";
export type ActivityKind = "deposit" | "remittance" | "topup" | "transfer" | "internet" | "data_pack";

/** Account approval status — pending users can log in but cannot transact. */
export type AccountStatus = "pending" | "approved";

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
  /** `pending` = Pending (yellow), `approved` = Active (green) */
  account_status?: AccountStatus;
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
  remittances_enabled: boolean;
  internet_bills_enabled: boolean;
  data_packs_enabled: boolean;
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

export interface RemittanceAgentConfig {
  payout_location_name: string;
  payout_agent_state: string;
  payout_agent_district: string;
  payout_agent_municipality: string;
  payout_agent_ward_number: string;
  payout_agent_pan_number: string;
  teller_contact: string;
  payout_payment_type: string;
  payout_payment_number: string;
  payout_payment_bank_name: string;
  payout_payment_bank_branch: string;
}

export interface AppConfig {
  site: SiteConfig;
  payment: PaymentConfig;
  transactions: TransactionsConfig;
  notifications: NotificationsConfig;
  security: SecurityConfig;
  integrations?: IntegrationsConfig;
  remittance?: RemittanceAgentConfig;
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

export interface RemittanceLookup {
  ref_no: string;
  samsara_link_id: string;
  amount: string;
  payout_currency: string;
  sender_name: string;
  sender_address: string;
  sender_city: string;
  sender_country: string;
  sender_mobile: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_address: string;
  receiver_city: string;
  receiver_country: string;
  payment_type: string;
  send_agent: string;
  txn_date: string;
  status: string;
}

export interface RemittanceTransaction {
  id: number;
  user: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  ref_no: string;
  samsara_link_id: string;
  amount: string;
  payout_currency: string;
  sender_name: string;
  sender_address: string;
  sender_city: string;
  sender_country: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_country: string;
  payment_type: string;
  txn_date: string;
  beneficiary_gender: string;
  beneficiary_nationality: string;
  beneficiary_state: string;
  beneficiary_district: string;
  beneficiary_municipality: string;
  beneficiary_ward_number: string;
  beneficiary_city: string;
  beneficiary_address: string;
  beneficiary_relation: string;
  beneficiary_occupation: string;
  beneficiary_citizenship_number: string;
  beneficiary_citizenship_issuing_district: string;
  beneficiary_id_type: string;
  beneficiary_id_number: string;
  beneficiary_id_issue_date: string;
  beneficiary_id_issue_by: string;
  beneficiary_mobile_no: string;
  beneficiary_dob: string;
  remittance_purpose: string;
  status: TxnStatus;
  status_display: string;
  merchant_txn_id: string;
  provider_txn_id: string | null;
  reference_id: string | null;
  charge: string;
  cashback: string;
  total_credited: string;
  wallet_credited: boolean;
  lookup_response?: Record<string, unknown> | null;
  provider_response?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface InternetBillTransaction {
  id: number;
  user: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  isp_id: string;
  isp_name: string;
  customer_id: string;
  customer_name: string;
  package_name: string;
  amount: string;
  status: TxnStatus;
  status_display: string;
  merchant_txn_id: string;
  service_hub_txn_id: string | null;
  charge: string;
  cashback: string;
  total_debited: string;
  reference_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface IspOption {
  id: string;
  name: string;
  customer_label: string;
  placeholder: string;
  color?: string;
  pay_service?: string;
  logo_image_url?: string | null;
}

export interface InternetBillPackage {
  id: string;
  name: string;
  amount: string;
  billing_period?: string | number | null;
  customer_name?: string | null;
  pay_data: Record<string, unknown>;
}

export interface InternetBillInquiry {
  isp_id: string;
  isp_name: string;
  customer_id: string;
  customer_name?: string | null;
  current_package?: string | null;
  billing_period?: string | null;
  due_date?: string | null;
  address?: string | null;
  phone?: string | null;
  subscription_status?: string | null;
  payable_amount?: string | null;
  packages: InternetBillPackage[];
}

export interface DataPackTransaction {
  id: number;
  user: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  operator: "NTC" | "NCELL";
  mobile_number: string;
  package_name: string;
  package_id: string;
  product_code: string;
  amount: string;
  status: TxnStatus;
  status_display: string;
  merchant_txn_id: string;
  service_hub_txn_id: string | null;
  charge: string;
  cashback: string;
  total_debited: string;
  reference_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DataPackOption {
  id: string;
  name: string;
  amount: string;
  description?: string | null;
  validity?: string | number | null;
  volume?: string | null;
  package_id: string;
  product_code: string;
  operator: string;
}

export interface WalletTransactions {
  deposits: Deposit[];
  remittances?: RemittanceTransaction[];
  topups: TopupTransaction[];
  bank_transfers: BankTransferTransaction[];
  internet_bills?: InternetBillTransaction[];
  data_packs?: DataPackTransaction[];
}

export interface BankOption {
  bank_code: string;
  bank_name: string;
}

export interface ChargePreview {
  amount: string;
  amount_paisa?: number;
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
  account_status?: AccountStatus;
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

export interface AdminListStats {
  total: number;
  success: number;
  pending: number;
  failed: number;
  wallet_float?: string;
}

export interface AdminListResponse<T> {
  items: T[];
  stats: AdminListStats;
}
