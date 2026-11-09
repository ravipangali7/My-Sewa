# MySewa Developer API — Integration Specification

> **Version:** v1 · **Docs Version:** 1.6 · **Published:** 2026-11-04  
> **Base URL:** `https://mysewaserver.sewabyapar.com`  
> **Authentication:** `Authorization: Bearer YOUR_API_KEY`  
> **Format:** Official Offline Markdown Specification (`.md`)

---

## The 3 Core APIs

MySewa provides **3 Primary APIs** for seamless fintech, merchant, and platform integration:

| # | API Name | Method & Endpoint | Core Purpose |
|---|---|---|---|
| 1 | **Bank Verify API** | `POST /api/v1/verifiedbank/` | Verifies destination bank account number and account holder name against the banking network in real-time before payout. |
| 2 | **Deposit API** | `POST /api/v1/payin/` | Creates customer deposit / wallet load. Generates dynamic Fonepay QR code URL and image for instant mobile banking scan & pay. |
| 3 | **Withdraw API** | `POST /api/v1/banktransfer/` | Withdraws / transfers funds from merchant wallet to a pre-verified destination bank account (instant bank payout). |

### Supporting APIs
In addition to the 3 core APIs, MySewa provides supporting endpoints:
- **Bank List API** (`GET /api/v1/banklist/`): Look up supported banks and bank codes.
- **Deposit Status API** (`GET /api/v1/payin/status/`): Check real-time status of deposit / payin requests.
- **Fund Transfer API** (`POST /api/v1/fund-transfer/`): Direct wallet-to-wallet transfer between MySewa users.

---

## Table of Contents

1. [Introduction](#introduction)
2. [API Base URL & Authentication](#api-base-url)
3. [The 3 Core APIs & Endpoints](#the-3-core-apis--endpoints)
   - [Bank Verify API](#bank-verify-api) (`POST /api/v1/verifiedbank/`)
   - [Deposit API (Payin / Wallet Load)](#deposit-api-payin--wallet-load) (`POST /api/v1/payin/`)
   - [MySewa Internal QR Deposit Integration Guide](#mysewa-internal-qr-deposit-integration-guide-fonepay-direct-qr) (Fonepay Direct-QR)
   - [Withdraw API (Bank Transfer / Payout)](#withdraw-api-bank-transfer--payout) (`POST /api/v1/banktransfer/`)
   - [Bank List API](#bank-list-api) (`GET /api/v1/banklist/`)
   - [Deposit Status API](#deposit-status-api) (`GET /api/v1/payin/status/`)
   - [Fund Transfer API](#fund-transfer-api) (`POST /api/v1/fund-transfer/`)
4. [Integration Flows](#integration-flows)
   - [Bank API integration flow](#bank-api-integration-flow)
   - [Payin integration flow](#payin-integration-flow)
   - [How API Fund Transfer Works](#how-api-fund-transfer-works)
5. [Duplicate / Idempotency Behavior](#duplicate--idempotency-behavior)
6. [API Transaction History](#api-transaction-history)
7. [Security Guidelines](#security-guidelines)
8. [Documentation Download Option](#documentation-download)

---

## Introduction

MySewa Developer API lets an approved API user move NPR from their MySewa wallet (Fund Transfer / Bank Transfer) and load wallets via PayBridgeNP Payin.

You do **not** create API transactions from the Developer dashboard. Your application calls the API; MySewa creates the transaction automatically.

## API Base URL

`https://mysewaserver.sewabyapar.com`

## Authentication

Send the API key as a Bearer token:

```
Authorization: Bearer <API_KEY>
```

- Use the API key issued when API access is enabled for your account.
- Do not send your dashboard login token on this endpoint.
- API access is denied when is_api_user is false, the account is inactive, or the key was regenerated.

## API Key

1. An admin enables Fund Transfer API access on your account (`is_api_user`).
2. For Payin, also enable **Payin API** (`can_api_payin`) on the same API user.
3. Open **Developer / API** in the MySewa app to view, copy, or regenerate the key.
4. Regenerating a key invalidates the previous key immediately.

---

## Integration Flows

### Bank API integration flow

Recommended order. The three bank endpoints are independent, but payouts require a recent successful verification of the same bank details.

```
1. GET /api/v1/banklist/
2. POST /api/v1/verifiedbank/
3. POST /api/v1/banktransfer/
```

1. GET /api/v1/banklist/ to load HimalPay bank codes and names (cached when unchanged).
2. POST /api/v1/verifiedbank/ with bank_code, bank_account_number, and account_holder_name. MySewa calls HimalPay BANK_TRANSFER_VERIFICATION.
3. After a successful verify, POST /api/v1/banktransfer/ with the same bank details, amount, and a unique reference. MySewa re-verifies with HimalPay, then calls BANK_TRANSFER and records the wallet transaction.

### Payin integration flow

1. Enable API access (is_api_user) and Payin permission (can_api_payin) for the API user in Admin → API Users.
2. POST /api/v1/payin/ with receiver (MySewa phone), amount, and a unique reference.
3. MySewa creates a pending Deposit and a PayBridgeNP Fonepay QR (never HimalPay). Default mode=direct_qr returns checkout_url / payment_url on the MySewa domain (/api/deposit/paybridge/qr/?order=…) plus qr_image. Open that MySewa URL; do not open PayBridge checkout. Optional mode=hosted returns PayBridge's method-picker URL.
4. Optional customer_name / customer_email / customer_phone override the PayBridge checkout display only; wallet credit still goes to receiver.
5. Open checkout_url / payment_url. For direct_qr that URL is MySewa's QR page and qr_image is the Fonepay code. For mode=hosted, the URL is PayBridge's checkout page.
6. PayBridgeNP sends a signed webhook to MySewa. MySewa verifies the signature and payment, credits the receiver wallet once, then POSTs the result to the API user's saved Webhook URL (Admin → API Users).
7. Poll GET /api/v1/payin/status/?reference=… until status is SUCCESS, FAILED, CANCELLED, EXPIRED, or REFUNDED.

### How API Fund Transfer Works

1. An administrator enables Fund Transfer API access for your MySewa account. An API key is generated automatically.
2. You copy the API key from Developer / API and store it securely in your own website or application.
3. Your application sends POST /api/v1/fund-transfer/ with receiver, amount, and a unique reference.
4. MySewa authenticates the Bearer API key. Dashboard login tokens are rejected.
5. MySewa validates the sender, receiver, amount, limits, and wallet state.
6. If the sender wallet has sufficient balance (including charges), the sender is debited.
7. The receiver wallet is credited in the same atomic wallet transfer.
8. A wallet transaction is created automatically. You do not create API transactions from the dashboard.
9. The API returns transaction_id, reference, amount, and status.
10. Successful and failed API calls appear in API Transaction History for the authenticated API user.

---

## The 3 Core APIs & Endpoints

## Bank Verify API

`POST /api/v1/verifiedbank/`

Full URL: `https://mysewaserver.sewabyapar.com/api/v1/verifiedbank/`

Verifies a destination bank account against HimalPay BANK_TRANSFER_VERIFICATION. This call does not debit the wallet. A successful verify is required before /banktransfer/ for the same API user, bank, account number, and holder name (valid about 15 minutes). HimalPay does not issue a verification token; MySewa remembers the successful match internally.

### Headers

- `Authorization` (required) — `Bearer YOUR_API_KEY`
- `Content-Type` (required) — `application/json`

### Request parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `bank_code` | yes | string | HimalPay bank code from GET /api/v1/banklist/. bank_name may be sent instead when uniquely resolvable. |
| `bank_account_number` | yes | string | Destination account number. Aliases: account_number, destination_acc_no. |
| `account_holder_name` | yes | string | Registered account holder name. Aliases: account_name, destination_acc_name. |
| `bank_name` | no | string | Optional bank display name used to resolve a short or missing bank_code. |

### Request example

```json
{
  "bank_code": "NABILNPKA",
  "bank_account_number": "1234567890123",
  "account_holder_name": "John Doe"
}
```

### Successful response

200 OK when HimalPay confirms the account and the holder name matches.

```json
{
  "success": true,
  "verified": true,
  "message": "Bank account verified successfully",
  "data": {
    "bank_code": "NABILNPKA",
    "bank_name": "Nabil Bank Limited",
    "account_number": "*********0123",
    "account_holder_name": "John Doe"
  }
}
```

### Failed verification

```json
{
  "success": false,
  "verified": false,
  "message": "Bank account verification failed",
  "error": "Bank account verification failed",
  "code": "verification_failed"
}
```

### Examples

#### cURL

```bash
curl -X POST "https://mysewaserver.sewabyapar.com/api/v1/verifiedbank/" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "bank_code": "NABILNPKA",
  "bank_account_number": "1234567890123",
  "account_holder_name": "John Doe"
}'
```

#### Python

```python
import requests

url = "https://mysewaserver.sewabyapar.com/api/v1/verifiedbank/"
headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
}
payload = {
  "bank_code": "NABILNPKA",
  "bank_account_number": "1234567890123",
  "account_holder_name": "John Doe"
}
response = requests.post(url, json=payload, headers=headers, timeout=60)
print(response.status_code, response.json())

```

#### JavaScript

```javascript
const url = "https://mysewaserver.sewabyapar.com/api/v1/verifiedbank/";
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
  "bank_code": "NABILNPKA",
  "bank_account_number": "1234567890123",
  "account_holder_name": "John Doe"
}),
});
const data = await response.json();
console.log(response.status, data);

```

### Errors

- `401` `invalid_api_key` — Invalid API key: The API key is missing, invalid, or has been revoked.
- `403` `api_access_disabled` — API access disabled: API access is disabled for this account.
- `403` `user_inactive` — User inactive: This account is inactive and cannot use the API.
- `429` `throttled` — Too many requests: Too many requests. Please slow down and try again.
- `500` `server_error` — Server/internal error: The request could not be completed. Please try again.
- `502` `provider_unavailable` — HimalPay unavailable: The payment provider is temporarily unavailable. Please try again later.
- `504` `provider_timeout` — HimalPay timeout: The payment provider took too long to respond. Please try again.
- `400` `provider_error` — HimalPay API error: The payment provider rejected this request.
- `400` `invalid_bank_code` — Invalid bank code: bank_code or bank_name is required.
- `400` `bank_not_supported` — Bank not supported: This bank is not on the HimalPay bank list.
- `400` `invalid_account_number` — Invalid account number: bank_account_number is missing or malformed.
- `400` `missing_account_holder_name` — Missing account holder name: account_holder_name is required.
- `400` `verification_failed` — Bank account verification failed: The account number and holder name did not match HimalPay records.

- MySewa maps the request to HimalPay fields bank_code, account_number, account_name, merchant_txn_id, and is_mobile=n.
- Account numbers are masked in the API response.
- Verification failure is returned as verified: false. Results are never faked.

## Deposit API (Payin / Wallet Load)

`POST /api/v1/payin/`

Full URL: `https://mysewaserver.sewabyapar.com/api/v1/payin/`

Starts a PayBridgeNP wallet-load for an existing MySewa user (receiver phone). The wallet is credited only after a verified successful PayBridgeNP payment (signed webhook or server-side verify). Duplicate wallet credit is prevented.

### Headers

- `Authorization` (required) — `Bearer YOUR_API_KEY`
- `Content-Type` (required) — `application/json`
- `Idempotency-Key` — `PAYIN-10001`

### Request parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `receiver` | yes | string | MySewa phone of the wallet to credit. Aliases: phone, mobile. |
| `amount` | yes | number | NPR amount to load. Subject to deposit min/max in Settings. |
| `reference` | yes | string | Unique client reference (1–64 chars: letters, digits, ._-). Used for idempotency. |
| `mode` | no | string | Payment presentation. Default "direct_qr" opens MySewa's QR page with the Fonepay image. Pass "hosted" for PayBridge's method picker. |
| `provider` | no | string | Optional PayBridge provider for hosted mode (fonepay, esewa, khalti). Omit with checkout_flow=hosted to show the method picker. |
| `checkout_flow` | no | string | Hosted-mode flow. Default "hosted" shows the method picker. Pass "redirect" with provider to open that provider immediately. |
| `customer_name` | no | string | Optional PayBridge checkout display name. Does not change which wallet is credited. Alias: customer.name |
| `customer_email` | no | string | Optional PayBridge checkout display email. Alias: customer.email |
| `customer_phone` | no | string | Optional PayBridge checkout display phone. Alias: customer.phone |
| `return_url` | no | string | Optional player browser return URL after successful payment (game page — not the webhook URL). Aliases: success_url, redirect_url. |

### Request example

```json
{
  "receiver": "98XXXXXXXX",
  "amount": 1000,
  "reference": "PAYIN-10001"
}
```

### Successful response

201 Created for a new payin; 200 OK when the same reference is replayed.

```json
{
  "success": true,
  "message": "Payin checkout ready",
  "transaction_id": "MS-PB-a1b2c3d4e5f6",
  "deposit_id": 12345,
  "order_id": "MS-PB-a1b2c3d4e5f6",
  "reference": "PAYIN-10001",
  "receiver": "98XXXXXXXX",
  "amount": 1000,
  "currency": "NPR",
  "status": "PENDING",
  "provider": "paybridgenp",
  "mode": "direct_qr",
  "checkout_url": "https://mysewaserver.sewabyapar.com/api/deposit/paybridge/qr/?order=MS-PB-a1b2c3d4e5f6",
  "payment_url": "https://mysewaserver.sewabyapar.com/api/deposit/paybridge/qr/?order=MS-PB-a1b2c3d4e5f6",
  "session_id": "cs_xxx",
  "payment_id": "",
  "expires_at": "2026-09-17T12:00:00+05:45",
  "failure_reason": "",
  "verification_status": "unverified"
}
```

### Examples

#### cURL

```bash
curl -X POST "https://mysewaserver.sewabyapar.com/api/v1/payin/" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "receiver": "98XXXXXXXX",
  "amount": 1000,
  "reference": "PAYIN-10001"
}'
```

#### Python

```python
import requests

url = "https://mysewaserver.sewabyapar.com/api/v1/payin/"
headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
}
payload = {
  "receiver": "98XXXXXXXX",
  "amount": 1000,
  "reference": "PAYIN-10001"
}
response = requests.post(url, json=payload, headers=headers, timeout=60)
print(response.status_code, response.json())

```

#### JavaScript

```javascript
const url = "https://mysewaserver.sewabyapar.com/api/v1/payin/";
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
  "receiver": "98XXXXXXXX",
  "amount": 1000,
  "reference": "PAYIN-10001"
}),
});
const data = await response.json();
console.log(response.status, data);

```

### Errors

- `401` `invalid_api_key` — Invalid API key: The API key is missing, invalid, or has been revoked.
- `403` `api_access_disabled` — API access disabled: API access is disabled for this account.
- `403` `user_inactive` — User inactive: This account is inactive and cannot use the API.
- `429` `throttled` — Too many requests: Too many requests. Please slow down and try again.
- `500` `server_error` — Server/internal error: The request could not be completed. Please try again.
- `403` `unauthorized_transaction` — Unauthorized transaction: Payin API access is disabled for this account (can_api_payin).
- `400` `invalid_receiver` — Invalid receiver: Receiver phone is required or cannot receive loads.
- `404` `receiver_not_found` — Receiver not found: No MySewa user was found for that receiver.
- `400` `invalid_amount` — Invalid amount: Amount is missing, invalid, or outside deposit limits.
- `409` `duplicate_reference` — Duplicate reference: This reference is already being processed.
- `503` `provider_unavailable` — PayBridgeNP unavailable: PayBridgeNP is not configured or temporarily unavailable.

- Requires is_api_user and can_api_payin. Existing payout API keys are unchanged; enable Payin separately.
- status PENDING means checkout is ready — not yet paid. SUCCESS means wallet was credited.
- Wallet credit happens only after verified PayBridgeNP payment.succeeded (webhook) or server verify.
- Replaying the same reference returns the original checkout payload with refreshed live status fields.
- Default mode=direct_qr returns a MySewa /api/deposit/paybridge/qr/ URL and qr_image. Optional mode=hosted returns PayBridge checkout. HimalPay is never used.
- customer_* fields only affect PayBridge checkout display; receiver still receives the wallet credit.
- Configure a Webhook URL on the API user (Admin → API Users). After verified payment.succeeded, MySewa POSTs status, amount, reference, and order/transaction ids to that URL once (idempotent).

## MySewa Internal QR Deposit Integration Guide (Fonepay Direct-QR)

Instead of redirecting your customers to PayBridge direct hosted checkout (`checkout.paybridgenp.com`) with external method-picker screens, MySewa provides an **Internal Direct-QR Payment Page** (`https://mysewaserver.sewabyapar.com/api/deposit/paybridge/qr/?order={order_id}`) along with a dynamic QR payload (`qr_image`).

### Why Use MySewa Internal QR?

1. **Brand Consistency & Seamless UX**: The checkout interface runs entirely on MySewa's trusted domain (`mysewaserver.sewabyapar.com`), keeping your players and users inside your platform ecosystem without confusing third-party redirects.
2. **Instant Dynamic Fonepay QR**: The QR code is displayed immediately upon opening the page — no need to click through extra "Pay with Fonepay" payment method screens.
3. **Universal Nepal Banking Compatibility**: Compatible with **all** Nepalese mobile banking apps (Fonepay, eSewa, Khalti, Global Smart Plus, Nabil SmartBank, NIC Asia MoBank, Prabhu, Sanima, Himalayan Bank, and all commercial/development banks).
4. **Built-in "Download QR Image" Feature**: The internal QR page includes a dedicated **"QR डाउनलोड गर्नुहोस् (Download QR)"** button right below the QR code. Mobile users can download the QR image directly into their photo gallery with one tap, switch to their mobile banking app, and scan the QR from their photos to pay instantly.
5. **Real-Time Live Polling & Auto-Redirect**: The internal QR page automatically polls the backend every few seconds. Once payment is completed and verified, it presents an instant success confirmation and automatically redirects the customer back to your configured `return_url`.
6. **Built-in Countdown Timer**: Features an intuitive Devanagari & English countdown timer (2 minutes) to ensure high completion rates.

---

### How to Integrate MySewa Internal QR

#### 1. Create Deposit via Payin API (`POST /api/v1/payin/`)
Call the Payin API endpoint using `mode: "direct_qr"` (default mode):

```bash
curl -X POST "https://mysewaserver.sewabyapar.com/api/v1/payin/" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "receiver": "98XXXXXXXX",
    "amount": 1000,
    "reference": "DEP-20261109-001",
    "mode": "direct_qr",
    "return_url": "https://yourgame.example/deposit/complete"
  }'
```

#### 2. Payin API Response Payload
The API returns both the internal QR page URL (`checkout_url` / `payment_url`) and the Base64 QR code image (`qr_image`):

```json
{
  "success": true,
  "message": "Payin checkout ready",
  "transaction_id": "MS-PB-9d4ef9284fd04440ba34fde7eaf4f4ff",
  "deposit_id": 12345,
  "order_id": "MS-PB-9d4ef9284fd04440ba34fde7eaf4f4ff",
  "reference": "DEP-20261109-001",
  "receiver": "98XXXXXXXX",
  "amount": 1000,
  "currency": "NPR",
  "status": "PENDING",
  "provider": "paybridgenp",
  "mode": "direct_qr",
  "checkout_url": "https://mysewaserver.sewabyapar.com/api/deposit/paybridge/qr/?order=MS-PB-9d4ef9284fd04440ba34fde7eaf4f4ff",
  "payment_url": "https://mysewaserver.sewabyapar.com/api/deposit/paybridge/qr/?order=MS-PB-9d4ef9284fd04440ba34fde7eaf4f4ff",
  "qr_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "session_id": "cs_direct_qr_12345",
  "expires_at": "2026-11-09T11:45:00+05:45",
  "failure_reason": "",
  "verification_status": "unverified"
}
```

---

### Implementation Approaches

#### Option A: Direct Redirect to MySewa Internal QR Page (Recommended)
Open `checkout_url` / `payment_url` in a new browser tab, iframe, or mobile WebView.

- URL format: `https://mysewaserver.sewabyapar.com/api/deposit/paybridge/qr/?order=MS-PB-...`
- The user completes payment using the live QR code or taps **QR डाउनलोड गर्नुहोस् (Download QR)**.
- Once completed, the page automatically redirects the customer to your `return_url`.

#### Option B: Native In-App Embedding with Download QR Image Button
If you want to keep users entirely inside your native mobile or web interface:

1. Render `qr_image` (Base64 data URL) in your app's UI.
2. Provide a **Download QR Image** button so mobile users can save the QR code to their device gallery.

**JavaScript Example for Native Download Button:**
```javascript
function downloadPaymentQr(qrBase64DataUrl, orderId) {
  const link = document.createElement('a');
  link.href = qrBase64DataUrl;
  link.download = `mysewa-qr-${orderId || 'deposit'}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
```

#### Option C: Status Verification & Webhooks
1. **Server-to-Server Webhook**: Once the user scans and pays, MySewa's backend verifies the payment and immediately triggers a signed webhook to your registered developer webhook URL (`Admin → API Users → Webhook URL`).
2. **Polling API**: You can also poll the status at any time:
   ```bash
   GET https://mysewaserver.sewabyapar.com/api/v1/payin/status/?reference=DEP-20261109-001
   ```

## Withdraw API (Bank Transfer / Payout)

`POST /api/v1/banktransfer/`

Full URL: `https://mysewaserver.sewabyapar.com/api/v1/banktransfer/`

Pays a verified bank account through HimalPay BANK_TRANSFER using the API user MySewa wallet. The wallet is debited only after HimalPay reports success (or auto-verified pending policy). Failed HimalPay responses do not consume the client reference, so the same reference can be retried.

### Headers

- `Authorization` (required) — `Bearer YOUR_API_KEY`
- `Content-Type` (required) — `application/json`
- `Idempotency-Key` — `ORDER-10001`

### Request parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `bank_code` | yes | string | Same HimalPay bank code used in /verifiedbank/. |
| `bank_account_number` | yes | string | Destination account number previously verified. |
| `account_holder_name` | yes | string | Account holder name previously verified. |
| `amount` | yes | number | NPR amount. Must be greater than zero and within transfer limits. HimalPay is paid in paisa. |
| `reference` | yes | string | Unique client reference (1-64 letters, digits, hyphen, underscore, period). Replay of a completed reference returns the original result without a second debit. |

### Request example

```json
{
  "bank_code": "NABILNPKA",
  "bank_account_number": "1234567890123",
  "account_holder_name": "John Doe",
  "amount": 1000,
  "reference": "ORDER-10001"
}
```

### Successful response

201 Created on a new SUCCESS transfer; 202 Accepted when HimalPay/MySewa status is PENDING; 200 OK on idempotent replay.

```json
{
  "success": true,
  "message": "Bank transfer successful",
  "transaction_id": "MYSEWA_BT_A1B2C3D4E5F678",
  "provider_reference": "HP123456",
  "reference": "ORDER-10001",
  "amount": 1000,
  "status": "SUCCESS",
  "data": {
    "bank_code": "NABILNPKA",
    "bank_name": "Nabil Bank Limited",
    "account_number": "*********0123",
    "account_holder_name": "John Doe",
    "method": "API Bank Transfer"
  }
}
```

### Examples

#### cURL

```bash
curl -X POST "https://mysewaserver.sewabyapar.com/api/v1/banktransfer/" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "bank_code": "NABILNPKA",
  "bank_account_number": "1234567890123",
  "account_holder_name": "John Doe",
  "amount": 1000,
  "reference": "ORDER-10001"
}'
```

#### Python

```python
import requests

url = "https://mysewaserver.sewabyapar.com/api/v1/banktransfer/"
headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
}
payload = {
  "bank_code": "NABILNPKA",
  "bank_account_number": "1234567890123",
  "account_holder_name": "John Doe",
  "amount": 1000,
  "reference": "ORDER-10001"
}
response = requests.post(url, json=payload, headers=headers, timeout=60)
print(response.status_code, response.json())

```

#### JavaScript

```javascript
const url = "https://mysewaserver.sewabyapar.com/api/v1/banktransfer/";
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
  "bank_code": "NABILNPKA",
  "bank_account_number": "1234567890123",
  "account_holder_name": "John Doe",
  "amount": 1000,
  "reference": "ORDER-10001"
}),
});
const data = await response.json();
console.log(response.status, data);

```

### Errors

- `401` `invalid_api_key` — Invalid API key: The API key is missing, invalid, or has been revoked.
- `403` `api_access_disabled` — API access disabled: API access is disabled for this account.
- `403` `user_inactive` — User inactive: This account is inactive and cannot use the API.
- `429` `throttled` — Too many requests: Too many requests. Please slow down and try again.
- `500` `server_error` — Server/internal error: The request could not be completed. Please try again.
- `502` `provider_unavailable` — HimalPay unavailable: The payment provider is temporarily unavailable. Please try again later.
- `504` `provider_timeout` — HimalPay timeout: The payment provider took too long to respond. Please try again.
- `400` `provider_error` — HimalPay API error: The payment provider rejected this request.
- `400` `verification_required` — Verification required: Call POST /api/v1/verifiedbank/ first for these bank details.
- `400` `verification_failed` — Bank account verification failed: HimalPay re-verification failed before payout.
- `400` `insufficient_balance` — Insufficient balance: Wallet does not cover amount plus charges.
- `400` `invalid_amount` — Invalid amount: Amount must be a valid number greater than zero and within limits.
- `400` `duplicate_reference` — Duplicate reference: Reference is missing, malformed, or already being processed.
- `409` `duplicate_reference` — Duplicate reference: This reference is already being processed.
- `400` `transfer_failed` — Transfer failed: HimalPay rejected or failed the payout. Wallet was not debited.
- `400` `bank_not_supported` — Bank not supported: This bank is not on the HimalPay bank list.
- `403` `unauthorized_transaction` — Unauthorized transaction: Bank transfer is disabled, blocked, or over the daily limit.

- MySewa re-verifies with HimalPay immediately before BANK_TRANSFER. A cached /verifiedbank/ result is required but is not treated as the final match.
- transaction_id is the MySewa merchant id (MYSEWA_BT_...). provider_reference is HimalPay when present.
- status is SUCCESS, PENDING, or FAILED. Do not treat PENDING as paid.
- HimalPay payout fields: destination_bank, destination_acc_no, destination_acc_name, amount in paisa.

## Bank List API

`GET /api/v1/banklist/`

Full URL: `https://mysewaserver.sewabyapar.com/api/v1/banklist/`

Returns banks currently available through the configured HimalPay BANK_TRANSFER_LIST service. MySewa does not hardcode this list. Use bank_code from this response in later calls. Results are cached for about 30 minutes; pass refresh=1 to force a HimalPay refresh.

### Headers

- `Authorization` (required) — `Bearer YOUR_API_KEY`

### Query parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `refresh` | no | boolean | Set to 1 to bypass cache and fetch a fresh HimalPay bank list. |

### Request parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| — | — | — | No request body |

### Successful response

200 OK

```json
{
  "success": true,
  "source": "himalpay",
  "data": [
    {
      "bank_code": "NABILNPKA",
      "bank_name": "Nabil Bank Limited"
    },
    {
      "bank_code": "NICENPKA",
      "bank_name": "NIC Asia Bank Limited"
    }
  ]
}
```

### Examples

#### cURL

```bash
curl -X GET "https://mysewaserver.sewabyapar.com/api/v1/banklist/" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### Python

```python
import requests

url = "https://mysewaserver.sewabyapar.com/api/v1/banklist/"
headers = {"Authorization": "Bearer YOUR_API_KEY"}
response = requests.get(url, headers=headers, timeout=30)
print(response.status_code, response.json())

```

#### JavaScript

```javascript
const url = "https://mysewaserver.sewabyapar.com/api/v1/banklist/";
const response = await fetch(url, {
  method: "GET",
  headers: { Authorization: "Bearer YOUR_API_KEY" },
});
const data = await response.json();
console.log(response.status, data);

```

### Errors

- `401` `invalid_api_key` — Invalid API key: The API key is missing, invalid, or has been revoked.
- `403` `api_access_disabled` — API access disabled: API access is disabled for this account.
- `403` `user_inactive` — User inactive: This account is inactive and cannot use the API.
- `429` `throttled` — Too many requests: Too many requests. Please slow down and try again.
- `500` `server_error` — Server/internal error: The request could not be completed. Please try again.
- `502` `provider_unavailable` — HimalPay unavailable: The payment provider is temporarily unavailable. Please try again later.
- `504` `provider_timeout` — HimalPay timeout: The payment provider took too long to respond. Please try again.
- `400` `provider_error` — HimalPay API error: The payment provider rejected this request.
- `403` `unauthorized_transaction` — Unauthorized transaction: Transfers or bank transfer permission are disabled.

- bank_code is the HimalPay instrument/SWIFT-style code (for example NABILNPKA), not a local nickname.
- bank_name is the display name returned by HimalPay.
- source is himalpay on a live fetch or cache when a recent list is reused.

## Deposit Status API

`GET /api/v1/payin/status/`

Full URL: `https://mysewaserver.sewabyapar.com/api/v1/payin/status/`

Returns the live status of a Payin created by this API user. When still PENDING, MySewa soft-verifies with PayBridgeNP before responding.

### Headers

- `Authorization` (required) — `Bearer YOUR_API_KEY`

### Query parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `reference` | no | string | Client reference from POST /api/v1/payin/. |
| `order_id` | no | string | MySewa / PayBridge order id (MS-PB-…). Alias: transaction_id. |
| `deposit_id` | no | integer | Internal deposit id from the create response. |

### Request parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| — | — | — | No request body |

### Successful response

200 OK

```json
{
  "success": true,
  "message": "Payin status",
  "transaction_id": "MS-PB-a1b2c3d4e5f6",
  "deposit_id": 12345,
  "order_id": "MS-PB-a1b2c3d4e5f6",
  "reference": "PAYIN-10001",
  "receiver": "98XXXXXXXX",
  "amount": 1000,
  "currency": "NPR",
  "status": "SUCCESS",
  "provider": "paybridgenp",
  "mode": "direct_qr",
  "checkout_url": "https://mysewaserver.sewabyapar.com/api/deposit/paybridge/qr/?order=MS-PB-a1b2c3d4e5f6",
  "payment_url": "https://mysewaserver.sewabyapar.com/api/deposit/paybridge/qr/?order=MS-PB-a1b2c3d4e5f6",
  "session_id": "cs_xxx",
  "payment_id": "pay_xxx",
  "expires_at": "2026-09-17T12:00:00+05:45",
  "failure_reason": "",
  "verification_status": "verified"
}
```

### Examples

#### cURL

```bash
curl -X GET "https://mysewaserver.sewabyapar.com/api/v1/payin/status/?reference=PAYIN-10001" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

#### Python

```python
import requests

url = "https://mysewaserver.sewabyapar.com/api/v1/payin/status/?reference=PAYIN-10001"
headers = {"Authorization": "Bearer YOUR_API_KEY"}
response = requests.get(url, headers=headers, timeout=30)
print(response.status_code, response.json())

```

#### JavaScript

```javascript
const url = "https://mysewaserver.sewabyapar.com/api/v1/payin/status/?reference=PAYIN-10001";
const response = await fetch(url, {
  method: "GET",
  headers: { Authorization: "Bearer YOUR_API_KEY" },
});
const data = await response.json();
console.log(response.status, data);

```

### Errors

- `401` `invalid_api_key` — Invalid API key: The API key is missing, invalid, or has been revoked.
- `403` `api_access_disabled` — API access disabled: API access is disabled for this account.
- `403` `user_inactive` — User inactive: This account is inactive and cannot use the API.
- `429` `throttled` — Too many requests: Too many requests. Please slow down and try again.
- `500` `server_error` — Server/internal error: The request could not be completed. Please try again.
- `404` `payin_not_found` — Payin not found: No payin was found for the given reference, order_id, or deposit_id.

- Provide at least one of reference, order_id/transaction_id, or deposit_id.
- POST to the same path with a JSON body is also accepted.
- Statuses: PENDING, SUCCESS, FAILED, CANCELLED, EXPIRED, REFUNDED.


## Fund Transfer API

`POST /api/v1/fund-transfer/`

Full URL: `https://mysewaserver.sewabyapar.com/api/v1/fund-transfer/`

### Headers

- `Authorization` (required) — `Bearer YOUR_API_KEY`
- `Content-Type` (required) — `application/json`
- `Idempotency-Key` — `ORDER-10001`

### Request Parameters

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| receiver | yes | string | Phone (preferred), email, or numeric user id of the MySewa recipient |
| amount | yes | number | NPR amount greater than zero |
| reference | yes | string | Unique client reference used for idempotency |

Example:

```json
{
  "receiver": "98XXXXXXXX",
  "amount": 1000,
  "reference": "ORDER-10001"
}
```

### Validation rules

- Receiver must exist, be active, and must not be the sender.
- Amount must be a positive number (zero and negative values are rejected).
- Amount must satisfy the configured min/max transfer limits.
- Sender wallet must have sufficient balance including any applicable charges.
- Sender must be an API user with an active, approved account and wallet transfer permission.
- Frozen or blocked wallets cannot send or receive.
- Reference is required, 1-64 characters: letters, digits, hyphen, underscore, and period.

### Request Examples

#### cURL

```bash
curl -X POST "https://mysewaserver.sewabyapar.com/api/v1/fund-transfer/" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "receiver": "98XXXXXXXX",
    "amount": 1000,
    "reference": "ORDER-10001"
  }'
```

#### Python

```python
import requests

url = "https://mysewaserver.sewabyapar.com/api/v1/fund-transfer/"
headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
}
payload = {
    "receiver": "98XXXXXXXX",
    "amount": 1000,
    "reference": "ORDER-10001",
}
response = requests.post(url, json=payload, headers=headers, timeout=30)
print(response.status_code, response.json())

```

#### JavaScript

```javascript
const url = "https://mysewaserver.sewabyapar.com/api/v1/fund-transfer/";
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    receiver: "98XXXXXXXX",
    amount: 1000,
    reference: "ORDER-10001",
  }),
});
const data = await response.json();
console.log(response.status, data);

```

### Successful Response

201 Created for a new transfer; 200 OK when replaying a completed reference.

`transaction_id` is the MySewa wallet-transfer reference (for example `MYSEWA_WT_...`).

```json
{
  "success": true,
  "message": "Fund transfer successful",
  "transaction_id": "MYSEWA_WT_A1B2C3D4E5F678",
  "reference": "ORDER-10001",
  "amount": 1000,
  "status": "SUCCESS"
}
```

### Error Responses

- `401` `invalid_api_key` — Invalid API key: The API key is missing, invalid, or has been revoked.
- `403` `api_access_disabled` — API access disabled: API fund-transfer access is disabled for this account.
- `403` `user_inactive` — User inactive: This account is inactive and cannot perform transfers.
- `400` `invalid_receiver` — Invalid receiver: Receiver is required, is the sender, or cannot receive transfers.
- `404` `receiver_not_found` — Receiver not found: No MySewa user was found for that receiver.
- `400` `insufficient_balance` — Insufficient balance: Sender wallet does not cover amount plus applicable charges.
- `400` `invalid_amount` — Invalid amount: Amount must be a valid number greater than zero and within limits.
- `400` `duplicate_reference` — Duplicate reference: Reference is missing, malformed, or already being processed.
- `409` `duplicate_reference` — Duplicate reference: This reference is already being processed.
- `403` `unauthorized_transaction` — Unauthorized transaction: Wallet transfer is disabled, blocked, frozen, or over the daily limit.
- `404` `wallet_unavailable` — Wallet unavailable: Wallet is unavailable for this transfer.
- `429` `throttled` — Too many requests: Too many requests. Please slow down and try again.
- `500` `server_error` — Server/internal error: The transfer could not be completed. Please try again.

Error body shape:

```json
{
  "success": false,
  "error": "Insufficient balance",
  "message": "Human-readable explanation",
  "code": "insufficient_balance"
}
```

Internal exception messages and stack traces are never returned.

### HTTP Status Codes

- `200` — Idempotent replay of a completed transfer. No second debit.
- `201` — New fund transfer created and wallets updated.
- `400` — Validation failed (receiver, amount, balance, or reference).
- `401` — Missing, invalid, or revoked API key.
- `403` — API access disabled, inactive user, or unauthorized wallet.
- `404` — Receiver or wallet was not found.
- `409` — The same reference is already being processed.
- `429` — Rate limit exceeded (60 requests per minute).
- `500` — Unexpected server error. Reference is not consumed; retry is allowed.

---

## Duplicate / idempotency behavior

Each API user may use a given `reference` (or Idempotency-Key) only once for a successful transfer. A repeated request with the same reference returns HTTP 200 and the original transaction_id and does not debit again. A failed attempt does not consume the reference, so the client may retry the same reference.

## API Transaction History

API transactions are created automatically when your application calls Fund Transfer or Bank Transfer APIs. Bank verification is not a wallet transaction and does not appear here.There is no manual "create API transaction" action in the dashboard.

- Transaction ID (MySewa wallet-transfer reference, present on success)
- Sender (authenticated API user)
- Receiver (phone, email, or user id submitted in the request)
- Amount
- Client reference
- Status (SUCCESS or FAILED)
- Method (API for wallet-to-wallet, API Bank Transfer for HimalPay payouts)
- Created date/time
- Masked bank account and provider reference for bank transfers
- Failure reason when the request did not succeed

Successful API transfers also appear in standard wallet history because they reuse the existing MySewa wallet-transfer ledger. Failed API attempts are audit records only.

Empty state: No API transactions yet. Transactions will appear here after your application makes a fund-transfer request through the API.

## Security Guidelines

- Use HTTPS in production. Do not send API keys over plain HTTP.
- Store the API key like a password. Rotate it if it is exposed.
- Never log API keys, put them in URLs, or share them in support tickets.
- Regenerating a key invalidates the previous key immediately.
- The Developer API is throttled to 60 requests per minute per API user.

---

## Documentation Download

Dashboard users with API access can download this documentation directly:

- **Markdown (`.md`)**: `GET /api/developer/docs/download/?doc_format=markdown`
- **HTML**: `GET /api/developer/docs/download/?doc_format=html`
- **PDF**: `GET /api/developer/docs/download/?doc_format=pdf`

Supported `doc_format` values: `markdown`, `html`, `pdf`.
