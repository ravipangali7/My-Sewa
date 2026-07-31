/** Dummy data shaped exactly after models.md */

export type Role = "super_admin" | "user";

export interface CustomUser {
  id: number;
  phone: string;
  username: string | null;
  email: string | null;
  first_name: string;
  last_name: string;
  avatar: string | null;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  date_joined: string;
  last_login: string | null;
}

export interface Wallet {
  id: number;
  user: number;
  balance: string;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  id: 1;
  qr_code: string | null;
  bank_details: {
    bank_name: string;
    account_name: string;
    account_number: string;
    branch: string;
  };
  created_at: string;
  updated_at: string;
}

export type DepositStatus = "pending" | "approved" | "rejected";
export type TxnStatus = "pending" | "success" | "failed";

export interface Deposit {
  id: number;
  user: number;
  amount: string;
  status: DepositStatus;
  screenshot_proof: string;
  note: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopupTransaction {
  id: number;
  user: number;
  mobile_number: string;
  amount: string;
  product_id: 1 | 2;
  status: TxnStatus;
  service_hub_txn_id: string | null;
  merchant_txn_id: string;
  charge: string;
  cashback: string;
  total_debited: string;
  reference_id: string | null;
  provider_response: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BankTransferTransaction {
  id: number;
  user: number;
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
  merchant_txn_id: string;
  provider_txn_id: string | null;
  reference_id: string | null;
  charge: string;
  cashback: string;
  total_debited: string;
  verified: boolean;
  provider_response: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const OPERATORS: Record<1 | 2, string> = { 1: "NTC", 2: "NCELL" };

export const BANKS = [
  { code: "LXBLNPKA", name: "Laxmi Sunrise Bank" },
  { code: "NBBLNPKA", name: "Nabil Bank" },
  { code: "GLBBNPKA", name: "Global IME Bank" },
  { code: "SBINPKA", name: "Nepal SBI Bank" },
  { code: "PRVUNPKA", name: "Prabhu Bank" },
  { code: "SANINPKA", name: "Sanima Bank" },
];

export const users: CustomUser[] = [
  {
    id: 1,
    phone: "+977 9812345678",
    username: "+977 9812345678",
    email: "rita.gurung@mysewa.com.np",
    first_name: "Rita",
    last_name: "Gurung",
    avatar: null,
    is_active: true,
    is_staff: false,
    is_superuser: false,
    date_joined: "2024-08-14T09:12:00",
    last_login: "2024-12-20T10:02:00",
  },
  {
    id: 2,
    phone: "+977 9801122334",
    username: "+977 9801122334",
    email: "bikash.thapa@gmail.com",
    first_name: "Bikash",
    last_name: "Thapa",
    avatar: null,
    is_active: true,
    is_staff: false,
    is_superuser: false,
    date_joined: "2024-09-02T14:40:00",
    last_login: "2024-12-19T18:22:00",
  },
  {
    id: 3,
    phone: "+977 9845567788",
    username: "+977 9845567788",
    email: "sunita.rai@gmail.com",
    first_name: "Sunita",
    last_name: "Rai",
    avatar: null,
    is_active: false,
    is_staff: false,
    is_superuser: false,
    date_joined: "2024-10-11T11:05:00",
    last_login: "2024-11-28T08:15:00",
  },
  {
    id: 4,
    phone: "+977 9862233445",
    username: "+977 9862233445",
    email: "admin@mysewa.com.np",
    first_name: "Prakash",
    last_name: "Shrestha",
    avatar: null,
    is_active: true,
    is_staff: true,
    is_superuser: true,
    date_joined: "2024-06-01T07:00:00",
    last_login: "2024-12-20T09:44:00",
  },
  {
    id: 5,
    phone: "+977 9819988776",
    username: "+977 9819988776",
    email: null,
    first_name: "Anjali",
    last_name: "Maharjan",
    avatar: null,
    is_active: true,
    is_staff: false,
    is_superuser: false,
    date_joined: "2024-11-21T16:30:00",
    last_login: "2024-12-18T21:10:00",
  },
];

export const wallets: Wallet[] = [
  {
    id: 1,
    user: 1,
    balance: "85450.00",
    created_at: "2024-08-14T09:12:00",
    updated_at: "2024-12-20T10:24:00",
  },
  {
    id: 2,
    user: 2,
    balance: "12380.50",
    created_at: "2024-09-02T14:40:00",
    updated_at: "2024-12-19T18:30:00",
  },
  {
    id: 3,
    user: 3,
    balance: "0.00",
    created_at: "2024-10-11T11:05:00",
    updated_at: "2024-11-28T08:15:00",
  },
  {
    id: 4,
    user: 4,
    balance: "500.00",
    created_at: "2024-06-01T07:00:00",
    updated_at: "2024-12-01T07:00:00",
  },
  {
    id: 5,
    user: 5,
    balance: "43200.75",
    created_at: "2024-11-21T16:30:00",
    updated_at: "2024-12-18T21:10:00",
  },
];

export const appSettings: AppSettings = {
  id: 1,
  qr_code: "/qr-placeholder.svg",
  bank_details: {
    bank_name: "Laxmi Sunrise Bank",
    account_name: "MySewa Pvt. Ltd.",
    account_number: "0123456789",
    branch: "Kathmandu",
  },
  created_at: "2024-06-01T07:00:00",
  updated_at: "2024-12-10T12:00:00",
};

export const deposits: Deposit[] = [
  {
    id: 41,
    user: 1,
    amount: "25000.00",
    status: "approved",
    screenshot_proof: "deposits/proof-41.jpg",
    note: "Remittance from Qatar",
    rejection_reason: null,
    created_at: "2024-12-20T10:24:00",
    updated_at: "2024-12-20T11:02:00",
  },
  {
    id: 40,
    user: 2,
    amount: "8000.00",
    status: "pending",
    screenshot_proof: "deposits/proof-40.jpg",
    note: "Mobile banking transfer",
    rejection_reason: null,
    created_at: "2024-12-20T08:11:00",
    updated_at: "2024-12-20T08:11:00",
  },
  {
    id: 39,
    user: 5,
    amount: "43000.00",
    status: "pending",
    screenshot_proof: "deposits/proof-39.jpg",
    note: null,
    rejection_reason: null,
    created_at: "2024-12-19T19:47:00",
    updated_at: "2024-12-19T19:47:00",
  },
  {
    id: 38,
    user: 1,
    amount: "18500.00",
    status: "approved",
    screenshot_proof: "deposits/proof-38.jpg",
    note: "Remittance received",
    rejection_reason: null,
    created_at: "2024-12-12T09:15:00",
    updated_at: "2024-12-12T09:50:00",
  },
  {
    id: 37,
    user: 3,
    amount: "2000.00",
    status: "rejected",
    screenshot_proof: "deposits/proof-37.jpg",
    note: "Blurry screenshot",
    rejection_reason: "Screenshot unclear",
    created_at: "2024-12-08T13:02:00",
    updated_at: "2024-12-08T15:20:00",
  },
];

export const topups: TopupTransaction[] = [
  {
    id: 120,
    user: 1,
    mobile_number: "9841002233",
    amount: "500.00",
    product_id: 1,
    status: "success",
    service_hub_txn_id: "HP-TX-88213",
    merchant_txn_id: "MS-TOP-000120",
    charge: "5.00",
    cashback: "10.00",
    total_debited: "495.00",
    reference_id: "REF-120",
    provider_response: { code: "000", message: "Success" },
    created_at: "2024-12-19T15:20:00",
    updated_at: "2024-12-19T15:20:12",
  },
  {
    id: 119,
    user: 2,
    mobile_number: "9801556677",
    amount: "200.00",
    product_id: 2,
    status: "failed",
    service_hub_txn_id: null,
    merchant_txn_id: "MS-TOP-000119",
    charge: "2.00",
    cashback: "0.00",
    total_debited: "0.00",
    reference_id: null,
    provider_response: { code: "504", message: "Operator timeout" },
    created_at: "2024-12-18T11:04:00",
    updated_at: "2024-12-18T11:04:30",
  },
  {
    id: 118,
    user: 5,
    mobile_number: "9861224466",
    amount: "1000.00",
    product_id: 1,
    status: "success",
    service_hub_txn_id: "HP-TX-88190",
    merchant_txn_id: "MS-TOP-000118",
    charge: "10.00",
    cashback: "25.00",
    total_debited: "985.00",
    reference_id: "REF-118",
    provider_response: { code: "000", message: "Success" },
    created_at: "2024-12-17T09:41:00",
    updated_at: "2024-12-17T09:41:08",
  },
  {
    id: 117,
    user: 1,
    mobile_number: "9808877665",
    amount: "300.00",
    product_id: 2,
    status: "pending",
    service_hub_txn_id: "HP-TX-88155",
    merchant_txn_id: "MS-TOP-000117",
    charge: "3.00",
    cashback: "0.00",
    total_debited: "303.00",
    reference_id: null,
    provider_response: {},
    created_at: "2024-12-16T20:12:00",
    updated_at: "2024-12-16T20:12:00",
  },
];

export const bankTransfers: BankTransferTransaction[] = [
  {
    id: 76,
    user: 1,
    amount: "5000.00",
    destination_bank: "LXBLNPKA",
    destination_bank_name: "Laxmi Sunrise Bank",
    destination_acc_no: "0123456789",
    destination_acc_name: "Hari Bahadur Karki",
    is_destination_mobile: false,
    transaction_remarks: "Fund Transfer",
    transaction_remarks_2: "Family support",
    transaction_remarks_3: "",
    status: "success",
    merchant_txn_id: "MS-BT-000076",
    provider_txn_id: "HP-BT-45211",
    reference_id: "REF-76",
    charge: "15.00",
    cashback: "0.00",
    total_debited: "5015.00",
    verified: true,
    provider_response: { code: "000", message: "Transfer complete" },
    created_at: "2024-12-18T16:32:00",
    updated_at: "2024-12-18T16:33:10",
  },
  {
    id: 75,
    user: 5,
    amount: "12000.00",
    destination_bank: "NBBLNPKA",
    destination_bank_name: "Nabil Bank",
    destination_acc_no: "9988776655",
    destination_acc_name: "Sarita Lama",
    is_destination_mobile: false,
    transaction_remarks: "Fund Transfer",
    transaction_remarks_2: "",
    transaction_remarks_3: "",
    status: "pending",
    merchant_txn_id: "MS-BT-000075",
    provider_txn_id: null,
    reference_id: null,
    charge: "20.00",
    cashback: "0.00",
    total_debited: "12020.00",
    verified: true,
    provider_response: {},
    created_at: "2024-12-18T10:05:00",
    updated_at: "2024-12-18T10:05:00",
  },
  {
    id: 74,
    user: 2,
    amount: "3500.00",
    destination_bank: "GLBBNPKA",
    destination_bank_name: "Global IME Bank",
    destination_acc_no: "4455667788",
    destination_acc_name: "Deepak Adhikari",
    is_destination_mobile: false,
    transaction_remarks: "Fund Transfer",
    transaction_remarks_2: "Rent",
    transaction_remarks_3: "",
    status: "failed",
    merchant_txn_id: "MS-BT-000074",
    provider_txn_id: "HP-BT-45180",
    reference_id: null,
    charge: "15.00",
    cashback: "0.00",
    total_debited: "0.00",
    verified: false,
    provider_response: { code: "421", message: "Account name mismatch" },
    created_at: "2024-12-15T12:48:00",
    updated_at: "2024-12-15T12:49:02",
  },
];

/** Current signed-in demo user (Rita) */
export const currentUser = users[0]!;
export const currentWallet = wallets[0]!;

export type ActivityKind = "deposit" | "topup" | "transfer";

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

export function activityFor(userId: number): ActivityItem[] {
  const items: ActivityItem[] = [
    ...deposits
      .filter((d) => d.user === userId)
      .map<ActivityItem>((d) => ({
        id: `dep-${d.id}`,
        kind: "deposit",
        title: "Remittance Received",
        subtitle: d.note ?? "Wallet load",
        amount: d.amount,
        credit: true,
        status: d.status,
        created_at: d.created_at,
      })),
    ...topups
      .filter((t) => t.user === userId)
      .map<ActivityItem>((t) => ({
        id: `top-${t.id}`,
        kind: "topup",
        title: `${OPERATORS[t.product_id]} Top-Up`,
        subtitle: t.mobile_number,
        amount: t.total_debited !== "0.00" ? t.total_debited : t.amount,
        credit: false,
        status: t.status,
        created_at: t.created_at,
      })),
    ...bankTransfers
      .filter((b) => b.user === userId)
      .map<ActivityItem>((b) => ({
        id: `bt-${b.id}`,
        kind: "transfer",
        title: "Fund Transfer",
        subtitle: `${b.destination_acc_name} · ${b.destination_bank_name}`,
        amount: b.total_debited !== "0.00" ? b.total_debited : b.amount,
        credit: false,
        status: b.status,
        created_at: b.created_at,
      })),
  ];
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export const walletFloat = wallets.reduce((sum, w) => sum + Number(w.balance), 0);

export const volumeSeries = [
  { day: "Mon", deposits: 41000, topups: 3200, transfers: 12000 },
  { day: "Tue", deposits: 25500, topups: 2100, transfers: 8600 },
  { day: "Wed", deposits: 62000, topups: 4800, transfers: 21000 },
  { day: "Thu", deposits: 18500, topups: 1500, transfers: 5200 },
  { day: "Fri", deposits: 74000, topups: 5600, transfers: 33000 },
  { day: "Sat", deposits: 33000, topups: 2900, transfers: 14500 },
  { day: "Sun", deposits: 51000, topups: 3900, transfers: 17800 },
];

export const operatorSplit = [
  { name: "NTC", value: 1800 },
  { name: "NCELL", value: 500 },
];

export function userById(id: number) {
  return users.find((u) => u.id === id);
}
