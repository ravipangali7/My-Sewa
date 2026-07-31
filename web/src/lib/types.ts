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

export interface AppSettings {
  id: number;
  qr_code: string | null;
  qr_code_url: string | null;
  bank_details: BankDetails;
  created_at: string;
  updated_at: string;
}

export interface Deposit {
  id: number;
  user: string;
  phone: string;
  amount: string;
  status: DepositStatus;
  status_display: string;
  screenshot_proof: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopupTransaction {
  id: number;
  user: string;
  phone: string;
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
