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
  | "electricity"
  | "community_electricity"
  | "wallet_adjustment"
  | "wallet_transfer";
export type WalletAdjustmentType = "credit" | "debit";

/** Account approval status — pending users can log in but cannot transact. */
export type AccountStatus = "pending" | "approved";

export type UserRole = "customer" | "dealer";

export interface RelatedUserBrief {
  id: number;
  phone: string;
  name: string;
  role?: UserRole | string;
}

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
  /** Hierarchy role. Staff/superuser remain Admin regardless of this field. */
  role?: UserRole;
  assigned_dealer_id?: number | null;
  parent_agent_id?: number | null;
  assigned_sub_agent_id?: number | null;
  assigned_dealer?: RelatedUserBrief | null;
  parent_agent?: RelatedUserBrief | null;
  assigned_sub_agent?: RelatedUserBrief | null;
  /** When false, this user cannot perform fund transfers. Defaults to true. */
  can_fund_transfer?: boolean;
  /** When false, this user cannot perform wallet adjustments. Defaults to true. */
  can_wallet_adjust?: boolean;
  /** When false, this user cannot initiate remittance fund transfers. Defaults to true. */
  can_remittance_transfer?: boolean;
  wallet_frozen?: boolean;
  wallet_status?: "frozen" | "unfrozen";
  commission_rate?: string | null;
  tds_rate?: string | null;
  sub_agent_commission_rate?: string | null;
  super_admin_rate?: string | null;
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
  transactions_blocked?: boolean;
  blocked_reason?: string;
  blocked_at?: string | null;
  is_frozen?: boolean;
  freeze_reason?: string;
  frozen_at?: string | null;
  wallet_status?: "frozen" | "unfrozen";
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
  /** Relative media path for this account's QR (admin / storage). */
  qr_code?: string;
  /** Absolute URL for this account's QR (API-enriched). */
  qr_code_url?: string | null;
  /** Dealer payout account id when this destination is a dealer collection account. */
  payout_account_id?: number;
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
  electricity_bills_enabled: boolean;
  community_electricity_enabled: boolean;
  min_deposit: number;
  max_deposit: number;
  deposit_instructions: string;
}

export type ChargeType = "flat" | "percent";

export interface ServiceChargeConfig {
  txn_type: string;
  label: string;
  user_charge_type?: ChargeType;
  system_charge_flat: string;
  system_charge_percent: string;
  dealer_charge_type?: ChargeType;
  dealer_commission_flat: string;
  dealer_commission_percent: string;
  himalpay_charge_flat: string;
  himalpay_charge_percent: string;
  updated_at?: string | null;
}

export interface CommissionSetupDealer {
  id: number;
  name: string;
  phone: string;
  commission_amount: string;
  user_count: number;
}

export interface CommissionSetupUser {
  id: number;
  name: string;
  phone: string;
  cashback: string;
}

export interface CommissionSetupDealerDetail {
  id: number;
  name: string;
  phone: string;
  commission_amount: string;
  users: CommissionSetupUser[];
}

export interface CommissionConfig {
  /** Default flat dealer commission in Rs when a dealer has no per-user amount. */
  default_commission_rate: number;
  default_sub_agent_rate?: number;
  default_super_admin_rate?: number;
  /** Default TDS percent of gross commission when a dealer has no override. */
  default_tds_rate: number;
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
  /** When true, users must verify OTP after password login. */
  otp_login_enabled: boolean;
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
  commission?: CommissionConfig;
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
  /** When true, the Android app auto-downloads and installs the APK if versions differ */
  auto_update_enabled?: boolean;
  /** Latest Android version string compared with Flutter AppConstant.appVersion */
  app_version?: string;
  apk?: string | null;
  apk_url?: string | null;
  bank_details: BankDetails;
  config: AppConfig;
  created_at: string;
  updated_at: string;
}

export interface HomePopup {
  id: number;
  title: string;
  body: string;
  image: string | null;
  image_url: string | null;
  max_per_24h: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AdminPushStatus {
  configured: boolean;
  mode: "http_v1" | "legacy" | "none" | string;
  project_id: string | null;
  device_count: number;
  stub_count?: number;
  user_count: number;
  platform_counts: { platform: string; count: number }[];
}

export interface AdminPushSendResult {
  message: string;
  sent: number;
  failed: number;
  skipped: number;
  target_count: number;
  issue?: string | null;
}

export interface AdminPushNotification {
  id: number;
  title: string;
  body: string;
  audience: "all" | "user" | string;
  audience_display: string;
  target_phone: string;
  target_user_phone: string | null;
  sent_by_phone: string | null;
  sent: number;
  failed: number;
  skipped: number;
  target_count: number;
  created_at: string;
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
  payout_account_id?: number | null;
  payout_account?: {
    id: number;
    method: PaymentMethod;
    label: string;
    account_name: string;
    account_number: string;
    dealer_id: number;
  } | null;
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
  provider_charge?: string;
  platform_charge?: string;
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
  citizenship_front?: string | null;
  citizenship_back?: string | null;
  status: TxnStatus;
  status_display: string;
  citizenship_review_pending?: boolean;
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

export interface ElectricityBillTransaction {
  id: number;
  user: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  sc_no: string;
  consumer_id: string;
  office_code: string;
  office_name: string;
  customer_name: string;
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
  kind?: "manual" | "cashback" | "dealer_commission";
  source_txn_type?: string;
  source_txn_id?: number | null;
  balance_before: string;
  balance_after: string;
  reason: string;
  created_by: number | null;
  created_by_phone: string | null;
  created_at: string;
  reference: string | null;
}

export interface WalletTransfer {
  id: number;
  amount: string;
  remarks: string;
  status: TxnStatus;
  reference: string;
  created_at: string;
  sender: number;
  sender_phone: string;
  sender_name: string;
  recipient: number;
  recipient_phone: string;
  recipient_name: string;
  direction: "sent" | "received";
  counterparty_phone: string;
  counterparty_name: string;
  balance_before: string;
  balance_after: string;
  sender_balance_before: string;
  sender_balance_after: string;
  recipient_balance_before: string;
  recipient_balance_after: string;
}

export interface PushBalanceUser {
  id: number;
  phone: string;
  email: string | null;
  first_name: string;
  last_name: string;
  nickname?: string;
  business_name?: string;
  role: UserRole | string;
  account_status?: AccountStatus;
  is_active: boolean;
  display_name: string;
  role_label: string;
  wallet_balance: string;
  wallet_frozen: boolean;
}

export interface WalletTransactions {
  deposits: Deposit[];
  remittances?: RemittanceTransaction[];
  topups: TopupTransaction[];
  bank_transfers: BankTransferTransaction[];
  internet_bills?: InternetBillTransaction[];
  data_packs?: DataPackTransaction[];
  water_bills?: WaterBillTransaction[];
  electricity_bills?: ElectricityBillTransaction[];
  community_electricity?: CommunityElectricityTransaction[];
  wallet_adjustments?: WalletAdjustment[];
  wallet_transfers?: WalletTransfer[];
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
  system_charge?: string;
  dealer_commission?: string;
  himalpay_charge?: string;
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
  role?: UserRole;
  assigned_dealer?: number | null;
  parent_agent?: number | null;
  can_fund_transfer?: boolean;
  can_wallet_adjust?: boolean;
  can_remittance_transfer?: boolean;
  commission_rate?: string | number | null;
  tds_rate?: string | number | null;
  sub_agent_commission_rate?: string | number | null;
  super_admin_rate?: string | number | null;
  assigned_sub_agent?: number | null;
  password?: string;
  password2?: string;
}

export type PayoutAccountStatus = "pending" | "approved" | "rejected";

export interface DealerPayoutAccount {
  id: number;
  dealer_id: number;
  dealer_phone: string;
  dealer_name: string;
  method: PaymentMethod;
  method_display: string;
  label: string;
  account_name: string;
  account_number: string;
  bank_name: string;
  branch: string;
  qr_code: string | null;
  qr_code_url: string | null;
  status: PayoutAccountStatus;
  status_display: string;
  rejection_reason: string;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepositDestinationBucket {
  bank_details: BankDetails | null;
  qr_code_url?: string | null;
  khalti_qr_code_url?: string | null;
  esewa_qr_code_url?: string | null;
  dealer_id?: number;
  dealer_phone?: string | null;
  dealer_name?: string | null;
}

export interface DepositDestinations {
  source: "dealer" | "platform";
  available_sources: Array<"dealer" | "platform">;
  can_use_dealer: boolean;
  dealer_id: number | null;
  dealer_phone: string | null;
  dealer_name: string | null;
  bank_details: BankDetails | null;
  qr_code_url?: string | null;
  khalti_qr_code_url?: string | null;
  esewa_qr_code_url?: string | null;
  platform: DepositDestinationBucket;
  dealer: DepositDestinationBucket | null;
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
  transactions_blocked?: boolean;
  blocked_reason?: string;
  blocked_at?: string | null;
  blocked_merchant_txn_id?: string;
  unblocked_at?: string | null;
  unblocked_by?: number | null;
  is_frozen?: boolean;
  freeze_reason?: string;
  frozen_at?: string | null;
  frozen_by?: number | null;
  freeze_unfrozen_at?: string | null;
  freeze_unfrozen_by?: number | null;
  wallet_status?: "frozen" | "unfrozen";
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
    commission_today?: number;
    commission_total?: number;
    total_dealers?: number;
    total_sub_agents?: number;
    total_customers?: number;
    dealer_commission_today?: number;
    tds_today?: number;
    super_admin_profit_today?: number;
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

export interface CommissionEarnings {
  total_earnings: number;
  today_earnings: number;
  monthly_earnings: number;
  total_charges: number;
  total_provider_charges: number;
  transfer_volume: number;
  earning_count: number;
}

export interface CommissionHistoryItem {
  id: number;
  user: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  amount: string;
  destination_bank: string;
  destination_bank_name: string;
  destination_acc_no: string;
  destination_acc_name: string;
  is_destination_mobile: boolean;
  transaction_remarks: string;
  status: TxnStatus;
  status_display: string;
  merchant_txn_id: string;
  provider_txn_id: string | null;
  charge: string;
  provider_charge: string;
  platform_charge: string;
  commission: string;
  earned: string;
  cashback: string;
  total_debited: string;
  source: "bank_transfer";
  created_at: string;
  updated_at: string;
}

export interface CommissionHistoryResponse {
  items: CommissionHistoryItem[];
  stats: AdminListStats;
  earnings: CommissionEarnings;
  summary?: AmountSummary;
}

export interface DealerCommissionItem {
  id: number;
  dealer: number;
  dealer_phone: string;
  dealer_name: string;
  source_user: number | null;
  source_phone: string | null;
  source_name: string;
  sub_agent?: number | null;
  sub_agent_phone?: string | null;
  sub_agent_name?: string;
  txn_type: string;
  txn_type_display: string;
  txn_id: number;
  reference: string;
  txn_amount: string;
  commission_rate: string;
  gross_commission: string;
  tds_rate: string;
  tds_amount: string;
  net_commission: string;
  sub_agent_commission_rate?: string;
  sub_agent_commission?: string;
  super_admin_rate?: string;
  super_admin_profit?: string;
  status: "posted" | "reversed" | string;
  status_display: string;
  created_at: string;
  updated_at: string;
}

export interface DealerCommissionEarnings {
  gross_commission: number;
  tds_amount: number;
  net_commission: number;
  today_net?: number;
  monthly_net?: number;
  sales?: number;
  sub_agent_commission?: number;
  super_admin_profit?: number;
  count?: number;
}

export interface DealerCommissionResponse {
  items: DealerCommissionItem[];
  stats: AdminListStats;
  earnings: DealerCommissionEarnings;
  summary?: AmountSummary;
}

/** Unified Super Admin ledger row for every wallet-moving transaction. */
export interface AdminSystemTransaction {
  id: string;
  record_id: number;
  kind: ActivityKind;
  amount: string;
  credit: boolean;
  status: DepositStatus | TxnStatus;
  reference: string;
  detail: string;
  balance_before: string | null;
  balance_after: string | null;
  created_at: string;
  user_id: number;
  phone: string;
  first_name: string;
  last_name: string;
  wallet_id: number | null;
}

export type AdminTransactionKindCounts = { all: number } & Record<ActivityKind, number>;

export interface AdminTransactionHistoryResponse {
  items: AdminSystemTransaction[];
  stats: AdminListStats;
  type_counts: AdminTransactionKindCounts;
  summary?: AmountSummary;
}

/** HimalPay GET /wallet/reseller-balance (amounts: paisa + rupees fields). */
export interface HimalPayResellerBalance {
  id?: number;
  user_id?: number;
  /** Main wallet balance in paisa */
  balance?: number | string | null;
  /** Bonus wallet balance in paisa */
  bonus_balance?: number | string | null;
  balance_in_rupees?: number | string | null;
  bonus_balance_in_rupees?: number | string | null;
  total_balance_in_rupees?: number | string | null;
  created_at?: string;
  updated_at?: string;
  /** How MySewa resolved the live balance */
  source?: string;
  [key: string]: unknown;
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
  himalpay_statement_logs?: Record<string, unknown>[];
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
  can_correct?: boolean;
  resolved_by: number | null;
  resolved_at: string | null;
  resolution_adjustment: number | null;
  created_at: string;
  updated_at: string;
}

export interface StatementLedgerHpSide {
  transaction_uuid: string;
  created_at: string | null;
  service: string;
  direction: string;
  status: string;
  principal_amount: string;
  net_amount: string;
  charge: string;
  cashback: string;
  reference_id: string;
  merchant_txn_id?: string;
  balance_before?: string | null;
  balance_after?: string | null;
}

export interface StatementLedgerMySewaSide {
  txn_type: string;
  txn_type_display: string;
  txn_id: number;
  merchant_txn_id: string;
  provider_txn_id: string;
  status: string;
  amount: string;
  user_id: number | null;
  user_phone: string | null;
  user_name: string | null;
  created_at: string | null;
  wallet_applied: boolean;
  balance_before?: string | null;
  balance_after?: string | null;
}

export interface StatementLedgerRow {
  key: string;
  match_state: string;
  himalpay: StatementLedgerHpSide | null;
  mysewa: StatementLedgerMySewaSide | null;
  discrepancy_id: number | null;
  suggested_adjustment_type: string;
  suggested_amount: string | null;
  reason: string;
  can_solve: boolean;
  can_correct: boolean;
  user_id: number | null;
  user_phone?: string | null;
  user_name?: string | null;
}

export interface StatementLedgerUserGroup {
  user_id: number | null;
  user_phone: string | null;
  user_name: string | null;
  row_count: number;
  issue_count: number;
  rows: StatementLedgerRow[];
}

export interface StatementListResponse {
  summary: {
    open_issues: number;
    by_issue_type: Record<string, number>;
    latest_run: StatementReconcileRun | null;
  };
  items: StatementDiscrepancy[];
  count: number;
  statement_logs?: Record<string, unknown>[];
  ledger?: StatementLedgerRow[];
  ledger_by_user?: StatementLedgerUserGroup[];
}

export interface StatementLedgerResponse {
  run: StatementReconcileRun | null;
  from_date: string | null;
  to_date: string | null;
  counts: {
    total: number;
    matched: number;
    local_only?: number;
    issues: number;
    users?: number;
  };
  items: StatementLedgerRow[];
  by_user?: StatementLedgerUserGroup[];
}

export interface WalletBalanceIssue {
  id: number;
  fingerprint: string;
  user: number;
  user_phone: string | null;
  user_name: string | null;
  user_email: string | null;
  txn_type: string;
  txn_type_display: string;
  txn_id: number;
  party: string;
  direction: string;
  direction_display: string;
  amount: string;
  balance_before: string;
  recorded_balance_after: string;
  expected_balance_after: string;
  current_wallet_balance: string;
  txn_at: string;
  txn_reference: string;
  txn_status: string;
  service_name: string;
  description: string;
  txn_snapshot: Record<string, unknown>;
  suggested_adjustment_type: string;
  suggested_amount: string | null;
  status: string;
  status_display: string;
  reason: string;
  can_share: boolean;
  detected_at: string;
  shared_by: number | null;
  shared_by_name: string | null;
  shared_at: string | null;
  resolved_by: number | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_adjustment: number | null;
  email_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletBeforeAfterListResponse {
  summary: { open_issues: number };
  items: WalletBalanceIssue[];
  count: number;
  message?: string;
  stats?: {
    scanned: number;
    mismatches: number;
    created: number;
    updated: number;
    skipped: number;
    open: number;
  };
  from_date?: string;
  to_date?: string;
}

export interface HimalPayHistoryItem {
  key: string;
  transaction_uuid: string;
  created_at: string | null;
  service: string;
  direction: string;
  status: string;
  kind: string;
  principal_amount: string;
  net_amount: string;
  charge: string;
  cashback: string;
  reference_id: string;
  balance_before: string | null;
  balance_after: string | null;
  bonus_before: string | null;
  bonus_after: string | null;
  entry_count: number;
}

export interface HimalPayHistoryResponse {
  from_date: string | null;
  to_date: string | null;
  source: string;
  warning?: string | null;
  counts: {
    total: number;
    credit: number;
    debit: number;
    credit_amount: string;
    debit_amount: string;
  };
  items: HimalPayHistoryItem[];
}

export interface NetworkDashboard {
  role?: string;
  wallet_balance: string;
  wallet_frozen?: boolean;
  today_sales: string;
  today_txn_count: number;
  today_commission: string;
  today_gross_commission?: string;
  total_commission: string;
  total_gross_commission?: string;
  total_tds?: string;
  total_customers: number;
  total_sub_agents: number;
  total_sales?: string;
  success_count?: number;
  failed_count?: number;
  super_admin_profit_today?: string;
  super_admin_profit_total?: string;
  recent_commissions: DealerCommissionItem[];
  network?: {
    total_dealers: number;
    total_sub_agents: number;
    total_customers: number;
    today_sales: string;
    dealer_commission_today: string;
    tds_today: string;
    super_admin_profit_today: string;
  };
}

export interface HierarchyNode {
  id: number;
  phone: string;
  name: string;
  email?: string;
  role: string;
  account_status: string;
  is_active: boolean;
  wallet_balance: string;
  wallet_id?: number | null;
  wallet_frozen?: boolean;
  wallet_status?: string;
  customer_count: number;
  sub_agent_count?: number;
  transaction_count: number;
  sales: string;
  gross_commission?: string;
  tds_amount?: string;
  net_commission?: string;
  super_admin_profit?: string;
  commission?: string;
  commission_rate?: string | null;
  tds_rate?: string | null;
  parent_agent_id?: number | null;
  sub_agents?: HierarchyNode[];
}

export interface DealerProfitRow {
  id: number;
  phone: string;
  name: string;
  sales: string;
  success_count: number;
  failed_count: number;
  gross_commission: string;
  tds_amount: string;
  net_commission: string;
  sub_agent_commission: string;
  super_admin_profit: string;
  wallet_balance: string;
  wallet_frozen?: boolean;
}

export interface NetworkReport {
  user: AdminUser;
  range: { start_date: string | null; end_date: string | null };
  wallet_balance: string;
  total_customers: number;
  total_sub_agents: number;
  sales: string;
  success_count: number;
  failed_count: number;
  gross_commission: string;
  tds_amount: string;
  net_commission: string;
  sub_agent_commission: string;
  super_admin_profit: string;
  by_service: Array<{
    txn_type: string;
    count?: number;
    sales?: string;
    gross_commission?: string;
    tds_amount?: string;
    net_commission?: string;
    sub_agent_commission?: string;
    super_admin_profit?: string;
  }>;
  sub_agent_performance: Array<{
    id: number;
    phone: string;
    name: string;
    customer_count: number;
    sales: string;
    success_count: number;
    commission: string;
  }>;
}

export interface ServiceCommissionRule {
  id: number;
  dealer: number;
  txn_type: string;
  dealer_rate: string;
  sub_agent_rate: string;
  super_admin_rate: string;
  updated_at: string;
}

export interface SupportChatUser {
  id: number;
  phone: string;
  name: string;
  role: UserRole | string;
  role_label: string;
  is_staff: boolean;
  is_superuser: boolean;
  avatar_url: string | null;
  identity_hidden?: boolean;
}

export interface SupportChatThread {
  id: number;
  other_user: SupportChatUser;
  last_message_at: string | null;
  last_message_preview: string;
  unread_count: number;
  created_at: string;
}

export type SupportChatMessageKind = "text" | "image" | "video" | "file";

export interface SupportChatMessage {
  id: number;
  thread: number;
  sender_id: number;
  sender_is_support?: boolean;
  sender_display_name?: string;
  body: string;
  kind?: SupportChatMessageKind;
  has_attachment?: boolean;
  attachment_name?: string;
  attachment_size?: number;
  attachment_content_type?: string;
  attachment_url?: string | null;
  is_read?: boolean;
  created_at: string;
}
