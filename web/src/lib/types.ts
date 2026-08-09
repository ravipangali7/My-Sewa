export type DepositStatus = "pending" | "approved" | "rejected";
/** Denormalized KYC status on the user (mirrors latest submission). */
export type KycStatus = "not_submitted" | "pending" | "approved" | "rejected";
export type KycSubmissionStatus = "pending" | "approved" | "rejected";
export type KycDocumentType =
  | "citizenship"
  | "passport"
  | "driving_license"
  | "national_id"
  | "other";
/** Document side — Task 14 owns front/back UX; API default is `single`. */
export type KycDocumentSide = "front" | "back" | "single";
export type TxnStatus = "pending" | "success" | "failed";
export type ActivityKind =
  | "deposit"
  | "remittance"
  | "topup"
  | "transfer"
  | "internet"
  | "data_pack"
  | "water"
  | "community_electricity"
  | "wallet_adjustment";
export type WalletAdjustmentType = "credit" | "debit";

/** Account approval status — pending users can log in but cannot transact. */
export type AccountStatus = "pending" | "approved";

export interface KycDocument {
  id: number;
  document_type: KycDocumentType;
  document_type_display: string;
  side: KycDocumentSide;
  side_display: string;
  file: string | null;
  file_url: string | null;
  uploaded_at: string;
}

export interface KycSubmission {
  id: number;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  /** AD ISO date `YYYY-MM-DD` from the account holder profile. */
  date_of_birth?: string | null;
  status: KycSubmissionStatus;
  status_display: string;
  citizenship_number: string;
  rejection_reason: string;
  reviewed_by: number | null;
  reviewed_by_phone: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  documents: KycDocument[];
  created_at: string;
  updated_at: string;
}

export interface KycStatusPayload {
  kyc_status: KycStatus;
  citizenship_number: string;
  /** True when `kyc_status === "approved"`. */
  kyc_verified: boolean;
  /** Identity fields locked after KYC verification. */
  profile_locked: boolean;
  can_submit: boolean;
  submission: KycSubmission | null;
}

export interface UserProfile {
  id: number;
  phone: string;
  email: string | null;
  first_name: string;
  last_name: string;
  /** Friendly display / profile nickname. */
  nickname?: string;
  /** Business or shop name. */
  business_name?: string;
  /** AD ISO date `YYYY-MM-DD`, or null for legacy users who have not set it yet. */
  date_of_birth: string | null;
  /** Citizenship / national ID from KYC (read-only after verification). */
  citizenship_number?: string | null;
  /** Denormalized KYC workflow status from the profile API. */
  kyc_status?: KycStatus | null;
  /** True when KYC is approved — identity fields are locked. Always returned by profile API. */
  kyc_verified: boolean;
  /** Alias for identity lock; same as kyc_verified when true. Always returned by profile API. */
  profile_locked: boolean;
  avatar: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  /** `pending` = Pending (yellow), `approved` = Active (green) */
  account_status?: AccountStatus;
  /** Whether a transaction PIN is set (never the raw PIN). */
  has_transaction_pin?: boolean;
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

export type PaymentMethod = "bank" | "khalti" | "esewa";

export interface PaymentAccount {
  id: string;
  method: PaymentMethod;
  label: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  branch?: string;
  enabled?: boolean;
}

export interface BankDetails {
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  branch?: string;
  /** Multiple deposit destinations (bank / Khalti / eSewa). */
  accounts?: PaymentAccount[];
  [key: string]: string | PaymentAccount[] | undefined;
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
  water_bills_enabled: boolean;
  community_electricity_enabled: boolean;
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
  email_on_wallet_credit: boolean;
  email_on_wallet_debit: boolean;
  email_on_transfer: boolean;
  email_on_wallet_adjustment: boolean;
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
  /** Optional HimalPay app/portal login for LIVE statement + balance fallback */
  himalpay_portal_phone?: string;
  himalpay_portal_email?: string;
  himalpay_portal_password?: string;
}

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** tls | ssl | none */
  encryption: "tls" | "ssl" | "none";
  /** Login email / username for the SMTP server */
  smtp_email: string;
  smtp_password: string;
  /** Envelope From address */
  smtp_email_from: string;
  /** Envelope From display name */
  smtp_name: string;
  /** Legacy aliases (kept in sync with smtp_* fields) */
  username?: string;
  password?: string;
  from_email?: string;
  from_name?: string;
  /** Present on admin GET when a password is stored */
  password_set?: boolean;
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
  smtp?: SmtpConfig;
  remittance?: RemittanceAgentConfig;
}

export interface AppSettings {
  id: number;
  /** Bank deposit QR (legacy field name) */
  qr_code: string | null;
  qr_code_url: string | null;
  khalti_qr_code: string | null;
  khalti_qr_code_url: string | null;
  esewa_qr_code: string | null;
  esewa_qr_code_url: string | null;
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
  transaction_id: string;
  deposit_date: string | null;
  bank_name: string;
  screenshot_proof: string | null;
  note: string | null;
  rejection_reason: string | null;
  balance_before: string | null;
  balance_after: string | null;
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
  balance_before: string | null;
  balance_after: string | null;
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
  balance_before: string | null;
  balance_after: string | null;
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
  balance_before: string | null;
  balance_after: string | null;
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
  balance_before: string | null;
  balance_after: string | null;
  reference_id: string | null;
  created_at: string;
  updated_at: string;
  provider_response?: Record<string, unknown> | null;
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
  balance_before: string | null;
  balance_after: string | null;
  reference_id: string | null;
  created_at: string;
  updated_at: string;
  provider_response?: Record<string, unknown> | null;
}

export interface WaterBillTransaction {
  id: number;
  user: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  connection_no: string;
  customer_code: string;
  counter: string;
  customer_name: string;
  session_id: string;
  payment_type: string;
  amount: string;
  pay_service: string;
  status: TxnStatus;
  status_display: string;
  merchant_txn_id: string;
  service_hub_txn_id: string | null;
  charge: string;
  cashback: string;
  total_debited: string;
  balance_before: string | null;
  balance_after: string | null;
  reference_id: string | null;
  created_at: string;
  updated_at: string;
  provider_response?: Record<string, unknown> | null;
}

export interface CommunityElectricityTransaction {
  id: number;
  user: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  platform_id: string;
  platform_name: string;
  service_slug: string;
  counter_code: string;
  customer_ref: string;
  consumer_id: string;
  customer_name: string;
  month: number | null;
  session_id: string;
  amount: string;
  pay_service: string;
  status: TxnStatus;
  status_display: string;
  merchant_txn_id: string;
  service_hub_txn_id: string | null;
  charge: string;
  cashback: string;
  total_debited: string;
  balance_before: string | null;
  balance_after: string | null;
  reference_id: string | null;
  created_at: string;
  updated_at: string;
  provider_response?: Record<string, unknown> | null;
}

export interface UtilityInquiry {
  session_id: string | number | null;
  raw?: unknown;
  connection_no?: string;
  customer_code?: string;
  counter?: string;
  customer_ref?: string;
  customer_name?: string | null;
  payable_amount?: string | null;
  platform_id?: string;
  [key: string]: unknown;
}

export interface CommunityProviderOption {
  id: string;
  name: string;
  steps: number;
  customer_field: string;
  customer_label: string;
  placeholder: string;
  inquiry_fields: string[];
  default_service_slug?: string | null;
  has_counters?: boolean;
  has_slugs?: boolean;
  color?: string;
  pay_service?: string;
  logo_image_url?: string | null;
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

export interface WalletAdjustment {
  id: number;
  wallet: number;
  user: number;
  amount: string;
  display_amount: string;
  adjustment_type: WalletAdjustmentType;
  adjustment_type_display: string;
  balance_before: string;
  balance_after: string;
  reason: string;
  created_by: number | null;
  created_by_phone: string | null;
  created_at: string;
  reference: string | null;
}

export interface WalletTransactions {
  deposits: Deposit[];
  remittances?: RemittanceTransaction[];
  topups: TopupTransaction[];
  bank_transfers: BankTransferTransaction[];
  internet_bills?: InternetBillTransaction[];
  data_packs?: DataPackTransaction[];
  water_bills?: WaterBillTransaction[];
  community_electricity?: CommunityElectricityTransaction[];
  wallet_adjustments?: WalletAdjustment[];
  summary?: AmountSummary;
}

export interface AmountSummary {
  total_volume: number;
  total_amount: number;
  today_amount: number;
  monthly_amount: number;
  total_credit?: number;
  total_debit?: number;
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
  balance_before?: string | null;
  balance_after?: string | null;
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

/** Per-user fee overrides — null means use global Settings defaults. */
export interface UserFeeConfig {
  transfer_charge_enabled: boolean | null;
  transfer_charge_flat: string | number | null;
  transfer_charge_percent: string | number | null;
  topup_charge_percent: string | number | null;
  updated_at?: string;
}

export type UserFeeConfigPayload = {
  transfer_charge_enabled?: boolean | null;
  transfer_charge_flat?: string | number | null;
  transfer_charge_percent?: string | number | null;
  topup_charge_percent?: string | number | null;
};

export interface UserFeeDefaults {
  transfer_charge_enabled: boolean;
  transfer_charge_flat: number;
  transfer_charge_percent: number;
  topup_charge_percent: number;
}

export interface AdminUserFeesResponse {
  user_id: number;
  fees: UserFeeConfig;
  defaults: UserFeeDefaults;
  message?: string;
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
    open_statement_issues?: number;
  };
  summary?: AmountSummary;
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

export interface AdminReportCategory {
  label: string;
  count: number;
  volume: number;
  success_count: number;
  success_volume: number;
  pending_count: number;
  pending_volume: number;
  failed_count: number;
  failed_volume: number;
  success_rate: number;
}

export interface AdminReports {
  range: {
    start_date: string;
    end_date: string;
    days: number;
  };
  summary: {
    total_users: number;
    new_users: number;
    wallet_float: string;
    total_transactions: number;
    success_volume: number;
    success_count: number;
    pending_count: number;
    failed_count: number;
    success_rate: number;
    total_volume?: number;
    total_amount?: number;
    total_credit?: number;
    total_debit?: number;
    today_amount?: number;
    monthly_amount?: number;
  };
  categories: Record<string, AdminReportCategory>;
  volume_series: Array<{
    date: string;
    label: string;
    deposits: number;
    topups: number;
    transfers: number;
    remittances: number;
    internet_bills: number;
    data_packs: number;
    total: number;
  }>;
  service_mix: Array<{ key: string; name: string; value: number; count: number }>;
  status_mix: Array<{ name: string; value: number; volume: number }>;
  operator_split: Array<{ name: string; value: number; count: number }>;
  isp_split: Array<{ name: string; value: number; count: number }>;
  user_series: Array<{ date: string; label: string; users: number }>;
  recent: {
    deposits: Deposit[];
    topups: TopupTransaction[];
    transfers: BankTransferTransaction[];
    remittances: RemittanceTransaction[];
  };
}

export interface AdminUserReport {
  user: {
    id: number;
    phone: string;
    first_name: string;
    last_name: string;
    email: string;
  };
  range: {
    start_date: string;
    end_date: string;
    days: number;
  };
  wallet_balance: string;
  summary: {
    total_deposits: number;
    total_transfers: number;
    total_topups: number;
    total_wallet_credits: number;
    total_wallet_debits: number;
    transaction_volume: number;
    charges: number;
    total_transactions: number;
    success_count: number;
  };
  balance_summary: {
    current_balance: string;
    credits: number;
    debits: number;
    net: number;
    charges: number;
    breakdown: {
      deposit_credits: number;
      remittance_credits: number;
      adjustment_credits: number;
      topup_debits: number;
      transfer_debits: number;
      internet_debits: number;
      datapack_debits: number;
      adjustment_debits: number;
    };
  };
  categories: Record<string, AdminReportCategory>;
  volume_series: Array<{
    date: string;
    label: string;
    deposits: number;
    topups: number;
    transfers: number;
    remittances: number;
    internet_bills: number;
    data_packs: number;
    total: number;
  }>;
  service_mix: Array<{ key: string; name: string; value: number; count: number }>;
  charges_breakdown: {
    topups: number;
    transfers: number;
    remittances: number;
    internet_bills: number;
    data_packs: number;
  };
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
  summary?: AmountSummary;
}

export interface StatementReconcileRun {
  id: number;
  from_date: string;
  to_date: string;
  triggered_by: string;
  triggered_by_display: string;
  triggered_by_user: number | null;
  triggered_by_user_phone: string | null;
  status: string;
  status_display: string;
  hp_entries: number;
  matched: number;
  issues_open: number;
  issues_new: number;
  himalpay_balance_paisa: number | null;
  himalpay_bonus_balance_paisa: number | null;
  himalpay_balance_rupees: string | null;
  error_message: string;
  created_at: string;
  finished_at: string | null;
}

export interface StatementDiscrepancy {
  id: number;
  run: number;
  issue_type: string;
  issue_type_display: string;
  status: string;
  status_display: string;
  transaction_uuid: string;
  merchant_txn_id: string;
  wallet_service_name: string;
  direction: string;
  hp_status: string;
  hp_amount: string;
  hp_net_amount: string;
  local_status: string;
  local_amount: string | null;
  txn_type: string;
  txn_type_display: string;
  txn_id: number | null;
  user: number | null;
  user_phone: string | null;
  user_name: string | null;
  himalpay_snapshot: Record<string, unknown>;
  suggested_adjustment_type: string;
  suggested_amount: string | null;
  reason: string;
  can_solve: boolean;
  resolved_by: number | null;
  resolved_at: string | null;
  resolution_adjustment: number | null;
  created_at: string;
  updated_at: string;
}

export interface StatementListResponse {
  summary: {
    open_issues: number;
    by_issue_type: Record<string, number>;
    latest_run: StatementReconcileRun | null;
  };
  items: StatementDiscrepancy[];
  count: number;
}
