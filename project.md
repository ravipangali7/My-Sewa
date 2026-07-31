# MySewa — Project Overview

**MySewa** is a Nepal digital wallet app. Users load money into a wallet (remittance / bank deposit), then spend that balance on outbound bank transfers and mobile top-ups (NTC / NCELL) via HimalPay.

---

## What It Does

Three core money flows:

### 1. Receive remittance / load wallet (Deposit)

Users fund their MySewa wallet by transferring money to the company bank account (or scanning the deposit QR), then submitting a deposit request with screenshot proof.

- App shows bank details + QR from **Settings**
- User creates a **Deposit** (`pending`)
- Admin reviews proof and **approves** or **rejects**
- On approval, **Wallet.balance** is credited

This is the inbound “load” path — remittance-style funding into the wallet.

### 2. Bank payment / fund transfer (BankTransferTransaction)

Users send money from their MySewa wallet to any supported Nepali bank account via HimalPay.

- Pick bank → verify account → see charge/cashback → confirm
- Wallet is debited (`total_debited`)
- Result stored as **BankTransferTransaction** (`pending` → `success` / `failed`)

### 3. Mobile top-up — NTC & NCELL (TopupTransaction)

Users recharge NTC or NCELL numbers from wallet balance via HimalPay.

- Choose operator (NTC = `product_id` 1, NCELL = 2)
- Enter mobile + amount → calculate charge → confirm
- Wallet debited; result stored as **TopupTransaction**

---

## Product Shape

| Layer | Role |
|---|---|
| **User portal (mobile)** | Wallet UX — balance, load, top-up, bank transfer, history, profile |
| **Admin portal** | Management — users, deposits approval, wallets, settings, transaction oversight |
| **Backend (Django)** | REST API + HimalPay integration + wallet ledger |
| **HimalPay** | External reseller API for NTC/NCELL top-up and bank transfer |

---

## Main Functioning Files (Backend)

These are the primary files that implement the three flows:

| Flow | Key files |
|---|---|
| Auth & profile | `server/core/views/auth_views.py`, `server/core/models.py` (`CustomUser`) |
| Wallet balance & history | `server/core/views/wallet_views.py`, `Wallet` model |
| Remittance / load | `server/core/views/deposit_views.py`, `Deposit` + `Settings`, `signals.py` |
| NTC / NCELL top-up | `server/core/views/topup_views.py`, `TopupTransaction`, `services/himalpay.py` |
| Bank transfer | `server/core/views/bank_transfer_views.py`, `BankTransferTransaction`, `services/himalpay.py` |
| Admin management | `server/core/admin.py` |

API routes live in `server/core/urls.py`.

---

## Money Flow (Simplified)

```
                  ┌─────────────────┐
   Bank transfer  │  Company bank   │  User pays in
   / remittance   │  + QR (Settings)│
                  └────────┬────────┘
                           │ screenshot proof
                           ▼
                    ┌─────────────┐     admin approve
                    │   Deposit   │ ──────────────────► Wallet.balance ↑
                    └─────────────┘

   Wallet.balance
        │
        ├──► TopupTransaction (NTC / NCELL)     → HimalPay payment
        └──► BankTransferTransaction            → HimalPay bank transfer
```

---

## API Surface (User-facing)

**Auth:** register, login, logout, profile, change-password, change-phone  

**Wallet:** balance, transactions  

**Deposit (load):** create, list, detail · **Settings:** QR + bank details  

**Top-up:** NTC, NCELL, history, calculate-charge, status  

**Bank transfer:** list banks, verify account, calculate, create, history, status  

---

## Tech Stack

- **Backend:** Django + Django REST Framework + Token/session auth
- **DB:** SQLite (dev) / production DB as configured
- **Payments partner:** HimalPay Reseller API (`himalpay-api.md`)
- **Clients:** Mobile user app (iOS-native style) + Admin web portal

---

## Success Criteria

1. User can load wallet via bank remittance + proof upload; admin can approve/reject.
2. User can top up NTC and NCELL from wallet with correct debit + status tracking.
3. User can transfer to a verified bank account from wallet with charge/cashback clarity.
4. Wallet balance never goes negative; every spend is tied to a transaction record.
