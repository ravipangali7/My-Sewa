# MySewa — Data Models

Source of truth: `server/core/models.py`

All money amounts are stored in **Nepalese Rupees (NPR)** as `Decimal` with 2 decimal places (not paisa). HimalPay API uses paisa; conversion happens in services.

---

## 1. CustomUser

Phone-based auth user. Extends Django `AbstractUser`. `USERNAME_FIELD = phone`.

| Field | Type | Specs |
|---|---|---|
| `id` | `BigAutoField` (PK) | Auto-increment |
| `phone` | `CharField(50)` | **Unique**, required. Login identifier |
| `username` | `CharField(150)` | Nullable, blank. Auto-set to `phone` on save |
| `email` | `EmailField` | Nullable, blank |
| `first_name` | `CharField(30)` | Blank allowed |
| `last_name` | `CharField(30)` | Blank allowed |
| `avatar` | `ImageField` | Upload to `avatars/`, nullable |
| `password` | `CharField` | Hashed (from AbstractUser) |
| `is_active` | `BooleanField` | Default `True` |
| `is_staff` | `BooleanField` | Admin portal access |
| `is_superuser` | `BooleanField` | Full permissions |
| `date_joined` | `DateTimeField` | Auto on create |
| `last_login` | `DateTimeField` | Nullable |

**Relations:** One `Wallet` · Many `Deposit` · Many `TopupTransaction` · Many `BankTransferTransaction`

---

## 2. Wallet

One wallet per user. Created automatically on user registration (signal).

| Field | Type | Specs |
|---|---|---|
| `id` | `BigAutoField` (PK) | Auto-increment |
| `user` | `OneToOneField(CustomUser)` | `CASCADE`, `related_name='wallet'` |
| `balance` | `DecimalField(10, 2)` | Default `0.00`, `MinValueValidator(0)` |
| `created_at` | `DateTimeField` | `auto_now_add` |
| `updated_at` | `DateTimeField` | `auto_now` |

---

## 3. Settings

Singleton app settings (always `pk=1`). Holds deposit QR and bank details shown to users.

| Field | Type | Specs |
|---|---|---|
| `id` | `BigAutoField` (PK) | Forced to `1` |
| `qr_code` | `ImageField` | Upload to `settings/`, nullable. Bank deposit QR image |
| `khalti_qr_code` | `ImageField` | Upload to `settings/`, nullable. Khalti deposit QR image |
| `esewa_qr_code` | `ImageField` | Upload to `settings/`, nullable. eSewa deposit QR image |
| `bank_details` | `JSONField` | Default `{}`. Bank account info for remittance/load |
| `created_at` | `DateTimeField` | `auto_now_add` |
| `updated_at` | `DateTimeField` | `auto_now` |

**Behavior:** `save()` always sets `pk=1`. `delete()` is a no-op. Use `Settings.load()` to get/create the singleton.

**Example `bank_details` shape:**

```json
{
  "bank_name": "Laxmi Sunrise Bank",
  "account_name": "MySewa Pvt. Ltd.",
  "account_number": "0123456789",
  "branch": "Kathmandu"
}
```

---

## 4. Deposit

User remittance / load request. User pays into company bank account, uploads proof; admin approves → wallet credited.

| Field | Type | Specs |
|---|---|---|
| `id` | `BigAutoField` (PK) | Auto-increment |
| `user` | `ForeignKey(CustomUser)` | `CASCADE`, `related_name='deposits'` |
| `amount` | `DecimalField(10, 2)` | `MinValueValidator(0.01)` |
| `status` | `CharField(20)` | Choices: `pending` · `approved` · `rejected`. Default `pending` |
| `screenshot_proof` | `ImageField` | Upload to `deposits/`, required. Payment proof |
| `note` | `TextField` | Nullable, blank. Optional user note |
| `created_at` | `DateTimeField` | `auto_now_add` |
| `updated_at` | `DateTimeField` | `auto_now` |

**Ordering:** `-created_at`

**Status flow:** `pending` → `approved` (credits wallet) | `rejected` (no credit)

---

## 5. TopupTransaction

Mobile top-up via HimalPay (NTC / NCELL). Debits user wallet.

| Field | Type | Specs |
|---|---|---|
| `id` | `BigAutoField` (PK) | Auto-increment |
| `user` | `ForeignKey(CustomUser)` | `CASCADE`, `related_name='topup_transactions'` |
| `mobile_number` | `CharField(50)` | Number to recharge |
| `amount` | `DecimalField(10, 2)` | `MinValueValidator(0.01)` |
| `product_id` | `IntegerField` | Choices: `1` = NTC, `2` = NCELL |
| `status` | `CharField(20)` | Choices: `pending` · `success` · `failed`. Default `pending` |
| `service_hub_txn_id` | `CharField(100)` | Nullable. Provider txn ID (HimalPay / legacy) |
| `merchant_txn_id` | `CharField(100)` | **Unique**. Our merchant transaction ID |
| `charge` | `DecimalField(10, 2)` | Default `0.00`. Fee charged |
| `cashback` | `DecimalField(10, 2)` | Default `0.00` |
| `total_debited` | `DecimalField(10, 2)` | Default `0.00`. `amount + charge - cashback` |
| `reference_id` | `CharField(100)` | Nullable |
| `provider_response` | `JSONField` | Default `{}`. Raw HimalPay response |
| `created_at` | `DateTimeField` | `auto_now_add` |
| `updated_at` | `DateTimeField` | `auto_now` |

**Ordering:** `-created_at`

---

## 6. BankTransferTransaction

Outbound bank transfer via HimalPay. Debits user wallet, pays into destination bank account.

| Field | Type | Specs |
|---|---|---|
| `id` | `BigAutoField` (PK) | Auto-increment |
| `user` | `ForeignKey(CustomUser)` | `CASCADE`, `related_name='bank_transfers'` |
| `amount` | `DecimalField(10, 2)` | `MinValueValidator(0.01)` |
| `destination_bank` | `CharField(50)` | Bank code (e.g. `LXBLNPKA`) |
| `destination_bank_name` | `CharField(150)` | Blank, default `''` |
| `destination_acc_no` | `CharField(50)` | Destination account number |
| `destination_acc_name` | `CharField(150)` | Account holder name |
| `is_destination_mobile` | `BooleanField` | Default `False` |
| `transaction_remarks` | `CharField(255)` | Default `'Fund Transfer'` |
| `transaction_remarks_2` | `CharField(255)` | Blank, default `''` |
| `transaction_remarks_3` | `CharField(255)` | Blank, default `''` |
| `status` | `CharField(20)` | Choices: `pending` · `success` · `failed`. Default `pending` |
| `merchant_txn_id` | `CharField(100)` | **Unique** |
| `provider_txn_id` | `CharField(100)` | Nullable. HimalPay txn ID |
| `reference_id` | `CharField(100)` | Nullable |
| `charge` | `DecimalField(10, 2)` | Default `0.00` |
| `cashback` | `DecimalField(10, 2)` | Default `0.00` |
| `total_debited` | `DecimalField(10, 2)` | Default `0.00` |
| `verified` | `BooleanField` | Default `False`. Account verified before transfer |
| `provider_response` | `JSONField` | Default `{}` |
| `created_at` | `DateTimeField` | `auto_now_add` |
| `updated_at` | `DateTimeField` | `auto_now` |

**Ordering:** `-created_at`

---

## Entity Relationships

```
CustomUser 1 ──────── 1 Wallet
     │
     ├── 1 ────── * Deposit
     ├── 1 ────── * TopupTransaction
     └── 1 ────── * BankTransferTransaction

Settings (singleton, no user FK)
```

## Status Reference

| Model | Statuses |
|---|---|
| Deposit | `pending` · `approved` · `rejected` |
| TopupTransaction | `pending` · `success` · `failed` |
| BankTransferTransaction | `pending` · `success` · `failed` |

## Product IDs (Topup)

| `product_id` | Operator |
|---|---|
| `1` | NTC |
| `2` | NCELL |
