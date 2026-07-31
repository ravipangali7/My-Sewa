# HimalPay Reseller API — Integration Guide

> Source: [https://uat.himalpay.com.np/docs/reseller](https://uat.himalpay.com.np/docs/reseller)  
> Captured: 2026-07-31  
> Environment: **UAT**  
> Base URL: `https://uatapi.himalpay.com.np/api/v1`

This document is the Digital Wallet Reseller API reference for integrating HimalPay wallet services (top-up, ISP, utilities, insurance, bank transfer, voting, remittance, etc.).

**Quick notes for integrators**
- Authenticate every request with header `X-API-Key: YOUR_API_KEY`.
- All money fields (`amount`, `charge`, `cashback`, `total_debited`, `total_credited`) are integers in **paisa** (`10000` = Rs. 100.00), unless a vendor nested field explicitly says otherwise.
- Your server IPs must be allowlisted; only Reseller accounts can call these endpoints.
- Keep `merchant_transaction_id` unique across all your transactions; use it to poll status.
- Most flows debit via `POST /payments/wallet-service-reseller-payment`. Samsara remittance payout is a **credit/load** via `POST /loads/wallet-service-reseller-load`.

---

Welcome to the Digital Wallet Reseller API. This documentation provides the necessary information for resellers to integrate our wallet services into their own applications.

## Base URL

```
base_url = https://uatapi.himalpay.com.np/api/v1

```

All API requests should be made to `https://uatapi.himalpay.com.np/api/v1`. Update the variable above if the base URL changes.

## Authentication

Authentication is handled via an API Key. You must include your API key in every request through one of the following methods:

1. **HTTP Header**: `X-API-Key: YOUR_API_KEY`

> [!IMPORTANT]
> 
> * **Currency Amounts**: All currency fields (e.g., `amount`, `charge`, `cashback`, `total_debited`, `total_credited`) are represented in **paisa** as integers. (e.g., `10000` = Rs. 100.00).
> * Access is restricted to authorized IP addresses only. Please provide your server's IP addresses to our support team for allowlisting.
> * Only accounts with "Reseller" status can use these endpoints.

---

## API Endpoints

### 1. List Available Services

Retrieve a list of all wallet services available for your account. Use the `name` field from the response as the `wallet_service_name` in payment and detail requests.

* **URL**: `/details/my-reseller-services`
* **Method**: `GET`
* **Response Body**:  
   * `id` (int): Unique identifier for the service.  
   * `name` (string): Unique name of the service.  
   * `logo_image_url` (string, optional): URL to the service's logo image.

### 2. Process Payment

Process a payment for a specific wallet service (e.g., NTC, NCELL, Worldlink).

* **URL**: `/payments/wallet-service-reseller-payment`
* **Method**: `POST`
* **Request Body**:  
   * `wallet_service_name` (string, required): The unique name of the service.  
   * `amount` (int, required): The transaction amount in paisa (e.g., 10000 = Rs. 100).  
   * `merchant_transaction_id` (string, required): A unique identifier from your system for this transaction. **Must be unique across all your transactions.**  
   * `meta_data` (array, optional): Additional information for display or processing.  
   * `data` (object, required): Service-specific input data (e.g., mobile number).

### 3. Fetch Service Details

Fetch details or validate information before processing a payment (Required for some services like Worldlink).

* **URL**: `/details/wallet-service-reseller-detail`
* **Method**: `POST`
* **Request Body**:  
   * `wallet_service_name` (string, required): Use the lookup service name (e.g., `WLINK_GET`).  
   * `data` (object, required): Query parameters (e.g., username).

### 4. Calculate Cashback and Charge

Calculate the expected charge and cashback for a given wallet service and amount before processing a payment. Use this to display fee breakdowns to customers prior to confirming a transaction.

* **URL**: `/details/reseller-calculate-cashback-and-charge`
* **Method**: `POST`
* **Request Body**:  
   * `wallet_service_name` (string, required): The unique name of the service (e.g., `NTC`, `BANK_TRANSFER`).  
   * `amount` (number, required): The intended transaction amount in paisa.
* **Response Body**:  
   * `charge` (int): Applicable fee in paisa.  
   * `cashback` (int): Applicable cashback in paisa.  
   * `total_debited` (int): Net amount that would be deducted (`amount + charge - cashback`) in paisa.

#### Calculate Cashback and Charge Example

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/reseller-calculate-cashback-and-charge \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "BANK_TRANSFER",
  "amount": 10000
}'

```

**Response (Amounts in paisa):**

```
{
  "wallet_service_name": "BANK_TRANSFER",
  "amount": 1000,
  "applied_cashback": 0,
  "applied_charge": 500,
  "net_amount": 1500,
  "message": "Rules calculated successfully"
}

```

### 5. Check Transaction Status

Check the status of a transaction using your `merchant_transaction_id`.

* **URL**: `/transactions/wallet-service-reseller-status`
* **Method**: `POST`
* **Request Body**:  
   * `merchant_transaction_id` (string, required): The unique identifier you provided during payment.
* **Response Body**:  
   * `status` (string): Transaction status (`SUCCESS`, `FAILED`, `UNKNOWN`).  
   * `amount` (int): Transaction amount **in paisa**.  
   * `charge` (int): Fees charged **in paisa**.  
   * `cashback` (int): Cashback earned **in paisa**.  
   * `total_debited` (int): Total amount deducted from your balance **in paisa**.  
   * `transaction_id` (string): Internal transaction identifier.  
   * `reference_id` (string): External operator reference (if available).  
   * `created_at` (string): Timestamp of the transaction.

#### Check Transaction Status Example

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/transactions/wallet-service-reseller-status \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "merchant_transaction_id": "ABC-12345"
}'

```

**Response (Amounts in paisa):**

```
{
  "merchant_transaction_id": "ABC-12345",
  "transaction_id": "TXN-789-XYZ",
  "status": "SUCCESS",
  "amount": 10000,
  "charge": 0,
  "cashback": 0,
  "total_debited": 10000,
  "reference_id": "REF123",
  "created_at": "2026-03-22T19:41:32Z"
}

```

---

## Service Examples

### List Services

**Request:**

```
curl --request GET \
  --url https://uatapi.himalpay.com.np/api/v1/details/my-reseller-services \
  --header 'x-api-key: YOUR_API_KEY'

```

**Response:**

```
[
  {
    "id": 1,
    "name": "NTC",
    "logo_image_url": "https://example.com/ntc_logo.png"
  },
  {
    "id": 2,
    "name": "NCELL",
    "logo_image_url": "https://example.com/ncell_logo.png"
  }
]

```

### NTC Top-up

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NTC",
  "amount": 10000,
  "merchant_transaction_id": "ABC-12345",
  "data": {
    "number": "9841XXXXXX"
  }
}'

```

### NCELL Top-up

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NCELL",
  "amount": 10000,
  "merchant_transaction_id": "ABC-67890",
  "data": {
    "number": "9802XXXXXX"
  }
}'

```

### Worldlink (Two-Step Payment)

#### Step 1: Fetch Account Details

Retrieve package information and `session_id`.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "WLINK_GET"
  "data": {
    "username": "online_renew"
  }
}'

```

#### Step 2: Process Payment

Use the `package_id` and `session_id` from Step 1.

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "WLINK_PAY",
  "amount": 452000,
  "merchant_transaction_id": "ABC-WLINK-PAY-01",
  "data": {
    "package_id": 800011,
    "session_id": 30917,
    "username": "online_renew"
  }
}'

```

### NTC Data Pack (Two-Step Payment)

NTC data pack subscription requires fetching available packages first.

#### Step 1: Fetch Available Packages

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NTC_DATA_PACK_GET",
  "data": {}
}'

```

#### Step 2: Process Payment

Use the `package_id` and `product_code` from Step 1.

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NTC_DATA_PACK_PAY",
  "amount": 2000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "number": "9841XXXXXX",
    "package_id": 20,
    "product_code": 20
  }
}'

```

**`data` fields:**

* `number` (string): Subscriber mobile number.
* `package_id` (int): Package ID from Step 1.
* `product_code` (int): Product code from Step 1.

### NCELL Data Pack (Two-Step Payment)

NCELL data pack subscription requires fetching available packages first.

#### Step 1: Fetch Available Packages

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NCELL_DATA_PACK_GET",
  "data": {}
}'

```

#### Step 2: Process Payment

Use the `product_code` from Step 1.

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NCELL_DATA_PACK_PAY",
  "amount": 5500,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "number": "9802XXXXXX",
    "product_code": "1_day_10min_India"
  }
}'

```

**`data` fields:**

* `number` (string): Subscriber mobile number.
* `product_code` (string): Product code from Step 1.

### ADSL (Direct Payment)

Supports two ADSL service variants: unlimited (`ADSLUL`) and volume-based (`ADSLVB`).

**Request — ADSL Unlimited (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "ADSLUL",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "number": "014XXXXXXX"
  }
}'

```

**Request — ADSL Volume-Based (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "ADSLVB",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "number": "014XXXXXXX"
  }
}'

```

**`data` fields:**

* `number` (string): ADSL landline number.

### NEA Electricity (Three-Step Payment)

NEA electricity bill payment requires fetching the office counter, then account details, before processing.

#### Step 1: Get Office Counters

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NEA_GET_COUNTER",
  "data": {}
}'

```

The response contains a list of office counters with their `office_code` values.

#### Step 2: Fetch Account Details

Use the `office_code` from Step 1.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NEA_GET_DETAIL",
  "data": {
    "sc_no": "005.17.202",
    "office_code": "245:bhaktapur-dc",
    "consumer_id": "333"
  }
}'

```

**`data` fields:**

* `sc_no` (string): Service connection number.
* `office_code` (string): Office code from Step 1.
* `consumer_id` (string): Consumer ID.

The response contains bill details and a `session_id`.

#### Step 3: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NEA_PAY",
  "amount": 20000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": 31824,
    "consumer_id": "3042"
  }
}'

```

**`data` fields:**

* `session_id` (int): Session ID from Step 2.
* `consumer_id` (string): Consumer ID from Step 2.

### KUKL Water (Three-Step Payment)

KUKL water bill payment requires fetching the payment counter, then account details, before processing.

#### Step 1: Get Counters

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "KUKL_GET_COUNTER",
  "data": {}
}'

```

The response contains a list of counters with their `counter` codes.

#### Step 2: Fetch Account Details

Use the `counter` value from Step 1.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "KUKL_GET_DETAIL",
  "data": {
    "connection_no": 9352,
    "counter": "1114:test-kukl",
    "customer_code": 1114003014
  }
}'

```

**`data` fields:**

* `connection_no` (int): KUKL connection number.
* `counter` (string): Counter code from Step 1.
* `customer_code` (int): Customer code.

The response contains bill details and a `session_id`.

#### Step 3: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "KUKL_PAY",
  "amount": 100000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "payment_type": "Bill Payment",
    "session_id": 50054
  }
}'

```

**`data` fields:**

* `payment_type` (string): Payment type (e.g., `"Bill Payment"`).
* `session_id` (int): Session ID from Step 2.

### Community Electricity — Himchuli (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "HIMCHULI_GET",
  "data": {
    "customer_number": "356",
    "service_slug": "himchuli"
  }
}'

```

**`data` fields:**

* `customer_number` (string): Customer number.
* `service_slug` (string): Service slug for the provider.

The response contains bill details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "HIMCHULI_PAY",
  "amount": 170800,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "50078"
  }
}'

```

### Community Electricity — Watermark (Three-Step Payment)

#### Step 1: Fetch Service Slugs

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "WATERMARK_SLUGS",
  "data": {
    "customer_code": "01-1",
    "service_slug": "shree-shiv-shaktiman-gramin-vidhut"
  }
}'

```

#### Step 2: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "WATERMARK_GET",
  "data": {
    "customer_code": "01-1",
    "service_slug": "shree-shiv-shaktiman-gramin-vidhut"
  }
}'

```

**`data` fields:**

* `customer_code` (string): Customer code.
* `service_slug` (string): Provider slug from Step 1.

The response contains bill details and a `session_id`.

#### Step 3: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "WATERMARK_PAY",
  "amount": 170800,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "50078"
  }
}'

```

### Community Electricity — Dreamer (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "DREAMER_GET",
  "data": {
    "customer_no": "01-1",
    "service_slug": "khamari-khola-electricity"
  }
}'

```

**`data` fields:**

* `customer_no` (string): Customer number.
* `service_slug` (string): Provider slug.

The response contains bill details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "DREAMER_PAY",
  "amount": 18000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": 245
  }
}'

```

### Community Electricity — Softlab (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SOFTLAB_GET",
  "data": {
    "customer_code": "12",
    "month": 0,
    "service_slug": "badagaun-electricity"
  }
}'

```

**`data` fields:**

* `customer_code` (string): Customer code.
* `month` (int): Number of months (0 for current dues).
* `service_slug` (string): Provider slug.

The response contains bill details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SOFTLAB_PAY",
  "amount": 281000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": 494
  }
}'

```

### Community Electricity — BPC (Three-Step Payment)

#### Step 1: Get Counters

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "BPC_GET_COUNTER",
  "data": {}
}'

```

The response contains a list of counters with their `counter_code` values.

#### Step 2: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "BPC_GET_DETAILS",
  "data": {
    "consumer_id": 1246,
    "consumer_no": "0005.0007.000268",
    "counter_code": "1:bpc-waling"
  }
}'

```

**`data` fields:**

* `consumer_id` (int): Consumer ID.
* `consumer_no` (string): Consumer number.
* `counter_code` (string): Counter code from Step 1.

The response contains bill details and a `session_id`.

#### Step 3: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "BPC_PAY",
  "amount": 125180,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "717"
  }
}'

```

### eChelan Government Payment (Two-Step Payment)

#### Step 1: Fetch Chelan Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "ECHALAN_GET",
  "data": {
    "app_id": "MER-7-APP-11",
    "voucher_no": "2078-232544",
    "district_code": 123,
    "fiscal_year": 123,
    "province_code": 123,
    "service": "echalan"
  }
}'

```

**`data` fields:**

* `app_id` (string): Application identifier.
* `voucher_no` (string): eChelan voucher number.
* `district_code` (int): District code.
* `fiscal_year` (int): Fiscal year.
* `province_code` (int): Province code.
* `service` (string): Service type (e.g., `"echalan"`).

The response contains chelan details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "ECHALAN_PAY",
  "amount": 200000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": 3855,
    "voucher_no": "2078-232544"
  }
}'

```

**`data` fields:**

* `session_id` (int): Session ID from Step 1.
* `voucher_no` (string): eChelan voucher number.

### Government Payment (Two-Step Payment)

#### Step 1: Fetch Payment Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "GOVERNMENT_GET",
  "data": {
    "app_id": "MER-7-APP-11",
    "voucher_no": "2078-232544",
    "amount": 50000
  }
}'

```

**`data` fields:**

* `app_id` (string): Application identifier.
* `voucher_no` (string): Voucher number.
* `amount` (int): Expected payment amount in paisa.

The response contains payment details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "GOVERNMENT_PAY",
  "amount": 50000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": 3855,
    "voucher_no": "2078-232544"
  }
}'

```

### Meroshare (Three-Step Payment)

Meroshare renewal requires fetching the DP (Depository Participant) counter, then account details, before processing.

#### Step 1: Get DP Counters

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "MEROSHARE_GET_COUNTER",
  "data": {}
}'

```

The response contains a list of DPs with their `service_slug` values.

#### Step 2: Fetch Account Details

Use the `service_slug` from Step 1.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "MEROSHARE_GET_DETAIL",
  "data": {
    "client_code": "10000113",
    "payment_type": "Both",
    "service_slug": "nibl-ace-capital-limited"
  }
}'

```

**`data` fields:**

* `client_code` (string): Client/BOID code.
* `payment_type` (string): Type of renewal — `"Meroshare"`, `"DEMAT"`, or `"Both"`.
* `service_slug` (string): DP slug from Step 1.

The response contains renewal options and a `session_id`.

#### Step 3: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "MEROSHARE_PAY",
  "amount": 35000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "demat_renew_year": 3,
    "meroshare_renew_year": 1,
    "session_id": 50096
  }
}'

```

**`data` fields:**

* `demat_renew_year` (int): Number of years to renew DEMAT (0 if not renewing).
* `meroshare_renew_year` (int): Number of years to renew Meroshare (0 if not renewing).
* `session_id` (int): Session ID from Step 2.

### Broadlink Internet (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "BROADLINK_GET",
  "data": {
    "customer_id": "53905"
  }
}'

```

The response contains plan information and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "BROADLINK_PAY",
  "amount": 452000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "package_id": 800011,
    "session_id": 31094,
    "username": "online_renew"
  }
}'

```

### Chitrawan Internet (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "CHITRAWAN_GET",
  "data": {
    "username": "khalti_test",
    "request_id": "khalti_test"
  }
}'

```

The response contains plan information and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "CHITRAWAN_PAY",
  "amount": 452000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": 31094
  }
}'

```

### Arrownet Internet (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "ARROWNET_GET",
  "data": {
    "username": "username"
  }
}'

```

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "ARROWNET_PAY",
  "amount": 169500,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "duration": 1,
    "username": "username"
  }
}'

```

**`data` fields:**

* `duration` (int): Renewal duration in months.
* `username` (string): Account username.

### Vianet Internet (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VIANET_GET",
  "data": {
    "customer_id": "110871"
  }
}'

```

The response contains plan and payment details including a `payment_id` and `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VIANET_PAY",
  "amount": 4746,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "payment_id": "1613122_PP",
    "session_id": 50050,
    "customer_id": "110871"
  }
}'

```

**`data` fields:**

* `payment_id` (string): Payment ID from Step 1.
* `session_id` (int): Session ID from Step 1.
* `customer_id` (string): Customer ID.

### Dishhome Internet (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "DISHHOME_GET",
  "data": {
    "customer_id": "71909771942"
  }
}'

```

The response contains available packages and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "DISHHOME_PAY",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "package_id": "1",
    "session_id": 50053
  }
}'

```

**`data` fields:**

* `package_id` (string): Package ID from Step 1.
* `session_id` (int): Session ID from Step 1.

### Subisu Internet (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SUBISU_GET",
  "data": {
    "username": "username"
  }
}'

```

The response contains account and plan details with a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SUBISU_PAY",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "50067",
    "renew_type": "outstanding_payment",
    "account": "username"
  }
}'

```

**`data` fields:**

* `session_id` (string): Session ID from Step 1.
* `renew_type` (string): Renewal type (e.g., `"outstanding_payment"`).
* `account` (string): Account username.

### Nijgad TV & Internet (Two-Step Payment)

Nijgad supports both TV and Internet payments using the same `NIJGADH_PAY` service name.

#### Step 1: Fetch Available Packages

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NIJGADH_GET",
  "data": {
    "type": "tv"
  }
}'

```

**`data` fields:**

* `type` (string): Service type — `"tv"` or `"internet"`.

#### Step 2: Process TV Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NIJGADH_PAY",
  "amount": 31000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "username": "username",
    "full_name": "Full Name",
    "mobile_number": "9841XXXXXX",
    "package": "HD Plus Child TV Package - 1Year",
    "tv_identifier": "132465"
  }
}'

```

**`data` fields (TV):**

* `username` (string): Account username.
* `full_name` (string): Account holder name.
* `mobile_number` (string): Contact number.
* `package` (string): Package name from Step 1.
* `tv_identifier` (string): CAS ID (6 digits) or box number (10 digits).

#### Step 2 (Alternative): Process Internet Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NIJGADH_PAY",
  "amount": 31000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "user_id": "userId",
    "name": "Full Name",
    "mobile_number": "9841XXXXXX",
    "package": "Internet Package - 12Month 75Mbps"
  }
}'

```

### Rapid Unique Internet (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "RAPIDUNIQUE_GET",
  "data": {
    "username": "username"
  }
}'

```

The response contains account details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "RAPIDUNIQUE_PAY",
  "amount": 100100,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "50544"
  }
}'

```

### GRS Internet (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "GRS_GET",
  "data": {
    "username": "username"
  }
}'

```

The response contains package information and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "GRS_PAY",
  "amount": 100000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "package_id": "1",
    "session_id": "50545"
  }
}'

```

### Merosoft Internet (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "MEROSOFT_GET",
  "data": {
    "Username": "username",
    "service_slug": "metalink"
  }
}'

```

**`data` fields:**

* `Username` (string): Account username (case-sensitive key).
* `service_slug` (string): ISP slug under the Merosoft platform.

The response contains package information and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "MEROSOFT_PAY",
  "amount": 100000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "package_id": "1",
    "session_id": "50545"
  }
}'

```

### 3G Vision Internet (Two-Step Payment)

#### Step 1: Fetch Available Packages

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "3G_VISION_GET",
  "data": {}
}'

```

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "3G_VISION_PAY",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "name": "Full Name",
    "contact_number": "9849XXXXXX",
    "user_id": "userId",
    "package": "5 Mbps unlimited - Internet",
    "remarks": "optional remarks"
  }
}'

```

**`data` fields:**

* `name` (string): Account holder name.
* `contact_number` (string): Contact number.
* `user_id` (string): User identifier.
* `package` (string): Package name from Step 1.
* `remarks` (string, optional): Payment remarks.

### NT-FTTH Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NTFTTH_PAY",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "number": "10000141001060"
  }
}'

```

**`data` fields:**

* `number` (string): NT-FTTH account number.

### Virtual Network Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VIRTUAL_NETWORK",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "username": "username",
    "mobile_number": "9818XXXXXX"
  }
}'

```

### Royal Network Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "ROYAL_NETWORK",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "username": "username",
    "mobile_number": "9818XXXXXX"
  }
}'

```

### Metrolink Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "METROLINK",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "username": "username",
    "number": "9818XXXXXX",
    "amount": 100,
    "address": "Banepa"
  }
}'

```

### InfoNet Communication Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "INFONET_COMM_PAY",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "username": "username",
    "number": "9818XXXXXX",
    "address": "Kathmandu"
  }
}'

```

### Pokhara Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "POKHARA_INTERNET",
  "amount": 20000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "username": "username",
    "number": "9818XXXXXX",
    "address": "Amarsingh"
  }
}'

```

### Fibertel Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "FIBERTEL_FIBERNET_PAY",
  "amount": 155000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "username": "username",
    "contact_number": "9843XXXXXX",
    "package": "Residential Plan 1 Month 30 Mbps",
    "remarks": "optional remarks"
  }
}'

```

**`data` fields:**

* `username` (string): Account username.
* `contact_number` (string): Contact number.
* `package` (string): Package name.
* `remarks` (string, optional): Payment remarks.

### Kriti Darshan Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "KRITI_DARSHAN_PAY",
  "amount": 200000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "full_name": "Full Name",
    "address": "Madhyapur Thimi",
    "mobile_number": "016XXXXXXX"
  }
}'

```

### Airlink Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "AIRLINK_PAY",
  "amount": 1000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "mobile_number": "9843XXXXXX",
    "username": "username",
    "address": "Bhaktapur"
  }
}'

```

### EastLink Internet (Direct Payment)

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "EASTLINK",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "username": "username",
    "mobile_number": "9818XXXXXX"
  }
}'

```

### Dishhome TV (Two-Step Payment)

Dishhome TV uses the same service names as Dishhome Internet (`DISHHOME_GET` / `DISHHOME_PAY`).

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "DISHHOME_GET",
  "data": {
    "customer_id": "71909771942"
  }
}'

```

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "DISHHOME_PAY",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "package_id": "1",
    "session_id": 50053
  }
}'

```

### MaxTV (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "MAXTV_GET",
  "data": {
    "customer_id": "1000159157"
  }
}'

```

The response contains account details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "MAXTV_PAY",
  "amount": 35000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "customer_id": "1000159157",
    "session_id": 2519
  }
}'

```

### PrabhuTV (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "PRABHU_TV_GET",
  "data": {
    "cas_id": "01234567891"
  }
}'

```

The response contains account details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "PRABHU_TV_PAY",
  "amount": 35000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "cas_id": "01234567891",
    "session_id": 3483
  }
}'

```

### SIMTV (Two-Step Payment)

#### Step 1: Fetch Account Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SIM_TV_GET",
  "data": {
    "customer_id": "1000159157"
  }
}'

```

The response contains account details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SIM_TV_PAY",
  "amount": 30000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "amount": 30000,
    "customer_id": 1000088047,
    "session_id": 50050
  }
}'

```

### Net TV (Three-Step Payment)

Net TV requires fetching the device serial number, then available packages, before processing.

#### Step 1: Fetch Account by Username

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NET_TV_FETCH",
  "data": {
    "username": "username"
  }
}'

```

The response contains the device `serial_no` and a `session_id`.

#### Step 2: Fetch Available Packages

Use the `serial_no` and `session_id` from Step 1.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NET_TV_PACKAGES",
  "data": {
    "serial_no": "00226D85984E",
    "session_id": 50527
  }
}'

```

The response contains available packages with their `package_sales_id`.

#### Step 3: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NET_TV_PAY",
  "amount": 25000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "package_sales_id": 1,
    "session_id": 50527,
    "username": "username"
  }
}'

```

**`data` fields:**

* `package_sales_id` (int): Package sales ID from Step 2.
* `session_id` (int): Session ID from Step 2.
* `username` (string): Account username.

### NLG Insurance / Arhant (Two-Step Payment)

#### Step 1: Fetch Policy Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "ARHANT_INSURANCE_GET",
  "data": {
    "proforma_no": "01458110",
    "service_slug": "nlg-insurance"
  }
}'

```

**`data` fields:**

* `proforma_no` (string): Proforma/debit note number.
* `service_slug` (string): Insurance provider slug.

The response contains policy details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "ARHANT_INSURANCE_PAY",
  "amount": 452000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": 31094
  }
}'

```

### Prudential Non-Life Insurance (Two-Step Payment)

#### Step 1: Fetch Branch List

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "PRUDENTIAL_GET",
  "data": {}
}'

```

The response contains a list of branches.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "PRUDENTIAL_PAY",
  "amount": 20000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "issue_branch": "Kathmandu",
    "customer_name": "Full Name",
    "mobile_number": "9818XXXXXX",
    "email": "customer@example.com",
    "debit_note_or_bill_number": "123456"
  }
}'

```

**`data` fields:**

* `issue_branch` (string): Branch name from Step 1.
* `customer_name` (string): Policy holder name.
* `mobile_number` (string): Contact number.
* `email` (string): Email address.
* `debit_note_or_bill_number` (string): Debit note or bill number.

### Neco Non-Life Insurance (Two-Step Payment)

#### Step 1: Fetch Available Providers

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NECO_INSURANCE_GET",
  "data": {
    "insurance_slug": "neco-insurance"
  }
}'

```

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NECO_INSURANCE_PAY",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "policy_type": "Fresh",
    "customer_name": "Full Name",
    "policy_category": "Engineering",
    "reference": "UNIQUE_REFERENCE_ID",
    "policy_number": "12",
    "mobile_number": "9843XXXXXX",
    "service_name": "neco-insurance",
    "insurance_slug": "neco-insurance"
  }
}'

```

**`data` fields:**

* `policy_type` (string): `"Fresh"` or `"Renew"`.
* `customer_name` (string): Policy holder name.
* `policy_category` (string): Insurance category (e.g., `"Engineering"`, `"Motor"`).
* `reference` (string): Unique reference ID for this request.
* `policy_number` (string, optional): Existing policy number for renewals.
* `mobile_number` (string): Contact number.
* `service_name` (string): Insurance provider name slug.
* `insurance_slug` (string): Insurance provider slug.

### Sagarmatha Lumbini Non-Life Insurance (Two-Step Payment)

#### Step 1: Fetch Policy Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SAGARMATHA_INSURANCE_GET",
  "data": {
    "debit_note_no": "198500779"
  }
}'

```

The response contains policy details including `payable_amount` and a `session_id`.

#### Step 2: Process Payment

Use the `payable_amount` from Step 1 as the `amount`.

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SAGARMATHA_INSURANCE_PAY",
  "amount": 101000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "1414"
  }
}'

```

### Sun Life Insurance (Two-Step Payment)

#### Step 1: Fetch Policy Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SUNLIFE_GET",
  "data": {
    "policy_no": "66160014378",
    "dob": "1968-06-01"
  }
}'

```

**`data` fields:**

* `policy_no` (string): Policy number.
* `dob` (string): Date of birth in `YYYY-MM-DD` format.

The response contains premium details including `total_amount` and a `session_id`.

#### Step 2: Process Payment

Use the `total_amount` from Step 1 as the `amount`.

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SUNLIFE_PAY",
  "amount": 18000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "3965"
  }
}'

```

### Rastriya Beema Life Insurance (Two-Step Payment)

#### Step 1: Fetch Policy Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "RASTRIYABEEMA_GET",
  "data": {
    "policy_no": "49726",
    "dob": "1962-08-10"
  }
}'

```

**`data` fields:**

* `policy_no` (string): Policy number.
* `dob` (string): Date of birth in `YYYY-MM-DD` format.

The response contains premium details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "RASTRIYABEEMA_PAY",
  "amount": 101000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "1414"
  }
}'

```

### Reliable Life Insurance (Two-Step Payment)

#### Step 1: Fetch Policy Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "RELIABLE_GET",
  "data": {
    "policy_no": "101000000008",
    "dob": "2018-09-26"
  }
}'

```

The response contains premium details including `total_amount` and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "RELIABLE_PAY",
  "amount": 18000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "3966"
  }
}'

```

### Citizen Life Insurance (Two-Step Payment)

#### Step 1: Fetch Policy Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "CITIZENLIFE_GET",
  "data": {
    "policy_no": "101000315",
    "dob": "1976-09-22"
  }
}'

```

The response contains premium details including `total_amount` and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "CITIZENLIFE_PAY",
  "amount": 18000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "3967"
  }
}'

```

### Surya Life Insurance (Two-Step Payment)

#### Step 1: Fetch Policy Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SURYA_INSURANCE_GET",
  "data": {
    "policy_number": "405003539",
    "dob": "2014-08-09",
    "date_type": "AD",
    "service_slug": "surya-life-insurance"
  }
}'

```

**`data` fields:**

* `policy_number` (string): Policy number.
* `dob` (string): Date of birth in `YYYY-MM-DD` format.
* `date_type` (string): Calendar type — `"AD"` (Gregorian) or `"BS"` (Bikram Sambat).
* `service_slug` (string): Insurance provider slug.

The response contains premium details and a `session_id`.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SURYA_INSURANCE_PAY",
  "amount": 101000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "1414"
  }
}'

```

### IME General Insurance (Two-Step Payment)

#### Step 1: Fetch Branch List

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "IMEGENERAL_GET",
  "data": {}
}'

```

The response contains a list of branches and insurance types.

#### Step 2: Process Payment

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "IMEGENERAL_PAY",
  "amount": 1000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "policy_type": "Endorsement",
    "insurance_type": "Property Insurance",
    "branch": "Pokhara",
    "full_name": "Full Name",
    "address": "Address",
    "mobile_number": "9841XXXXXX",
    "policy_description": "Description",
    "debit_note_no": "123465789",
    "bill_no": "12346589",
    "email": "customer@example.com"
  }
}'

```

**`data` fields:**

* `policy_type` (string): Policy type (e.g., `"Endorsement"`, `"Fresh"`, `"Renew"`).
* `insurance_type` (string): Type of insurance from Step 1.
* `branch` (string): Branch name from Step 1.
* `full_name` (string): Policy holder name.
* `address` (string): Policy holder address.
* `mobile_number` (string): Contact number.
* `policy_description` (string): Policy description.
* `debit_note_no` (string): Debit note number.
* `bill_no` (string): Bill number.
* `email` (string): Email address.

### Nepal Life Insurance (Two-Step Payment)

#### Step 1: Fetch Policy Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NEPAL_INSURANCE_GET",
  "data": {
    "policy_no": "401059698",
    "dob": "2008-03-20"
  }
}'

```

**`data` fields:**

* `policy_no` (string): Policy number.
* `dob` (string): Date of birth in `YYYY-MM-DD` format.

The response contains premium details including `amount` and a `session_id`.

#### Step 2: Process Payment

Use the `amount` from Step 1.

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "NEPAL_INSURANCE_PAY",
  "amount": 250000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "session_id": "3743"
  }
}'

```

### Voting (Multi-Step Payment)

Voting payments follow a multi-step flow: list events → fetch episodes → list participants → fetch voting options → cast vote. Free votes and coupon redemptions use the detail endpoint; paid votes use the payment endpoint.

#### Step 1: List Voting Events

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_EVENTS",
  "data": {}
}'

```

The response contains a list of events under `data.events`. Each event has an `id`, `name`, `description`, `status`, `logo`, `banners`, `dates`, and `organizer`.

#### Step 2: Fetch Event Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_EVENT_DETAILS",
  "data": {
    "event_id": 1
  }
}'

```

**`data` fields:**

* `event_id` (int): The event ID from Step 1.

The response contains a single event object under `data.event`.

#### Step 3: Fetch Episodes for an Event

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_EPISODES",
  "data": {
    "event_id": 1
  }
}'

```

**`data` fields:**

* `event_id` (int): The event ID.

The response contains a list of episodes under `data.episodes`. Each episode has an `id`, `title`, `episodeNumber`, `status`, `episodeDate`, `isFinale`, `votingWindow` (`startTime`, `endTime`), and `banner`.

#### Step 4: Fetch Episode Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_EPISODE_DETAILS",
  "data": {
    "episode_id": 10
  }
}'

```

**`data` fields:**

* `episode_id` (int): The episode ID from Step 3.

The response contains a single episode object under `data.episode`.

#### Step 5: List Participants for an Episode

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_EPISODE_PARTICIPANTS",
  "data": {
    "episode_id": 10
  }
}'

```

**`data` fields:**

* `episode_id` (int): The episode ID.

The response contains a list of participants under `data.participants`. Each participant has an `id`, `code`, `name`, `image`, `shortDesc`, and `status`.

#### Step 6: Fetch Participant Details

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_PARTICIPANT_DETAILS",
  "data": {
    "code": "P-001"
  }
}'

```

**`data` fields:**

* `code` (string): The participant code from Step 5.

The response contains a single participant object under `data.participant`.

#### Step 7: Fetch Voting Options for a Participant

Returns the available vote packages (free, paid package, custom amount) for a contestant in the current voting window.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_DETAILS",
  "data": {
    "contestantCode": "P-001",
    "voterId": "9841XXXXXX"
  }
}'

```

**`data` fields:**

* `contestantCode` (string): Participant code from Step 5.
* `voterId` (string): Voter's mobile number.

The response contains a list of options under `data.options`. Each option has:

* `type` (string): `"free"`, `"package"`, or `"custom"`.
* `qty` (int, optional): Number of votes for package options.
* `amount` (int, optional): Amount in paisa for package options.
* `label` (string, optional): Display label.
* `schemeId` (int, optional): Scheme identifier required when paying for a package.
* `isRecommended` (bool, optional): Whether this is the recommended option.
* `baseRate` (int, optional): Per-vote rate in paisa for custom options.

#### Step 8a: Cast a Free Vote

Free votes are submitted via the detail endpoint (no payment is deducted).

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_FREE",
  "data": {
    "contestantCode": "P-001",
    "voterId": "9841XXXXXX",
    "amount": 0
  }
}'

```

**`data` fields:**

* `contestantCode` (string): Participant code.
* `voterId` (string): Voter's mobile number.
* `amount` (int): Must be `0`.

#### Step 8b: Cast a Paid Vote — Package

Use when the voter selects a predefined vote package from Step 7. The `amount` is taken directly from the selected option's `amount` field.

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_PAY",
  "amount": 50000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "contestantCode": "P-001",
    "type": "package",
    "voterId": "9841XXXXXX",
    "amount": 50000,
    "schemeId": "12"
  }
}'

```

**`data` fields:**

* `contestantCode` (string): Participant code.
* `type` (string): Must be `"package"`.
* `voterId` (string): Voter's mobile number.
* `amount` (int): Amount in paisa — use the `amount` value from the selected option in Step 7.
* `schemeId` (string): Scheme ID from the selected option in Step 7.

#### Step 8c: Cast a Paid Vote — Custom Amount

Use when the voter selects the `"custom"` option from Step 7 and enters their own amount. The `baseRate` from the option is the per-vote rate in paisa; the voter enters a total amount which determines how many votes they get.

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_PAY",
  "amount": 30000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "contestantCode": "P-001",
    "type": "amount",
    "voterId": "9841XXXXXX",
    "amount": 30000
  }
}'

```

**`data` fields:**

* `contestantCode` (string): Participant code.
* `type` (string): Must be `"amount"`.
* `voterId` (string): Voter's mobile number.
* `amount` (int): Voter-entered amount in paisa. Do not include `schemeId` for custom votes.

---

### Voting Coupons

#### Purchase Vote Coupons

Coupons are purchased upfront and can later be redeemed to cast votes for any participant.

##### Step 1: Fetch Coupon Schemes

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_COUPON_SCHEMES",
  "data": {
    "eventId": 1
  }
}'

```

**`data` fields:**

* `eventId` (int): The event ID.

The response contains a list of schemes under `data.schemes`. Each scheme has a `schemeId`, `label`, `amount` (in paisa), `voteCount`, and `isRecommended`.

##### Step 2: Purchase Coupons

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_PURCHASE_COUPONS",
  "amount": 100000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "voterId": "9841XXXXXX",
    "schemeId": 5,
    "quantity": 2,
    "amount": 100000,
    "eventId": 1
  }
}'

```

**`data` fields:**

* `voterId` (string): Voter's mobile number.
* `schemeId` (int): Scheme ID from Step 1.
* `quantity` (int): Number of coupon packs to purchase.
* `amount` (int): Total amount in paisa (`scheme.amount × quantity`).
* `eventId` (int): The event ID.

#### Redeem a Coupon

Redeem a purchased coupon code to cast votes for a participant. Submitted via the detail endpoint (no additional payment).

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_COUPON_REDEEM",
  "data": {
    "voterId": "9841XXXXXX",
    "contestantCode": "P-001",
    "couponCode": "COUP-XXXX"
  }
}'

```

**`data` fields:**

* `voterId` (string): Voter's mobile number.
* `contestantCode` (string): Participant code to vote for.
* `couponCode` (string): The coupon code to redeem.

#### Fetch My Coupons

Can be filtered by event or by the transaction that purchased them.

**Request — by event:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_MY_COUPONS",
  "data": {
    "voterId": "9841XXXXXX",
    "eventId": 1
  }
}'

```

**Request — by purchase transaction:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_MY_COUPONS",
  "data": {
    "voterId": "9841XXXXXX",
    "coreTransactionId": "TXN-UUID-HERE"
  }
}'

```

**`data` fields:**

* `voterId` (string): Voter's mobile number.
* `eventId` (int, optional): Filter coupons by event.
* `coreTransactionId` (string, optional): Filter coupons by the transaction UUID that purchased them.

The response contains a list of coupons under `data.coupons`. Each coupon has `id`, `code`, `amount`, `voteValue`, `status` (`active`, `redeemed`, `expired`), `purchasedAt`, `expiresAt`, `redeemedAt`, `redeemedBy`, `redeemedContestant`, `redeemedEpisode`, `scheme`, `event`, and `coreTransactionId`.

#### Download Coupons PDF

Generate a downloadable PDF of all coupons from a specific purchase transaction.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "VOTING_COUPON_DOWNLOAD",
  "data": {
    "purchasedBy": "9841XXXXXX",
    "coreTransactionId": "TXN-UUID-HERE"
  }
}'

```

**`data` fields:**

* `purchasedBy` (string): Voter's mobile number.
* `coreTransactionId` (string): The transaction UUID from the coupon purchase.

The response contains `data.url` (the PDF download URL) and `data.filename`.

---

### Bank Transfer (Three-Step Payment)

Bank transfers require three steps: list available banks, verify the destination account, then process the payment.

#### Step 1: List Available Banks

Retrieve a list of supported banks and their codes.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "BANK_TRANSFER_LIST"
}'

```

#### Step 2: Verify Account

Verify the destination bank account before processing the transfer.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "BANK_TRANSFER_VERIFICATION"
  "data": {
    "bank_code": "LXBLNPKA",
    "account_name": "Kishor Adhikari",
    "account_number": "1845008000023",
    "merchant_txn_id": "YOUR_MERCHANT_TXN_ID",
    "is_mobile": "n"
  }
}'

```

**`data` fields:**

* `bank_code` (string): Bank identifier code from the list in Step 1.
* `account_name` (string): Account holder name.
* `account_number` (string): Destination account number.
* `merchant_txn_id` (string): Your unique transaction identifier.
* `is_mobile` (string): `"y"` if the account number is a mobile wallet number, `"n"` otherwise.

#### Step 3: Process Bank Transfer

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/payments/wallet-service-reseller-payment \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "BANK_TRANSFER",
  "amount": 10000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "data": {
    "destination_bank": "LXBLNPKA",
    "destination_acc_no": "1845008000023",
    "destination_acc_name": "Kishor Adhikari",
    "is_destination_mobile": "n",
    "transaction_remarks": "Fund Transfer",
    "transaction_remarks_2": "Remarks line 2",
    "transaction_remarks_3": "Remarks line 3"
  }
}'

```

**`data` fields:**

* `amount` (int): Transfer amount in paisa.
* `destination_bank` (string): Bank code from Step 1.
* `destination_acc_no` (string): Destination account number.
* `destination_acc_name` (string): Destination account holder name.
* `is_destination_mobile` (string): `"y"` if destination is a mobile wallet, `"n"` otherwise.
* `transaction_remarks` (string): Primary transfer remark/narration.
* `transaction_remarks_2` (string, optional): Secondary remark.
* `transaction_remarks_3` (string, optional): Tertiary remark.

---

### Remittance Payout — Samsara (Two-Step Load)

> [!NOTE] This is the only **load (credit)** flow in this document — every other example above is a debit. Step 2 posts to `/loads/wallet-service-reseller-load` (not `/payments/...`), and the response returns **`total_credited`** instead of `total_debited`. The `reference_id` in the response is the remittance `ref_no` returned by the vendor.

#### Step 1: Fetch Remittance Details

Look up a remittance by its reference number to retrieve sender/receiver details and the link ID required for Step 2.

**Request:**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/details/wallet-service-reseller-detail \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SAMSARA_GET",
  "data": {
    "ref_no": "S1001227917"
  }
}'

```

**Response:**

```
{
  "status": "SUCCESS",
  "data": {
    "core_transaction_id": "ab2c7695fc4c80a88549f45993fb5024",
    "core_transaction_uuid": "ab2c7695fc4c80a88549f45993fb5024",
    "data": {
      "agent_session_id": "9779841247293",
      "bank_name": "",
      "pay_token_id": "279606",
      "payment_type": "Cash Pay",
      "payout_amt": "50.0000",
      "payout_currency": "NPR",
      "process_id": "",
      "receiver_address": "",
      "receiver_city": "",
      "receiver_country": "NEPAL",
      "receiver_name": "SANATAN SHRESTHA",
      "receiver_phone": "9779841247293",
      "ref_no": "S1001194927",
      "send_agent": "",
      "sender_address": "testaddress",
      "sender_city": "testcity",
      "sender_country": "NEPAL",
      "sender_id_exp_date": "",
      "sender_id_no": "",
      "sender_id_type": "",
      "sender_mobile": "",
      "sender_name": "HARSAD JOSHI",
      "tran_no": "",
      "trans_mode": "",
      "txn_date": "3/29/2026 4:25:17 PM"
    },
    "microservice_transaction_id": "2",
    "ms_status": "SUCCESS",
    "reference_id": "S1001194927",
    "status": "SUCCESS",
    "vendor_state": "",
    "vendor_status": "0"
  }
}

```

Pass `data.core_transaction_uuid` from this response as `samsara_link_id` in Step 2.

> [!IMPORTANT]`data.data.payout_amt` is a vendor field expressed in **rupees** (`"50.0000"` = Rs. 50). The `amount` you send in Step 2 must be in **paisa** (`5000`).

#### Step 2: Process Payout Load

**Request (Amount in paisa):**

```
curl --request POST \
  --url https://uatapi.himalpay.com.np/api/v1/loads/wallet-service-reseller-load \
  --header 'content-type: application/json' \
  --header 'x-api-key: YOUR_API_KEY' \
  --data '{
  "wallet_service_name": "SAMSARA_PAY",
  "amount": 5000,
  "merchant_transaction_id": "YOUR_MERCHANT_TXN_ID",
  "meta_data": [
    {
      "title": "Payment Details",
      "details": [
        {
          "receiver_country": "NEPAL",
          "receiver_name": "SANATAN SHRESTHA",
          "receiver_phone": "9779841247293",
          "ref_no": "S1001194927",
          "send_agent": "",
          "sender_address": "testaddress",
          "sender_city": "testcity",
          "sender_country": "NEPAL"
        }
      ]
    }
  ],
  "data": {
    "samsara_link_id": "ab2c7695fc4c80a88549f45993fb5024",
    "payout_location_name": "Kathmandu Branch",
    "payout_agent_state": "Bagmati",
    "payout_agent_district": "Kathmandu",
    "payout_agent_municipality": "Kathmandu, Metropolitan City",
    "payout_agent_ward_number": "10",
    "payout_agent_pan_number": "123456789",
    "teller_contact": "9811111111",
    "beneficiary_gender": "Male",
    "beneficiary_nationality": "Nepali",
    "beneficiary_state": "Bagmati",
    "beneficiary_district": "Kathmandu",
    "beneficiary_municipality": "Kathmandu Metropolitan City",
    "beneficiary_ward_number": "10",
    "beneficiary_city": "",
    "beneficiary_address": "Thamel, Kathmandu",
    "beneficiary_relation": "SELF",
    "beneficiary_occupation": "STUDENT",
    "beneficiary_citizenship_number": "12-34-567890",
    "beneficiary_citizenship_issuing_district": "Kathmandu",
    "beneficiary_id_type": "Citizenship",
    "beneficiary_id_number": "12-34-567890",
    "beneficiary_id_issue_date": "2010-01-01",
    "beneficiary_id_issue_by": "Kathmandu",
    "beneficiary_mobile_no": "9800000000",
    "beneficiary_dob": "1990-01-01",
    "payout_payment_type": "Cash",
    "payout_payment_number": "234234",
    "payout_payment_bank_name": "LAXMI BANK LIMITED",
    "payout_payment_bank_branch": "KALIMATI",
    "remittance_purpose": "FAMILY_SUPPORT"
  }
}'

```

> [!IMPORTANT]`merchant_transaction_id` is **required** for resellers on this endpoint, just as it is for payments, and must be unique across all your transactions. Use it later with `/transactions/wallet-service-reseller-status` to check the load's status.

**Response (Amounts in paisa):**

```
{
  "transaction_id": "e9799f70acf715357b18e2661ca6264f",
  "status": "SUCCESS",
  "amount": 5000,
  "charge": 0,
  "cashback": 0,
  "total_credited": 5000,
  "reference_id": "S1001194927",
  "message": "Load processed successfully",
  "created_at": "2026-05-08T12:04:15.360188+05:45"
}

```

---

## Transaction Status

For all payment requests, the `status` field in the response (or via callback/webhook) is the final source of truth.

* **SUCCESS**: The transaction was processed successfully.
* **FAILED**: The transaction failed. You may retry or check the error details.
* **UNKNOWN**: The transaction is in a pending or indeterminate state. **Do not assume success or failure.** You should poll the status or wait for a final notification.

---

## Error Handling

The API returns standard HTTP status codes:

* **200 OK**: Request was successful.
* **400 Bad Request**: Missing required parameters or invalid input.
* **401 Unauthorized**: Missing or invalid API Key.
* **403 Forbidden**: Access denied (e.g., IP not allowlisted, not a reseller, or service not allowed).
* **500 Internal Server Error**: An unexpected error occurred on the server.

Error responses include a machine-readable `error_code` and `error_type` alongside the human-readable `error` message:

```
{
  "error": "wallet service not found",
  "error_code": 7002,
  "error_type": "ServiceLevel.WalletServiceNotFound"
}

```

### Error Codes

#### Authentication (1XXX)

| Code | Type                            | Message                                                       |
| ---- | ------------------------------- | ------------------------------------------------------------- |
| 1000 | Auth.MissingAuthHeader          | authorization header is missing                               |
| 1001 | Auth.InvalidAuthToken           | invalid or expired authentication token                       |
| 1002 | Auth.UserUnauthenticated        | user is not authenticated                                     |
| 1003 | Auth.UnknownUserType            | user type is unknown or invalid                               |
| 1004 | Auth.UnverifiedUser             | user is not verified                                          |
| 1005 | Auth.MissingDeviceHeaders       | X-Device-ID and X-Device-Name headers are required            |
| 1006 | Auth.DeviceNotTrusted           | device is not trusted for this user                           |
| 1007 | Auth.DeviceVerificationFailed   | failed to validate device trust status                        |
| 1008 | Auth.PasswordChangeRequired     | user is required to change password                           |
| 1009 | Auth.UserDeactivated            | user account has been deactivated                             |
| 1010 | Auth.TooManyFailedLoginAttempts | too many failed login attempts, account is temporarily locked |
| 1011 | Auth.UserWalletHold             | user's wallet is on hold, transactions are not allowed        |

#### JSON Schema (2XXX)

| Code | Type                                  | Message                                     |
| ---- | ------------------------------------- | ------------------------------------------- |
| 2000 | JSONSchema.InvalidRequestBody         | request body does not match expected schema |
| 2001 | JSONSchema.JSONSchemaValidationFailed | JSON schema validation failed               |

#### Limit (3XXX)

| Code | Type                          | Message                           |
| ---- | ----------------------------- | --------------------------------- |
| 3000 | Limit.LimitVerificationFailed | failed to check transaction limit |
| 3001 | Limit.LimitExceeded           | transaction limit exceeded        |

#### Request Validation (6XXX)

| Code | Type                                    | Message                                 |
| ---- | --------------------------------------- | --------------------------------------- |
| 6000 | RequestValidation.InvalidRequestBody    | request body is invalid                 |
| 6001 | RequestValidation.MissingRequiredFields | request body is missing required fields |
| 6002 | RequestValidation.InvalidFieldFormat    | one or more fields have invalid format  |
| 6003 | RequestValidation.DuplicateRequest      | duplicate request detected              |
| 6004 | RequestValidation.InvalidFieldValue     | one or more fields have invalid value   |

#### Service Level (7XXX)

| Code | Type                                 | Message                                     |
| ---- | ------------------------------------ | ------------------------------------------- |
| 7000 | ServiceLevel.WalletServiceNotAllowed | wallet service is not allowed for this user |
| 7001 | ServiceLevel.WalletServiceDisabled   | wallet service is currently disabled        |
| 7002 | ServiceLevel.WalletServiceNotFound   | wallet service not found                    |
| 7003 | ServiceLevel.WalletServiceInvalid    | wallet service is invalid or misconfigured  |
| 7004 | ServiceLevel.TransactionFailed       | transaction failed to process               |

#### Unknown (8XXX)

| Code | Type                 | Message                   |
| ---- | -------------------- | ------------------------- |
| 8000 | Unknown.UnknownError | an unknown error occurred |

#### System Level (9XXX)

| Code | Type                           | Message                                      |
| ---- | ------------------------------ | -------------------------------------------- |
| 9000 | SystemLevel.IPBlocked          | access from this IP address has been blocked |
| 9001 | SystemLevel.IPNotAllowed       | access from this IP address is not allowed   |
| 9002 | SystemLevel.ServiceUnavailable | the service is currently unavailable         |
| 9003 | SystemLevel.RateLimitExceeded  | rate limit exceeded, please try again later  |